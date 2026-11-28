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
 * CRYPTO is split into three independently editable liquidity tiers —
 * high / medium / low — each with its own lot size, SL, TP and trailing values.
 * The flat fields on the crypto category mirror the HIGH tier, so old documents
 * (and old readers) keep working exactly as before.
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
import { baseQtyForSymbol, baseQtyPerCategory, balanceThousands, calcRiskUSD, getDefaultQty } from './paperTradingService';
import {
  CRYPTO_TIER_FACTORS,
  CRYPTO_TIER_KEYS,
  CRYPTO_TIER_LOT_MULTIPLIERS,
  cryptoHighBaseForSymbol,
  cryptoTier,
  type CryptoLotTierBases,
} from '../lib/cryptoTiers';

export type TradingCategory = 'forex' | 'crypto' | 'stocks' | 'metals';

export const TRADING_CATEGORIES: TradingCategory[] = ['forex', 'crypto', 'stocks', 'metals'];

export type CryptoTierKey = 'high' | 'medium' | 'low';
export const CRYPTO_TIER_VALUES_KEYS: CryptoTierKey[] = [...CRYPTO_TIER_KEYS];

export interface TierTradingValues {
  lotSize: number;
  stopLossUSD: number;
  takeProfitUSD: number;
  trailingActivationUSD: number;
  trailingStepUSD: number;
}

export interface CategoryTradingValues {
  lotSize: number;
  stopLossUSD: number;
  takeProfitUSD: number;
  trailingActivationUSD: number;
  trailingStepUSD: number;
  /** Crypto only: independently editable fixed values per liquidity tier. */
  cryptoTiers?: Record<CryptoTierKey, TierTradingValues>;
}

export interface TradingValuesConfig {
  enabled: boolean;
  categories: Record<TradingCategory, CategoryTradingValues>;
  updatedAt: number;
  /** Bumped when a stored tier base must be upgraded to new defaults. */
  lotSchemaVersion?: number;
}

export const TRADING_VALUES_DOC = 'trading_values';
export const TRADING_VALUES_STORAGE_KEY = 'finalyze_trading_values_v1';
const LOT_SCHEMA_VERSION = 2;
const LEGACY_MEDIUM_LOT = 0.1;

// "Current defaults" = the values the platform uses today at a $10,000
// account: category base lot, calcRiskUSD($10k) = $60 SL / $120 TP and the
// standard trailing rule ($5 activation / $2 step).
const DEFAULT_RISK = calcRiskUSD(10000);

// Crypto stops/targets are DOLLAR budgets per $1,000 of balance, independently
// editable per liquidity tier in the developer panel:
//   high $50/$100 · medium $30/$60 · weak $10/$20 at a $1,000 balance.
// Both numbers double when the balance doubles ($2,000 weak → $20/$40).
export const CRYPTO_SL_USD = 50;   // default high-tier stop budget per $1,000
export const CRYPTO_TP_USD = 100;  // default high-tier target budget per $1,000
const CRYPTO_USD_MIN = 1;
const CRYPTO_USD_MAX = 100000;
// Older builds stored crypto SL/TP as percentages (high 5/10, weak 1.5/3).
// Only used when reading a legacy document with NO cryptoTiers section — a
// legitimate $10/$20 weak tier would otherwise be misread as a percentage.
const LEGACY_CRYPTO_PCT_ANCHOR = 10;
// A price level may never consume more than 95% of the entry price: cheap coins
// (e.g. MANA at $0.06) cannot move $10 in price, so we keep the level positive.
const CRYPTO_MAX_PRICE_MOVE = 0.95;

export function normalizeTradingCategory(category: string): TradingCategory {
  const key = String(category || '').toLowerCase().trim();
  return (TRADING_CATEGORIES as string[]).includes(key) ? (key as TradingCategory) : 'stocks';
}

function roundN(value: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/** Default fixed values for each crypto liquidity tier (preserves old behavior). */
export function defaultCryptoTierValues(): Record<CryptoTierKey, TierTradingValues> {
  const highLot = baseQtyPerCategory('crypto');
  const out = {} as Record<CryptoTierKey, TierTradingValues>;
  for (const key of CRYPTO_TIER_VALUES_KEYS) {
    out[key] = {
      lotSize: roundN(highLot * CRYPTO_TIER_LOT_MULTIPLIERS[key], 4),
      stopLossUSD: roundN(CRYPTO_SL_USD * CRYPTO_TIER_FACTORS[key], 2),
      takeProfitUSD: roundN(CRYPTO_TP_USD * CRYPTO_TIER_FACTORS[key], 2),
      trailingActivationUSD: 5,
      trailingStepUSD: 2,
    };
  }
  return out;
}

export function defaultCategoryTradingValues(category: string): CategoryTradingValues {
  const cat = normalizeTradingCategory(category);
  if (cat === 'crypto') {
    // Flat fields mirror the high tier so older readers/documents stay valid.
    const tiers = defaultCryptoTierValues();
    return { ...tiers.high, cryptoTiers: tiers };
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
  return { enabled: true, categories, updatedAt: 0, lotSchemaVersion: LOT_SCHEMA_VERSION };
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Guard against absurd values (typos such as 1e15) breaking the platform.
  return Math.min(1e9, n);
}

// Legacy-only: percentages (≤ 25, e.g. 5/10 or 1.5/3) → dollars (×10).
function legacyCryptoBudget(value: unknown, fallback: number): number {
  const n = positiveNumber(value, fallback);
  const usd = n <= 25 ? n * LEGACY_CRYPTO_PCT_ANCHOR : n;
  return Math.min(CRYPTO_USD_MAX, Math.max(CRYPTO_USD_MIN, Math.round(usd * 100) / 100));
}

// Current tier values are already dollar budgets — no percentage conversion.
function cryptoDollarBudget(value: unknown, fallback: number): number {
  const n = positiveNumber(value, fallback);
  return Math.min(CRYPTO_USD_MAX, Math.max(CRYPTO_USD_MIN, Math.round(n * 100) / 100));
}

export function normalizeTradingValues(raw: any): TradingValuesConfig {
  const cats = {} as Record<TradingCategory, CategoryTradingValues>;
  for (const cat of TRADING_CATEGORIES) {
    const def = defaultCategoryTradingValues(cat);
    const src = raw && raw.categories && typeof raw.categories === 'object' ? raw.categories[cat] : null;
    const value = src && typeof src === 'object' ? src : {};

    if (cat !== 'crypto') {
      cats[cat] = {
        lotSize: positiveNumber(value.lotSize, def.lotSize),
        stopLossUSD: positiveNumber(value.stopLossUSD, def.stopLossUSD),
        takeProfitUSD: positiveNumber(value.takeProfitUSD, def.takeProfitUSD),
        trailingActivationUSD: positiveNumber(value.trailingActivationUSD, def.trailingActivationUSD),
        trailingStepUSD: positiveNumber(value.trailingStepUSD, def.trailingStepUSD),
      };
      continue;
    }

    // ── Crypto: three independently editable tiers ──
    const defTiers = def.cryptoTiers || defaultCryptoTierValues();
    const rawTiers = value.cryptoTiers && typeof value.cryptoTiers === 'object' ? value.cryptoTiers : null;
    const hasTiers = !!rawTiers;

    // Legacy flat values are only needed to upgrade an OLD document (one with
    // no cryptoTiers section) into the new three-tier structure.
    let legacyLot = positiveNumber(value.lotSize, def.lotSize);
    if (Math.abs(legacyLot - 1) < 1e-9) legacyLot = def.lotSize; // old lot 1 → 0.01
    const legacySl = legacyCryptoBudget(value.stopLossUSD, def.stopLossUSD);
    const legacyTp = legacyCryptoBudget(value.takeProfitUSD, def.takeProfitUSD);
    const legacyAct = positiveNumber(value.trailingActivationUSD, def.trailingActivationUSD);
    const legacyStep = positiveNumber(value.trailingStepUSD, def.trailingStepUSD);

    const tiers = {} as Record<CryptoTierKey, TierTradingValues>;
    for (const key of CRYPTO_TIER_VALUES_KEYS) {
      const dt = defTiers[key];
      const rt = hasTiers && rawTiers[key] && typeof rawTiers[key] === 'object' ? rawTiers[key] : null;
      if (rt) {
        const storedLot = positiveNumber(rt.lotSize, dt.lotSize);
        // One-time upgrade: medium liquidity used to be 0.1 units per $1,000.
        // Old saved documents would otherwise keep trading that tiny size even
        // after the tier default was raised to 10.
        const staleMediumLot =
          key === 'medium' &&
          Number(raw?.lotSchemaVersion || 0) < LOT_SCHEMA_VERSION &&
          Math.abs(storedLot - LEGACY_MEDIUM_LOT) < 1e-9;
        tiers[key] = {
          lotSize: staleMediumLot ? dt.lotSize : storedLot,
          stopLossUSD: cryptoDollarBudget(rt.stopLossUSD, dt.stopLossUSD),
          takeProfitUSD: cryptoDollarBudget(rt.takeProfitUSD, dt.takeProfitUSD),
          trailingActivationUSD: positiveNumber(rt.trailingActivationUSD, dt.trailingActivationUSD),
          trailingStepUSD: positiveNumber(rt.trailingStepUSD, dt.trailingStepUSD),
        };
      } else if (hasTiers) {
        // A partially saved tier set: fill the missing tier with its default.
        tiers[key] = { ...dt };
      } else {
        // Old document: derive high/medium/weak from the previous single base.
        tiers[key] = {
          lotSize: roundN(legacyLot * CRYPTO_TIER_LOT_MULTIPLIERS[key], 4),
          stopLossUSD: roundN(legacySl * CRYPTO_TIER_FACTORS[key], 2),
          takeProfitUSD: roundN(legacyTp * CRYPTO_TIER_FACTORS[key], 2),
          trailingActivationUSD: legacyAct,
          trailingStepUSD: legacyStep,
        };
      }
    }
    // Flat fields mirror the high tier — old readers keep their exact behavior.
    cats[cat] = { ...tiers.high, cryptoTiers: tiers };
  }
  return {
    enabled: raw?.enabled === true,
    categories: cats,
    updatedAt: Number(raw?.updatedAt) || 0,
    lotSchemaVersion: LOT_SCHEMA_VERSION,
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
  /** Set for crypto: which liquidity tier produced these values. */
  cryptoTier?: CryptoTierKey;
}

/** Per-tier lot bases (units per $1,000) used by the legacy crypto qty helpers. */
function cryptoTierLotBases(tiers: Record<CryptoTierKey, TierTradingValues>): CryptoLotTierBases {
  return {
    high: tiers.high.lotSize,
    medium: tiers.medium.lotSize,
    low: tiers.low.lotSize,
  };
}

/**
 * Effective "high-tier base" for a symbol: the edited tier's own lot translated
 * back into the single base the qty helpers expect. When the fixed system is
 * OFF, crypto still trades with the DEFAULT tiers (unchanged old behavior).
 */
function cryptoHighBaseForCurrentConfig(symbol: string): number {
  const config = readCachedTradingValues();
  const tiers = config.enabled ? config.categories.crypto?.cryptoTiers : null;
  const bases = cryptoTierLotBases(tiers || defaultCryptoTierValues());
  return cryptoHighBaseForSymbol(symbol, bases);
}

/**
 * Tier-resolved per-$1,000 SL/TP budgets for a crypto symbol — the developer's
 * edited values when the system is ON, otherwise the unchanged defaults.
 */
export function resolvedCryptoRiskUsd(symbol: string): { slUsd: number; tpUsd: number } {
  const config = readCachedTradingValues();
  const tiers = config.enabled ? config.categories.crypto?.cryptoTiers : null;
  const key = cryptoTier(symbol);
  const t = tiers?.[key] || defaultCryptoTierValues()[key];
  return { slUsd: t.stopLossUSD, tpUsd: t.takeProfitUSD };
}

/**
 * Reads the live config and returns the values to IMPOSE for this category.
 * `null` = master switch OFF → callers use their normal (dynamic) behaviour.
 * Pass `symbol` for crypto to get that coin's liquidity-tier values; omitting it
 * returns the high-tier mirror (kept for older callers).
 * Read fresh on every call so a developer change applies to the next tick /
 * order with no reload.
 */
export function getTradingValuesOverride(category: string, symbol?: string): FixedTradingValues | null {
  const config = readCachedTradingValues();
  if (!config.enabled) return null;
  const cat = normalizeTradingCategory(category);
  const v = config.categories[cat];
  if (!v) return null;
  if (cat === 'crypto' && symbol && v.cryptoTiers) {
    const key = cryptoTier(symbol);
    const t = v.cryptoTiers[key];
    if (t) {
      return {
        category: cat,
        qty: t.lotSize,
        slUsd: t.stopLossUSD,
        tpUsd: t.takeProfitUSD,
        trailingActivationUSD: t.trailingActivationUSD,
        trailingStepUSD: t.trailingStepUSD,
        cryptoTier: key,
      };
    }
  }
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

// ───────────────────────── Trade helpers (desktop + mobile) ─────────────────

export interface TradeLevels {
  slPrice: number;
  tpPrice: number;
  /** USD risk of the stop (for display / logs). */
  slUsd: number;
  /** USD reward of the target. */
  tpUsd: number;
}

/**
 * Crypto SL/TP prices from DOLLAR budgets — the single helper used by the auto
 * engine, the mobile ticket, the desktop manual ticket and resolveRiskLevels().
 *
 * `slPer1kUsd` / `tpPer1kUsd` are ALREADY resolved for this symbol's liquidity
 * tier (high $50/$100 · medium $30/$60 · weak $10/$20 by default); when omitted
 * they come from `resolvedCryptoRiskUsd(symbol)`. balanceThousands() doubles the
 * budget with the account. Finally usdToPrice() converts the dollar distance to
 * a price using the position's qty, with a 95%-of-entry cap so a sub-dollar coin
 * never gets a negative stop/target. The returned slUsd/tpUsd are the ACTUAL
 * distances after that cap, which is what the open-positions table displays.
 */
export function cryptoUsdLevels(args: {
  symbol: string;
  entry: number;
  isBuy: boolean;
  qty: number;
  balance: number;
  /** Per-$1,000 budgets already resolved for this symbol's liquidity tier. */
  slPer1kUsd?: number;
  tpPer1kUsd?: number;
  /** Final (already balance-scaled) budgets — override the tier defaults. */
  slBudgetUsd?: number;
  tpBudgetUsd?: number;
}): TradeLevels {
  const { symbol, entry, isBuy, qty, balance } = args;
  const fallback = resolvedCryptoRiskUsd(symbol);
  const scale = balanceThousands(balance);
  const slBudget = Math.max(0, args.slBudgetUsd ?? (args.slPer1kUsd ?? fallback.slUsd) * scale);
  const tpBudget = Math.max(0, args.tpBudgetUsd ?? (args.tpPer1kUsd ?? fallback.tpUsd) * scale);
  const e = entry > 0 ? entry : 0;
  let slPrice = e > 0 ? usdToPrice(symbol, slBudget, e, !isBuy, qty, 'crypto') : 0;
  let tpPrice = e > 0 ? usdToPrice(symbol, tpBudget, e, isBuy, qty, 'crypto') : 0;
  // The loss-side level (SL for a buy, TP for a sell) sits BELOW entry and can
  // never go to/below zero on a cheap coin. Keep at least 5% of the entry.
  const floor = e * (1 - CRYPTO_MAX_PRICE_MOVE);
  if (isBuy) slPrice = Math.max(slPrice, floor);
  else tpPrice = Math.max(tpPrice, floor);
  return {
    slPrice,
    tpPrice,
    slUsd: Math.abs(e - slPrice) * qty,
    tpUsd: Math.abs(tpPrice - e) * qty,
  };
}

/** @deprecated Dollar budgets are used now. Kept for older callers. */
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
 * - crypto: ALWAYS the tiered, balance-scaled lot (BTC 0.01 / mid-cap 10 / DOGE 10
 *   per $1,000 by default); each tier's lot is independently editable.
 * - other categories: the developer's fixed lot when the system is ON,
 *   otherwise the balance-scaled lot.
 */
export function tradeQtyFor(category: string, symbol: string, balance: number): number {
  const cat = normalizeTradingCategory(category);
  if (cat === 'crypto') {
    return getDefaultQty('crypto', balance, symbol, cryptoHighBaseForCurrentConfig(symbol));
  }
  const fixed = getTradingValuesOverride(cat);
  if (fixed) {
    // The stored lot is a PER-$1,000 base (0.01 by default). It must scale with
    // the account like getDefaultQty — $10,000 trades 0.1, not 0.01.
    const scaled = fixed.qty * balanceThousands(balance);
    return Math.round(scaled * 1000) / 1000;
  }
  return getDefaultQty(cat, balance, symbol);
}

/**
 * Manual ticket size: identical to tradeQtyFor, except that when the fixed
 * system is OFF the user's typed lot wins (non-crypto only — crypto always
 * uses the tiered system lot so cheap coins are never traded at 0.01).
 */
export function manualTradeQty(category: string, symbol: string, balance: number, typed?: number): number {
  const cat = normalizeTradingCategory(category);
  if (cat === 'crypto') {
    return getDefaultQty('crypto', balance, symbol, cryptoHighBaseForCurrentConfig(symbol));
  }
  const fixed = getTradingValuesOverride(cat);
  if (fixed) {
    const scaled = fixed.qty * balanceThousands(balance);
    return Math.round(scaled * 1000) / 1000;
  }
  const t = Number(typed);
  return Number.isFinite(t) && t > 0 ? t : getDefaultQty(cat, balance, symbol);
}

/**
 * Trailing "base unit" for a trade (qty / baseUnit = number of risk units).
 * Crypto uses the coin's tier base so activation/step stay proportional.
 */
export function baseUnitForTrade(category: string, symbol?: string): number {
  const cat = normalizeTradingCategory(category);
  if (cat === 'crypto') {
    return baseQtyForSymbol('crypto', symbol, symbol ? cryptoHighBaseForCurrentConfig(symbol) : baseQtyPerCategory('crypto'));
  }
  return baseQtyForSymbol(cat, symbol, baseQtyPerCategory('crypto'));
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
 * Scale for the developer's fixed non-crypto SL/TP budgets. They are stored at
 * the $10,000 calibration point (DEFAULT_RISK = calcRiskUSD(10000)), so:
 *   $1,000 -> ×0.1   ·   $10,000 -> ×1   ·   $20,000 -> ×2
 * Exported so the manual ticket prefill uses the exact same maths.
 */
export function fixedRiskScale(balance: number): number {
  return balanceThousands(balance) / 10;
}

/**
 * SL/TP price levels for a trade — the SINGLE source of truth for auto and
 * manual orders on desktop + mobile:
 *   • crypto      → liquidity-tier dollar budgets (high $50/$100, medium $30/$60, weak $10/$20 per $1,000)
 *   • system ON   → forced fixed values
 *   • system OFF  → the analysed signal's own ATR-based SL/TP when available,
 *                   otherwise the dynamic balance risk
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

  if (cat === 'crypto') {
    // Crypto uses DOLLAR budgets (like every other category), widened by
    // liquidity: high $50/$100, medium $30/$60, weak $10/$20 per $1,000 —
    // both numbers double when the balance doubles. The per-tier values are
    // independently editable by the developer. See cryptoUsdLevels().
    const risk = resolvedCryptoRiskUsd(symbol);
    return cryptoUsdLevels({
      symbol,
      entry,
      isBuy,
      qty,
      balance,
      slPer1kUsd: risk.slUsd,
      tpPer1kUsd: risk.tpUsd,
    });
  }

  const fixed = getTradingValuesOverride(cat);
  if (fixed) {
    // Fixed non-crypto budgets are calibrated at a $10,000 balance (the
    // DEFAULT_RISK defaults: $60 SL / $120 TP). Scale them proportionally with
    // the account exactly like the crypto per-$1,000 budgets, so a balance
    // increase never leaves the stop/target at a stale small value.
    const scale = fixedRiskScale(balance);
    const slBudget = fixed.slUsd * scale;
    const tpBudget = fixed.tpUsd * scale;
    return {
      slPrice: usdToPrice(symbol, slBudget, entry, !isBuy, qty, cat),
      tpPrice: usdToPrice(symbol, tpBudget, entry, isBuy, qty, cat),
      slUsd: slBudget,
      tpUsd: tpBudget,
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
