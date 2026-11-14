/**
 * Crypto lot tiers — base size traded per $1,000 of balance.
 *
 * Every category uses a "base lot per $1,000" that is multiplied by
 * `balanceThousands()` (so the size grows/shrinks with the account balance).
 * Crypto cannot use ONE base for all coins: a high-price major needs far fewer
 * units than a cheap alt, and a deep-liquidity major must be traded smaller
 * than a thin one. The base is therefore tiered by liquidity:
 *
 *   • high   → 0.01 base units (×1)    : BTC, ETH, BNB … deep liquidity
 *   • medium → 1    base units (×100)  : SOL, BCH, AVAX, LINK … large caps
 *   • low    → 10   base units (×1000) : XRP, DOGE, LTC, SHIB … cheap / thin
 *
 * Stops/targets WIDEN with liquidity: a deep book can absorb a larger price
 * move before the position is invalidated, so high-tier coins get the widest
 * SL/TP and weak-tier coins the tightest.
 *
 * The lists are explicit (no price lookups) so the value is stable offline and
 * identical on desktop + mobile.
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
 * With the default high-tier base of 0.01 this yields 0.01 / 1 / 10.
 */
export function cryptoBaseQty(symbol: string, highTierBase = 0.01): number {
  const tier = cryptoTier(symbol);
  const multiplier = tier === 'high' ? 1 : tier === 'medium' ? 100 : 1000;
  const base = (Number.isFinite(highTierBase) && highTierBase > 0 ? highTierBase : 0.01) * multiplier;
  // Tidy precision (avoid 0.30000000000000004 style values).
  return Math.round(base * 1000) / 1000;
}

/**
 * Base SL/TP percentages by liquidity tier, anchored at a $1,000 balance on a
 * position whose notional is ~$1,000:
 *
 *   • high   (BTC, ETH …) : SL 5%  / TP 10%  → $50 / $100 per $1,000
 *   • medium (SOL, BNB …) : SL 3%  / TP 6%   → $30 / $60
 *   • low    (XRP, DOGE …): SL 1.5% / TP 3%  → $15 / $30
 *
 * The lot already scales with balanceThousands(), so the USD risk/reward grows
 * with the account balance while the percentage widens with liquidity.
 */
export function cryptoTierRiskPct(
  symbol: string,
  highSlPct = 5,
  highTpPct = 10,
): { slPct: number; tpPct: number } {
  const tier = cryptoTier(symbol);
  const factor = tier === 'high' ? 1 : tier === 'medium' ? 0.6 : 0.3;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { slPct: round(highSlPct * factor), tpPct: round(highTpPct * factor) };
}
