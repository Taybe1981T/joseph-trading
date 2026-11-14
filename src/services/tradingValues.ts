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
 * trailing). The system is ON by default and the developer can disable it.
 */

import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { usdToPrice } from '../lib/positionMath';
import { baseQtyForSymbol, baseQtyPerCategory, calcRiskUSD, getDefaultQty } from './paperTradingService';

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

// Crypto stops/targets are PERCENTAGES of the entry price, not USD amounts.
// A USD distance divided by the coin quantity is meaningless across coins:
// $60 with 0.1 BTC = 0.6% (too tight) and $60 with 0.1 DOGE = a price 3000×
// below zero. Percentages give logical levels on every coin.
export const CRYPTO_SL_PCT = 1.5;   // 1.5% stop
export const CRYPTO_TP_PCT = 3;     // 3% target (1:2 R:R)
const CRYPTO_PCT_MIN = 0.1;
const CRYPTO_PCT_MAX = 25;
// Old documents stored crypto SL/TP as USD (60 / 120). They are migrated by
// dividing by 40 → the equivalent percentage (1.5% / 3%).
const LEGACY_CRYPTO_USD_ANCHOR = 40;

export function normalizeTradingCategory(category: string): TradingCategory {
  const key = String(category || '').toLowerCase().trim();
  return (TRADING_CATEGORIES as string[]).includes(key) ? (key as TradingCategory) : 'stocks';
}

export function defaultCategoryTradingValues(category: string): CategoryTradingValues {
  const cat = normalizeTradingCategory(category);
  if (cat === 'crypto') {
    // Crypto: lotSize is the HIGH-tier base (×10 medium, ×100 low) and the
    // SL/TP fields hold percentages.
    return {
      lotSize: baseQtyPerCategory('crypto'),
      stopLossUSD: CRYPTO_SL_PCT,
      takeProfitUSD: CRYPTO_TP_PCT,
      trailingActivationUSD: 5,
      trailingStepUSD: 2,
    };
  }
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
  // Enabled by default: a fresh install (no shared document yet) starts with
  // the developer's fixed values active. The developer can switch it OFF.
  return { enabled: true, categories, updatedAt: 0 };
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Guard against absurd values (typos such as 1e15) breaking the platform.
  return Math.min(1e9, n);
}

// Crypto SL/TP are percentages. Values coming from an older document (USD,
// e.g. 60/120) are converted to their percentage equivalent and clamped.
function cryptoPercent(value: unknown, fallback: number): number {
  const n = positiveNumber(value, fallback);
  const pct = n > 25 ? n / LEGACY_CRYPTO_USD_ANCHOR : n;
  return Math.min(CRYPTO_PCT_MAX, Math.max(CRYPTO_PCT_MIN, pct));
}

export function normalizeTradingValues(raw: any): TradingValuesConfig {
  const cats = {} as Record<TradingCategory, CategoryTradingValues>;
  for (const cat of TRADING_CATEGORIES) {
    const def = defaultCategoryTradingValues(cat);
    const src = raw && raw.categories && typeof raw.categories === 'object' ? raw.categories[cat] : null;
    const value = src && typeof src === 'object' ? src : {};
    const isCrypto = cat === 'crypto';
    cats[cat] = {
      lotSize: positiveNumber(value.lotSize, def.lotSize),
      stopLossUSD: isCrypto ? cryptoPercent(value.stopLossUSD, def.stopLossUSD) : positiveNumber(value.stopLossUSD, def.stopLossUSD),
      takeProfitUSD: isCrypto ? cryptoPercent(value.takeProfitUSD, def.takeProfitUSD) : positiveNumber(value.takeProfitUSD, def.takeProfitUSD),
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
  /** Crypto only: stop/target as a percentage of the entry price. */
  slPct?: number;
  tpPct?: number;
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
  const base = {
    category: cat,
    qty: v.lotSize,
    slUsd: v.stopLossUSD,
    tpUsd: v.takeProfitUSD,
    trailingActivationUSD: v.trailingActivationUSD,
    trailingStepUSD: v.trailingStepUSD,
  };
  // Crypto → the SL/TP numbers are percentages of price.
  if (cat === 'crypto') {
    return { ...base, slPct: v.stopLossUSD, tpPct: v.takeProfitUSD };
  }
  return base;
}

/** True when the developer's fixed-values system is currently ON. */
export function isTradingValuesEnabled(): boolean {
  return readCachedTradingValues().enabled;
}

// ───────────────────────── Trade helpers (desktop + mobile) ─────────────────

export interface TradeLevels {
  slPrice: number;
  tpPrice: number;
  /** USD risk of the stop (for display / logs). */
  slUsd: number;
  /** USD reward of the target. */
  tpUsd: number;
}

/** Percentage stop/target for crypto (always logical, on any coin price). */
export function cryptoPctLevels(
  entry: number,
  isBuy: boolean,
  slPct: number,
  tpPct: number,
  qty: number,
): TradeLevels {
  const e = entry > 0 ? entry : 0;
  const slDistance = e * (slPct / 100);
  const tpDistance = e * (tpPct / 100);
  return {
    slPrice: isBuy ? e - slDistance : e + slDistance,
    tpPrice: isBuy ? e + tpDistance : e - tpDistance,
    slUsd: slDistance * qty,
    tpUsd: tpDistance * qty,
  };
}

/**
 * Lot size for a trade.
 * - crypto: ALWAYS the tiered, balance-scaled lot (BTC 0.1 / SOL 1 / DOGE 10
 *   per $1,000); the panel's crypto lot is the high-tier base.
 * - other categories: the developer's fixed lot when the system is ON,
 *   otherwise the balance-scaled lot.
 */
export function tradeQtyFor(category: string, symbol: string, balance: number): number {
  const cat = normalizeTradingCategory(category);
  const fixed = getTradingValuesOverride(cat);
  if (cat === 'crypto') return getDefaultQty('crypto', balance, symbol, fixed?.qty);
  return fixed ? fixed.qty : getDefaultQty(cat, balance, symbol);
}

/**
 * Manual ticket size: identical to tradeQtyFor, except that when the fixed
 * system is OFF the user's typed lot wins (non-crypto only — crypto always
 * uses the tiered system lot so cheap coins are never traded at 0.01).
 */
export function manualTradeQty(category: string, symbol: string, balance: number, typed?: number): number {
  const cat = normalizeTradingCategory(category);
  const fixed = getTradingValuesOverride(cat);
  if (cat === 'crypto') return getDefaultQty('crypto', balance, symbol, fixed?.qty);
  if (fixed) return fixed.qty;
  const t = Number(typed);
  return Number.isFinite(t) && t > 0 ? t : getDefaultQty(cat, balance, symbol);
}

/**
 * Trailing "base unit" for a trade (qty / baseUnit = number of risk units).
 * Crypto uses the coin's tier base so activation/step stay proportional.
 */
export function baseUnitForTrade(category: string, symbol?: string): number {
  const cat = normalizeTradingCategory(category);
  const fixed = cat === 'crypto' ? getTradingValuesOverride('crypto') : null;
  return baseQtyForSymbol(cat, symbol, fixed?.qty ?? baseQtyPerCategory('crypto'));
}

/**
 * Turn an analysed signal's SL/TP PRICES into trade levels, but only when they
 * are sane for this entry: both finite, on the correct side of the entry and
 * not collapsed onto it. Returns null when the signal plan cannot be trusted,
 * so the caller falls back to its normal dynamic behaviour.
 */
function signalLevels(args: {
  symbol: string;
  entry: number;
  isBuy: boolean;
  qty: number;
  category: string;
  signalSl?: number | null;
  signalTp?: number | null;
}): TradeLevels | null {
  const { symbol, entry, isBuy, qty, category } = args;
  const sl = Number(args.signalSl);
  const tp = Number(args.signalTp);
  if (!(entry > 0) || !Number.isFinite(sl) || !Number.isFinite(tp) || sl <= 0 || tp <= 0) return null;
  // Both levels must sit on the profitable/losing side expected for this side.
  if (isBuy ? !(sl < entry && tp > entry) : !(tp < entry && sl > entry)) return null;
  const slUsd = Math.abs(entry - sl) * qty;
  const tpUsd = Math.abs(tp - entry) * qty;
  if (!(slUsd > 0) || !(tpUsd > 0)) return null;
  // Guard against absurd distances (bad feed / stale signal): ignore > 50%.
  if (Math.abs(entry - sl) / entry > 0.5 || Math.abs(tp - entry) / entry > 0.5) return null;
  void symbol;
  void category;
  return { slPrice: sl, tpPrice: tp, slUsd, tpUsd };
}

/**
 * SL/TP price levels for a trade — the SINGLE source of truth for auto and
 * manual orders on desktop + mobile:
 *   • system ON   → forced fixed values (crypto = % of price)
 *   • system OFF  → the analysed signal's own ATR-based SL/TP when available
 *                   (ALL categories, crypto included), otherwise the dynamic
 *                   balance risk (crypto = % of price)
 */
export function resolveRiskLevels(args: {
  category: string;
  symbol: string;
  entry: number;
  isBuy: boolean;
  qty: number;
  balance: number;
  /** Optional analysed-signal levels — used when the fixed system is OFF. */
  signalSl?: number | null;
  signalTp?: number | null;
}): TradeLevels {
  const { symbol, entry, isBuy, qty, balance } = args;
  const cat = normalizeTradingCategory(args.category);
  const fixed = getTradingValuesOverride(cat);

  if (cat === 'crypto') {
    // Fixed system ON → its % values win. Otherwise the signal's automatic
    // levels are authoritative (same ATR system as every other category);
    // the percentage fallback only covers symbols with no signal plan.
    if (!fixed) {
      const fromSignal = signalLevels({
        symbol,
        entry,
        isBuy,
        qty,
        category: cat,
        signalSl: args.signalSl,
        signalTp: args.signalTp,
      });
      if (fromSignal) return fromSignal;
    }
    return cryptoPctLevels(
      entry,
      isBuy,
      fixed?.slPct ?? CRYPTO_SL_PCT,
      fixed?.tpPct ?? CRYPTO_TP_PCT,
      qty,
    );
  }

  if (fixed) {
    return {
      slPrice: usdToPrice(symbol, fixed.slUsd, entry, !isBuy, qty, cat),
      tpPrice: usdToPrice(symbol, fixed.tpUsd, entry, isBuy, qty, cat),
      slUsd: fixed.slUsd,
      tpUsd: fixed.tpUsd,
    };
  }

  // System OFF: honour the signal's own SL/TP plan when it is usable.
  const fromSignal = signalLevels({
    symbol,
    entry,
    isBuy,
    qty,
    category: cat,
    signalSl: args.signalSl,
    signalTp: args.signalTp,
  });
  if (fromSignal) return fromSignal;

  const { slUsd, tpUsd } = calcRiskUSD(balance);
  return {
    slPrice: usdToPrice(symbol, slUsd, entry, !isBuy, qty, cat),
    tpPrice: usdToPrice(symbol, tpUsd, entry, isBuy, qty, cat),
    slUsd,
    tpUsd,
  };
}
