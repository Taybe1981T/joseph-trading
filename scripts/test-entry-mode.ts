import { resolveEntryMode } from '../src/lib/entryMode';
import { DEFAULT_STRATEGY_SETTINGS } from '../src/constants';
import type { StrategySettings } from '../src/types';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const ALL = ['forex', 'crypto', 'stocks', 'metals'];
// The mode resolver no longer takes a category: the global setting governs all.
const modes = (s?: StrategySettings) => ALL.map(() => resolveEntryMode(s));

// 1) Fresh install / no settings: every category is on the safe pullback mode.
check('fresh install', modes(DEFAULT_STRATEGY_SETTINGS), ['pullback', 'pullback', 'pullback', 'pullback']);
check('no settings at all', modes(undefined), ['pullback', 'pullback', 'pullback', 'pullback']);

// 2) Global setting still governs every category uniformly.
const globalMarket: StrategySettings = { ...DEFAULT_STRATEGY_SETTINGS, entryMode: 'market' };
check('global market', modes(globalMarket), ['market', 'market', 'market', 'market']);

// 3) Legacy forex-override fields (from old saved settings) are ignored.
const legacy: StrategySettings = {
  ...globalMarket,
  entryMode: 'pullback',
  entryModeForexEnabled: true,
  entryModeForex: 'market',
} as unknown as StrategySettings;
check('legacy forex override ignored', modes(legacy), ['pullback', 'pullback', 'pullback', 'pullback']);

// 4) Stale default fields must not exist on a fresh install any more.
const stored = DEFAULT_STRATEGY_SETTINGS as unknown as Record<string, unknown>;
check('no forex override defaults', ['entryModeForexEnabled', 'entryModeForex'].some(k => k in stored), false);

console.log(ok ? '\nPASS: single global entry mode for all categories' : '\nFAIL: single global entry mode for all categories');
if (!ok) process.exit(1);
