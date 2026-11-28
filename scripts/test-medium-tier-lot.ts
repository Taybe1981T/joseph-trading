import { cryptoBaseQty, cryptoHighBaseForSymbol, cryptoTier } from '../src/lib/cryptoTiers';

// tradingValues imports the Firebase singleton, which reads window.location.
(globalThis as any).window = { location: { hostname: 'localhost' } };
const { defaultTradingValues, normalizeTradingValues } = await import('../src/services/tradingValues');

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const basesFrom = (config: ReturnType<typeof defaultTradingValues>) => {
  const t = config.categories.crypto.cryptoTiers!;
  return { high: t.high.lotSize, medium: t.medium.lotSize, low: t.low.lotSize };
};

// Fresh defaults: high stays 0.01, medium and low are 10 units per $1,000.
const defaults = defaultTradingValues();
const tierBases = basesFrom(defaults);
check('high tier base', tierBases.high, 0.01);
check('medium tier base', tierBases.medium, 10);
check('low tier base', tierBases.low, 10);

for (const sym of ['AAVEUSDT', 'TIAUSDT', 'SOLUSDT', 'LINKUSDT']) {
  check(`${sym} tier`, cryptoTier(sym), 'medium');
  check(`${sym} lot per $1,000`, cryptoBaseQty(sym), 10);
  check(`${sym} resolved lot`, cryptoHighBaseForSymbol(sym, tierBases) * 1000, 10);
}
for (const sym of ['ONEUSDT', 'XLMUSDT', 'DOGEUSDT']) {
  check(`${sym} lot stays 10`, cryptoBaseQty(sym, 0.01), 10);
}
check('BTC lot stays 0.01', cryptoBaseQty('BTCUSDT'), 0.01);

// Existing saved document with the OLD medium lot must be upgraded once.
const legacy = normalizeTradingValues({
  enabled: true,
  categories: {
    crypto: {
      ...defaults.categories.crypto,
      cryptoTiers: {
        ...defaults.categories.crypto.cryptoTiers!,
        medium: { ...defaults.categories.crypto.cryptoTiers!.medium, lotSize: 0.1 },
      },
    },
  },
  updatedAt: 1,
});
check('legacy medium lot migrated', legacy.categories.crypto.cryptoTiers!.medium.lotSize, 10);
check('schema version stamped', legacy.lotSchemaVersion, 2);
check('legacy AAVE lot migrated', cryptoHighBaseForSymbol('AAVEUSDT', basesFrom(legacy)) * 1000, 10);

// A deliberate later edit must NOT be overwritten by the migration.
const custom = normalizeTradingValues({
  ...legacy,
  categories: {
    crypto: {
      ...legacy.categories.crypto,
      cryptoTiers: {
        ...legacy.categories.crypto.cryptoTiers!,
        medium: { ...legacy.categories.crypto.cryptoTiers!.medium, lotSize: 3 },
      },
    },
  },
});
check('custom medium lot preserved', custom.categories.crypto.cryptoTiers!.medium.lotSize, 3);

console.log(ok ? '\nPASS: medium tier lot = 10 per $1,000' : '\nFAIL: medium tier lot');
if (!ok) process.exit(1);
