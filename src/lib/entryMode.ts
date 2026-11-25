import type { StrategySettings } from '../types';

export type EntryMode = 'market' | 'pullback';

/**
 * Single global entry mode for EVERY market category.
 *
 * The former forex-only override (`entryModeForexEnabled` / `entryModeForex`)
 * was removed: forex, crypto, stocks and metals all follow the same global
 * setting. Its default is 'pullback' (safe), so a fresh install enters on the
 * retrace in every category. No category can opt out.
 */
export function resolveEntryMode(settings: StrategySettings | undefined): EntryMode {
  return (settings || {}).entryMode === 'market' ? 'market' : 'pullback';
}
