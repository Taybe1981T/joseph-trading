import type { StrategySettings } from '../types';
import { gateProfileFor } from '../constants';

export type EntryMode = 'market' | 'pullback';

/**
 * Resolve the entry mode for ONE market category.
 *
 * The global `entryMode` (default 'pullback') keeps governing every category.
 * The forex-only override lives next to the 3-candle retrace gate and is OFF by
 * default: forex therefore inherits the global mode until it is explicitly
 * enabled. When enabled, ONLY forex reads `entryModeForex`; crypto, stocks and
 * metals never look at it, so the "safe" option can never leak into them.
 */
export function resolveEntryMode(
  settings: StrategySettings | undefined,
  marketType: string,
): EntryMode {
  const s = (settings || {}) as StrategySettings & Record<string, unknown>;
  const globalMode: EntryMode = s.entryMode === 'market' ? 'market' : 'pullback';

  if (gateProfileFor(marketType).usesPips && s.entryModeForexEnabled === true) {
    return s.entryModeForex === 'market' ? 'market' : 'pullback';
  }
  return globalMode;
}
