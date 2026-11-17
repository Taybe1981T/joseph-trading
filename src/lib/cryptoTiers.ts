/**
 * Crypto lot tiers — base size traded per $1,000 of balance.
 *
 * Every category uses a "base lot per $1,000" that is multiplied by
 * `balanceThousands()` (so the size grows/shrinks with the account balance).
 * Crypto cannot use ONE base for all coins: a high-price major needs far fewer
 * units than a cheap alt, and a deep-liquidity major must be traded smaller
 * than a thin one. The base is therefore tiered by liquidity:
 *
 *   • high   → 0.01 base units (×1)     : BTC, ETH, BNB … deep liquidity
 *   • medium → 0.1  base units (×10)    : SOL, BCH, AVAX, LINK … large caps
 *   • low    → 10   base units (×1000)  : XRP, DOGE, LTC, SHIB, MANA … cheap / thin
 *
 * Stops/targets are DOLLAR budgets per $1,000 of balance (like every other
 * category) and also WIDEN with liquidity: a deep book can absorb a larger
 * price move before the position is invalidated, so high-tier coins get the
 * widest SL/TP and weak-tier coins the tightest:
 *
 *   • high   → SL $50  / TP $100
 *   • medium → SL $30  / TP $60
 *   • low    → SL $10  / TP $20
 *
 * Both numbers double when the balance doubles ($2,000 → $20/$40 on weak
 * coins, etc.). The lists are explicit (no price lookups) so the value is
 * stable offline and identical on desktop + mobile.
 */

export type CryptoTier = 'high' | 'medium' | 'low';

// Deep-liquidity majors with a high unit price → smallest unit count.
const HIGH_TIER = new Set(['BTC', 'ETH', 'BNB', 'PAXG', 'XAUT']);

// Cheap / lower-liquidity alts → largest unit count so the position is meaningful.
const LOW_TIER = new Set([
  'XRP', 'DOGE', 'LTC', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'TRX', 'ADA',
  'XLM', 'HBAR', 'VET', 'ALGO', 'EOS', 'FTM', 'GALA', 'SAND', 'MANA', 'CHZ',
  'GRT', 'CRV', '1INCH', 'SUSHI', 'ANKR', 'BAT', 'ZIL', 'ONE', 'IOTA', 'NEO',
  'DASH', 'ZEC', 'KNC', 'LRC', 'CVC', 'BAND', 'OCEAN', 'NMR', 'STORJ', 'REN',
  'OMG', 'CAKE', 'RUNE', 'KAVA', 'COMP', 'SNX', 'YFI', 'ZRX', 'WAVES', 'KSM',
  'ZEN', 'ICX', 'QTUM', 'WAN', 'ARK', 'SXP', 'MTL', 'POWR', 'RLC', 'FET',
]);

/** BTCUSD / BTCUSDT / BTC-USD / BTC/USD → BTC */
export function cryptoRootSymbol(symbol: string): string {
  let s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) s = s.slice(0, -4);
  else if (s.endsWith('USD')) s = s.slice(0, -3);
  return s;
}

export function cryptoTier(symbol: string): CryptoTier {
  const root = cryptoRootSymbol(symbol);
  if (HIGH_TIER.has(root)) return 'high';
  if (LOW_TIER.has(root)) return 'low';
  return 'medium';
}

/**
 * Base units per $1,000 of balance for a crypto symbol.
 * With the default high-tier base of 0.01 this yields 0.01 / 0.1 / 10.
 */
export function cryptoBaseQty(symbol: string, highTierBase = 0.01): number {
  const tier = cryptoTier(symbol);
  const multiplier = tier === 'high' ? 1 : tier === 'medium' ? 10 : 1000;
  const base = (Number.isFinite(highTierBase) && highTierBase > 0 ? highTierBase : 0.01) * multiplier;
  // Tidy precision (avoid 0.30000000000000004 style values).
  return Math.round(base * 10000) / 10000;
}

/** Liquidity multiplier applied to the developer's HIGH-tier dollar budget. */
export function cryptoTierFactor(symbol: string): number {
  const tier = cryptoTier(symbol);
  return tier === 'high' ? 1 : tier === 'medium' ? 0.6 : 0.2;
}

/**
 * Base SL/TP DOLLAR budgets per $1,000 of balance, by liquidity tier.
 * The caller multiplies by balanceThousands(balance), so both numbers double
 * when the balance doubles. High base 50/100 → medium 30/60 → weak 10/20.
 */
export function cryptoTierRiskUsd(
  symbol: string,
  highSlUsd = 50,
  highTpUsd = 100,
): { slUsd: number; tpUsd: number } {
  const factor = cryptoTierFactor(symbol);
  const round = (v: number) => Math.round(v * 100) / 100;
  return { slUsd: round(highSlUsd * factor), tpUsd: round(highTpUsd * factor) };
}

/**
 * @deprecated Crypto stops/targets are dollar budgets now. Kept only so older
 * callers keep compiling; use `cryptoTierRiskUsd` instead.
 */
export function cryptoTierRiskPct(
  symbol: string,
  highSlPct = 5,
  highTpPct = 10,
): { slPct: number; tpPct: number } {
  const factor = cryptoTierFactor(symbol);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { slPct: round(highSlPct * factor), tpPct: round(highTpPct * factor) };
}
