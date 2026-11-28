import { DEFAULT_STRATEGY_SETTINGS } from '../src/constants';
import { resolveRetraceConfig } from '../src/services/retraceFilter';
import { applyRetraceAllCategoriesMigration } from '../src/lib/retraceMigration';
import type { StrategySettings } from '../src/types';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const cats = ['forex', 'crypto', 'stocks', 'metals'] as const;
const summary = (s: StrategySettings | undefined) =>
  cats.map((c) => {
    const cfg = resolveRetraceConfig(s, c);
    return `${c}:${cfg.enabled ? 'on' : 'off'}/${cfg.strictMode ? 'strict' : 'lenient'}/${cfg.candles}/${cfg.timeframe}`;
  });

// Fresh install: every category uses the lenient forex-style counting rule.
check('fresh install', summary(DEFAULT_STRATEGY_SETTINGS), [
  'forex:on/lenient/3/1d',
  'crypto:on/lenient/1/15m',
  'stocks:on/lenient/1/15m',
  'metals:on/lenient/1/15m',
]);

// Legacy saved settings (old defaults) must be migrated exactly ONCE.
const legacy: any = {
  ...DEFAULT_STRATEGY_SETTINGS,
  retraceFilterEnabledCrypto: false,
  retraceFilterEnabledStocks: false,
  retraceFilterEnabledMetals: false,
  retraceCandlesCrypto: 3,
  retraceCandlesStocks: 3,
  retraceCandlesMetals: 3,
  retraceTimeframeCrypto: '1d',
  retraceTimeframeStocks: '1d',
  retraceTimeframeMetals: '1d',
  retraceStrictModeCrypto: true,
  retraceStrictModeStocks: true,
  retraceStrictModeMetals: true,
};
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};
check('migration applies once', applyRetraceAllCategoriesMigration(legacy, storage), true);
check('legacy settings now match forex logic', summary(legacy as StrategySettings), [
  'forex:on/lenient/3/1d',
  'crypto:on/lenient/1/15m',
  'stocks:on/lenient/1/15m',
  'metals:on/lenient/1/15m',
]);
check('migration does not reapply', applyRetraceAllCategoriesMigration(legacy, storage), false);

// Manual OFF is still respected. Strict mode is hidden and always OFF, even
// when an old save still carries `true`.
const manual: any = { ...legacy, retraceFilterEnabledCrypto: false, retraceStrictModeStocks: true };
check('manual choices survive migration flag', applyRetraceAllCategoriesMigration(manual, storage), false);
check('manual disable respected', resolveRetraceConfig(manual as StrategySettings, 'crypto').enabled, false);
check('hidden strict stays off', resolveRetraceConfig(manual as StrategySettings, 'stocks').strictMode, false);

console.log(ok ? '\nPASS: forex-style retrace for every category' : '\nFAIL: forex-style retrace for every category');
if (!ok) process.exit(1);
