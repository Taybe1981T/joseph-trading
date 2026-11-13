/**
 * Developer-only fixed trading values — "Trading Values System".
 *
 * When the master switch is ON, the developer's fixed numbers are imposed on
 * EVERY trade opened anywhere (desktop auto engine, desktop manual ticket,
 * mobile auto engine, mobile manual ticket):
 *
 *   • lotSize              → fixed order size (balance scaling is ignored)
 *   • stopLossUSD          → fixed stop-loss distance in USD
 *   • takeProfitUSD        → fixed take-profit distance in USD
 *   • trailingActivationUSD→ fixed trailing activation in USD (no lot scaling)
 *   • trailingStepUSD      → fixed trailing step in USD (no lot scaling)
 *
 * Values are stored per category and shared through Firestore
 * `shared_settings/trading_values` (public read, developer-only write) with
 * localStorage as an offline cache, so a developer change reaches every
 * desktop + mobile client exactly like the payment-wait setting.
 *
 * When the master switch is OFF the resolvers return `null` and every caller
 * keeps its previous behaviour (balance-scaled lot, signal SL/TP, dynamic
 * trailing). The system is OFF by default.
 */

import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { baseQtyPerCategory, calcRiskUSD } from './paperTradingService';

export type TradingCategory = 'forex' | 'crypto' | 'stocks' | 'metals';

export const TRADING_CATEGORIES: TradingCategory[] = ['forex', 'crypto', 'stocks', 'metals'];

export interface CategoryTradingValues {
  lotSize: number;
  stopLossUSD: number;
  takeProfitUSD: number;
  trailingActivationUSD: number;
  trailingStepUSD: number;
}

export interface TradingValuesConfig {
  enabled: boolean;
  categories: Record<TradingCategory, CategoryTradingValues>;
  updatedAt: number;
}

export const TRADING_VALUES_DOC = 'trading_values';
export const TRADING_VALUES_STORAGE_KEY = 'finalyze_trading_values_v1';

// "Current defaults" = the values the platform uses today at a $10,000
// account: category base lot, calcRiskUSD($10k) = $60 SL / $120 TP and the
// standard trailing rule ($5 activation / $2 step).
const DEFAULT_RISK = calcRiskUSD(10000);

export function normalizeTradingCategory(category: string): TradingCategory {
  const key = String(category || '').toLowerCase().trim();
  return (TRADING_CATEGORIES as string[]).includes(key) ? (key as TradingCategory) : 'stocks';
}

export function defaultCategoryTradingValues(category: string): CategoryTradingValues {
  const cat = normalizeTradingCategory(category);
  return {
    lotSize: baseQtyPerCategory(cat),
    stopLossUSD: DEFAULT_RISK.slUsd,
    takeProfitUSD: DEFAULT_RISK.tpUsd,
    trailingActivationUSD: 5,
    trailingStepUSD: 2,
  };
}

export function defaultTradingValues(): TradingValuesConfig {
  const categories = {} as Record<TradingCategory, CategoryTradingValues>;
  for (const cat of TRADING_CATEGORIES) categories[cat] = defaultCategoryTradingValues(cat);
  return { enabled: false, categories, updatedAt: 0 };
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Guard against absurd values (typos such as 1e15) breaking the platform.
  return Math.min(1e9, n);
}

export function normalizeTradingValues(raw: any): TradingValuesConfig {
  const cats = {} as Record<TradingCategory, CategoryTradingValues>;
  for (const cat of TRADING_CATEGORIES) {
    const def = defaultCategoryTradingValues(cat);
    const src = raw && raw.categories && typeof raw.categories === 'object' ? raw.categories[cat] : null;
    const value = src && typeof src === 'object' ? src : {};
    cats[cat] = {
      lotSize: positiveNumber(value.lotSize, def.lotSize),
      stopLossUSD: positiveNumber(value.stopLossUSD, def.stopLossUSD),
      takeProfitUSD: positiveNumber(value.takeProfitUSD, def.takeProfitUSD),
      trailingActivationUSD: positiveNumber(value.trailingActivationUSD, def.trailingActivationUSD),
      trailingStepUSD: positiveNumber(value.trailingStepUSD, def.trailingStepUSD),
    };
  }
  return {
    enabled: raw?.enabled === true,
    categories: cats,
    updatedAt: Number(raw?.updatedAt) || 0,
  };
}

function cacheTradingValues(config: TradingValuesConfig): TradingValuesConfig {
  const normalized = normalizeTradingValues(config);
  try { localStorage.setItem(TRADING_VALUES_STORAGE_KEY, JSON.stringify(normalized)); } catch {}
  return normalized;
}

/** Offline / last-known values. The system is disabled when nothing is cached. */
export function readCachedTradingValues(): TradingValuesConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(TRADING_VALUES_STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') return normalizeTradingValues(raw);
  } catch {}
  return defaultTradingValues();
}

/** Load the shared document once (developer screen / startup). */
export async function loadSharedTradingValues(): Promise<TradingValuesConfig> {
  try {
    const snap = await getDoc(doc(db, 'shared_settings', TRADING_VALUES_DOC));
    if (snap.exists()) return cacheTradingValues(snap.data() as any);
  } catch {
    // Offline or read failed — keep the last known values.
  }
  return readCachedTradingValues();
}

/** Developer-only write (firestore.rules: shared_settings write = isDeveloper()). */
export async function saveSharedTradingValues(config: TradingValuesConfig): Promise<TradingValuesConfig> {
  const normalized = cacheTradingValues({ ...config, updatedAt: Date.now() });
  await setDoc(doc(db, 'shared_settings', TRADING_VALUES_DOC), normalized);
  return normalized;
}

/**
 * Live sync for clients: a developer change is applied without a refresh.
 * Returns an unsubscribe function. Safe to call on every device (read = public).
 */
export function subscribeTradingValues(onChange?: (config: TradingValuesConfig) => void): () => void {
  try {
    return onSnapshot(
      doc(db, 'shared_settings', TRADING_VALUES_DOC),
      (snap) => {
        if (!snap.exists()) return;
        const normalized = cacheTradingValues(snap.data() as any);
        try { onChange?.(normalized); } catch {}
        try { window.dispatchEvent(new CustomEvent('finalyze-trading-values-changed', { detail: normalized })); } catch {}
      },
      (err) => { console.warn('[TradingValues] live sync unavailable:', err?.message || err); },
    );
  } catch {
    return () => {};
  }
}

/** Fixed values that must be forced on a trade, or null when the system is OFF. */
export interface FixedTradingValues {
  category: TradingCategory;
  qty: number;
  slUsd: number;
  tpUsd: number;
  trailingActivationUSD: number;
  trailingStepUSD: number;
}

/**
 * Reads the live config and returns the values to IMPOSE for this category.
 * `null` = master switch OFF → callers use their normal (dynamic) behaviour.
 * Read fresh on every call so a developer change applies to the next tick /
 * order with no reload.
 */
export function getTradingValuesOverride(category: string): FixedTradingValues | null {
  const config = readCachedTradingValues();
  if (!config.enabled) return null;
  const cat = normalizeTradingCategory(category);
  const v = config.categories[cat];
  if (!v) return null;
  return {
    category: cat,
    qty: v.lotSize,
    slUsd: v.stopLossUSD,
    tpUsd: v.takeProfitUSD,
    trailingActivationUSD: v.trailingActivationUSD,
    trailingStepUSD: v.trailingStepUSD,
  };
}

/** True when the developer's fixed-values system is currently ON. */
export function isTradingValuesEnabled(): boolean {
  return readCachedTradingValues().enabled;
}
