import { countRetraceCandles, detectLiquidityAbsorption } from '../src/services/retraceFilter';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// 1) Same-candle rejection for BUY: a bearish retrace candle sweeps the prior
//    low, closes back above it on a long lower wick. The current forming candle
//    is bearish (opposes BUY) and must NOT block.
const buySame = [
  { open: 1.100, high: 1.102, low: 1.098, close: 1.099 },
  { open: 1.099, high: 1.100, low: 1.097, close: 1.098 },
  { open: 1.098, high: 1.099, low: 1.094, close: 1.0975 },
  { open: 1.0975, high: 1.098, low: 1.096, close: 1.0965 },
];
const buySameCount = countRetraceCandles(buySame, 'buy', 3, { skipLast: true, strictMode: false });
check('buy same-candle retrace count', buySameCount.confirmed, true);
check('buy same-candle absorption', detectLiquidityAbsorption(buySame, 'buy', buySameCount.indices).detected, true);

// 2) Same-candle mirror for SELL.
const sellSame = [
  { open: 1.090, high: 1.092, low: 1.089, close: 1.091 },
  { open: 1.091, high: 1.093, low: 1.090, close: 1.092 },
  { open: 1.092, high: 1.097, low: 1.0925, close: 1.0925 },
  { open: 1.0925, high: 1.096, low: 1.095, close: 1.0955 },
];
const sellSameCount = countRetraceCandles(sellSame, 'sell', 3, { skipLast: true, strictMode: false });
check('sell same-candle retrace count', sellSameCount.confirmed, true);
check('sell same-candle absorption', detectLiquidityAbsorption(sellSame, 'sell', sellSameCount.indices).detected, true);

// 3) THE BUG CASE: 15m / 1-candle retrace. The bearish candle itself shows no
//    rejection, but the NEXT (forming) candle sweeps its low and closes back
//    above the retrace body. This must be accepted.
const buyNext = [
  { open: 1.1000, high: 1.1010, low: 1.0995, close: 1.1005 },
  { open: 1.1005, high: 1.1015, low: 1.1000, close: 1.1012 },
  { open: 1.1012, high: 1.1013, low: 1.0995, close: 1.0998 }, // 1 bearish retrace
  { open: 1.0998, high: 1.1008, low: 1.0994, close: 1.1006 }, // forming bullish reaction
];
const buyNextCount = countRetraceCandles(buyNext, 'buy', 1, { skipLast: true, strictMode: false });
check('buy 15m/1 count', buyNextCount.confirmed, true);
check('buy 15m/1 next-candle absorption', detectLiquidityAbsorption(buyNext, 'buy', buyNextCount.indices).detected, true);

// 4) Mirror for SELL with a single bullish retrace candle.
const sellNext = [
  { open: 1.0900, high: 1.0910, low: 1.0895, close: 1.0905 },
  { open: 1.0905, high: 1.0915, low: 1.0900, close: 1.0912 },
  { open: 1.0912, high: 1.0925, low: 1.0911, close: 1.0924 }, // 1 bullish retrace
  { open: 1.0924, high: 1.0928, low: 1.0914, close: 1.0917 }, // forming bearish reaction
];
const sellNextCount = countRetraceCandles(sellNext, 'sell', 1, { skipLast: true, strictMode: false });
check('sell 15m/1 count', sellNextCount.confirmed, true);
check('sell 15m/1 next-candle absorption', detectLiquidityAbsorption(sellNext, 'sell', sellNextCount.indices).detected, true);

// 5) No sweep anywhere → still blocked.
const noSweep = [
  { open: 1.100, high: 1.101, low: 1.099, close: 1.0995 },
  { open: 1.0995, high: 1.100, low: 1.0985, close: 1.099 },
  { open: 1.099, high: 1.0995, low: 1.098, close: 1.0982 },
  { open: 1.0982, high: 1.0986, low: 1.0983, close: 1.0984 }, // no sweep of 1.098
];
const noSweepCount = countRetraceCandles(noSweep, 'buy', 3, { skipLast: true, strictMode: false });
check('no-sweep absorption stays blocked', detectLiquidityAbsorption(noSweep, 'buy', noSweepCount.indices).detected, false);

console.log(ok ? '\nPASS: liquidity absorption detection' : '\nFAIL: liquidity absorption detection');
if (!ok) process.exit(1);
