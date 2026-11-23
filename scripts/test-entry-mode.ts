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
const modes = (s?: StrategySettings) => ALL.map((m) => resolveEntryMode(s, m));

// 1) Default install: override OFF, everything inherits the global 'pullback'.
check('fresh install', modes(DEFAULT_STRATEGY_SETTINGS), ['pullback', 'pullback', 'pullback', 'pullback']);
check('no settings at all', modes(undefined), ['pullback', 'pullback', 'pullback', 'pullback']);

// 2) Global setting still governs every category while the override is OFF.
const globalMarket: StrategySettings = { ...DEFAULT_STRATEGY_SETTINGS, entryMode: 'market' };
check('global market, override off', modes(globalMarket), ['market', 'market', 'market', 'market']);

// 3) Override ON with Market: ONLY forex chases, every other category stays pullback.
const fxMarket: StrategySettings = {
  ...globalMarket,
  entryMode: 'pullback',
  entryModeForexEnabled: true,
  entryModeForex: 'market',
};
check('forex-only market', modes(fxMarket), ['market', 'pullback', 'pullback', 'pullback']);

// 4) Override ON with Pullback while the global mode is Market: forex alone is safe.
const fxSafe: StrategySettings = {
  ...globalMarket,
  entryModeForexEnabled: true,
  entryModeForex: 'pullback',
};
check('forex-only pullback', modes(fxSafe), ['pullback', 'market', 'market', 'market']);

// 5) Enabling the override without choosing a mode falls back to safe pullback.
const fxUnset: StrategySettings = { ...globalMarket, entryModeForexEnabled: true, entryModeForex: undefined };
check('override on, mode unset', modes(fxUnset), ['pullback', 'market', 'market', 'market']);

console.log(ok ? 'PASS: forex-only entry mode override' : 'FAIL');
if (!ok) process.exitCode = 1;
