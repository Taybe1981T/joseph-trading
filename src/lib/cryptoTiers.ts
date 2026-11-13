/**
 * Crypto lot tiers — base size traded per $1,000 of balance.
 *
 * Every category uses a "base lot per $1,000" that is multiplied by
 * `balanceThousands()` (so the size grows/shrinks with the account balance).
 * Crypto cannot use ONE base for all coins: 0.1 unit of bitcoin is ~$10k of
 * notional while 0.1 unit of dogecoin is a few cents. The base is therefore
 * tiered by liquidity / unit price:
 *
 *   • high   → 0.1 base units (×1)  : BTC, ETH, BNB … deep liquidity, high price
 *   • medium → 1   base units (×10) : SOL, BCH, AVAX, LINK … established large caps
 *   • low    → 10  base units (×100): XRP, DOGE, LTC, SHIB … cheap / lower liquidity
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
 * With the default high-tier base of 0.1 this yields 0.1 / 1 / 10.
 */
export function cryptoBaseQty(symbol: string, highTierBase = 0.1): number {
  const tier = cryptoTier(symbol);
  const multiplier = tier === 'high' ? 1 : tier === 'medium' ? 10 : 100;
  const base = (Number.isFinite(highTierBase) && highTierBase > 0 ? highTierBase : 0.1) * multiplier;
  // Tidy precision (avoid 0.30000000000000004 style values).
  return Math.round(base * 1000) / 1000;
}
