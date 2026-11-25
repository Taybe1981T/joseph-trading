import { forexPnlUSD, getInstrumentConfig, usdToPrice } from '../src/lib/positionMath';
import { calcTrailingStop } from '../src/lib/trailingStop';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function near(label: string, actual: number, expected: number, tolerance = 1e-6) {
  const pass = Math.abs(actual - expected) <= tolerance;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${actual}, expected ~${expected}`);
}

const lot = 0.1; // default forex size at a $10,000 balance
const pnl = (symbol: string, side: 'buy' | 'sell', entry: number, current: number) =>
  forexPnlUSD(symbol, (current - entry) * (side === 'buy' ? 1 : -1), lot);

// P/L must use the exact same pip value as SL/TP/trailing, for every quote style.
near('EURUSD 1 pip = $1', pnl('EURUSD', 'buy', 1.1, 1.1001), 1);

const gbpjpy = pnl('GBPJPY=X', 'buy', 150, 150.1);
near('GBPJPY 10 pips uses the JPY pip value', gbpjpy,
  (0.1 / getInstrumentConfig('GBPJPY=X').pipSize) * getInstrumentConfig('GBPJPY=X').pipValuePerLotUSD * lot);
check('GBPJPY profit is not collapsed to a few cents', gbpjpy > 5, true);

near('JPY sell side is positive', pnl('EURJPY=X', 'sell', 160, 159.9),
  (0.1 / getInstrumentConfig('EURJPY=X').pipSize) * getInstrumentConfig('EURJPY=X').pipValuePerLotUSD * lot);

near('cross-quote uses the same pip value as risk levels', pnl('EURGBP=X', 'buy', 0.85, 0.851),
  (0.001 / getInstrumentConfig('EURGBP=X').pipSize) * getInstrumentConfig('EURGBP=X').pipValuePerLotUSD * lot);

// Integration: with the fixed P/L, a real run locks a real profit instead of
// parking the stop at entry. A tiny move leaves the original stop untouched.
const entry = 150;
const tinyTrail = calcTrailingStop({ qty: lot, openPnlUSD: gbpjpy, balance: 10000 });
check('small GBPJPY move does not arm the trail', tinyTrail.active, false);

const bigMovePnl = pnl('GBPJPY=X', 'buy', entry, entry + 1);
const bigTrail = calcTrailingStop({ qty: lot, openPnlUSD: bigMovePnl, balance: 10000 });
const newSl = usdToPrice('GBPJPY=X', bigTrail.offsetUSD, entry, true, lot, 'forex');
check('big move arms the trail', bigTrail.active, true);
check('trail never equals entry', Math.abs(newSl - entry) > 0.01, true);
check('trail is on the profit side', newSl > entry, true);
near('locked profit matches the configured step',
  ((newSl - entry) / getInstrumentConfig('GBPJPY=X').pipSize) * getInstrumentConfig('GBPJPY=X').pipValuePerLotUSD * lot,
  bigTrail.offsetUSD);

console.log(ok ? '\nPASS: forex P/L and trailing agree' : '\nFAIL: forex P/L and trailing agree');
if (!ok) process.exit(1);
