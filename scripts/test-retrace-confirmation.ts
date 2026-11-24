import { countRetraceCandles, detectPostRetraceAlignment, isLastCandleForming } from '../src/services/retraceFilter';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// 1) BUY: 3 bearish retrace candles, then the first bullish close → good signal.
const buyRun = [
  { open: 1.1030, high: 1.1032, low: 1.1025, close: 1.1028 },
  { open: 1.1028, high: 1.1029, low: 1.1020, close: 1.1022 },
  { open: 1.1022, high: 1.1023, low: 1.1015, close: 1.1017 },
  { open: 1.1017, high: 1.1018, low: 1.1010, close: 1.1012 },
  { open: 1.1012, high: 1.1022, low: 1.1011, close: 1.1019 },
];
const buyCount = countRetraceCandles(buyRun, 'buy', 3, { skipLast: false, strictMode: false, skipTrailingAligned: true });
const buyAlign = detectPostRetraceAlignment(buyRun, 'buy', buyCount.indices, false);
check('buy count reached', buyCount.confirmed, true);
check('buy good-signal confirmed', buyAlign.confirmed, true);
check('buy good-signal candle index', buyAlign.candleIndex, 4);

// 2) SELL: mirror image — 3 bullish retrace candles, then a bearish close.
const sellRun = [
  { open: 1.0900, high: 1.0903, low: 1.0898, close: 1.0902 },
  { open: 1.0902, high: 1.0909, low: 1.0901, close: 1.0908 },
  { open: 1.0908, high: 1.0916, low: 1.0907, close: 1.0915 },
  { open: 1.0915, high: 1.0923, low: 1.0914, close: 1.0922 },
  { open: 1.0922, high: 1.0923, low: 1.0913, close: 1.0914 },
];
const sellCount = countRetraceCandles(sellRun, 'sell', 3, { skipLast: false, strictMode: false, skipTrailingAligned: true });
const sellAlign = detectPostRetraceAlignment(sellRun, 'sell', sellCount.indices, false);
check('sell count reached', sellCount.confirmed, true);
check('sell good-signal confirmed', sellAlign.confirmed, true);
check('sell good-signal candle index', sellAlign.candleIndex, 4);

// 3) ANY candle type: bearish body, but close above the previous close → still
//    a with-trade close for BUY.
const mixedRun = [
  { open: 1.1030, high: 1.1032, low: 1.1025, close: 1.1028 },
  { open: 1.1028, high: 1.1029, low: 1.1020, close: 1.1022 },
  { open: 1.1022, high: 1.1023, low: 1.1015, close: 1.1017 },
  { open: 1.1017, high: 1.1018, low: 1.1010, close: 1.1012 },
  { open: 1.1015, high: 1.1016, low: 1.1008, close: 1.1013 },
];
const mixedCount = countRetraceCandles(mixedRun, 'buy', 3, { skipLast: false, strictMode: false, skipTrailingAligned: true });
const mixedAlign = detectPostRetraceAlignment(mixedRun, 'buy', mixedCount.indices, false);
check('any candle type: close with trade confirmed', mixedAlign.confirmed, true);
check('any candle type: index', mixedAlign.candleIndex, 4);

// 4) No with-trade close after the run → diagnostic only, stays false.
const noAlign = [
  { open: 1.1030, high: 1.1032, low: 1.1025, close: 1.1028 },
  { open: 1.1028, high: 1.1029, low: 1.1020, close: 1.1022 },
  { open: 1.1022, high: 1.1023, low: 1.1015, close: 1.1017 },
  { open: 1.1017, high: 1.1018, low: 1.1010, close: 1.1012 },
  { open: 1.1012, high: 1.1013, low: 1.1005, close: 1.1008 },
];
const noCount = countRetraceCandles(noAlign, 'buy', 3, { skipLast: false, strictMode: false, skipTrailingAligned: true });
check('no with-trade close stays false', detectPostRetraceAlignment(noAlign, 'buy', noCount.indices, false).confirmed, false);

// 5) A still-forming final candle must not confirm anything.
check('forming candle included when completed', detectPostRetraceAlignment(buyRun, 'buy', buyCount.indices, false).confirmed, true);
check('forming candle skipped', detectPostRetraceAlignment(buyRun, 'buy', buyCount.indices, true).confirmed, false);

// 6) No completed retrace run → no confirmation.
check('no retrace run', detectPostRetraceAlignment(buyRun, 'buy', [], false).confirmed, false);

// 7) Timestamp units: Yahoo sends SECONDS, Date.now() is MILLISECONDS. Both
//    formats must be recognised; a still-forming bar must never be counted.
const fixedNow = Date.UTC(2026, 10, 24, 22, 40, 0);
const openedSec = Math.floor(fixedNow / 1000) - 60; // opened 1 minute ago
const bar = { open: 1.1, high: 1.101, low: 1.099, close: 1.1 };
check('forming candle with seconds timestamp', isLastCandleForming([{ ...bar, ts: openedSec }], '15m', fixedNow), true);
check('forming candle with milliseconds timestamp', isLastCandleForming([{ ...bar, ts: fixedNow - 60_000 }], '15m', fixedNow), true);
check('closed candle with seconds timestamp', isLastCandleForming([{ ...bar, ts: openedSec - 20 * 60 }], '15m', fixedNow), false);

// 8) Live feeds sometimes return a zero/doji forming bar. It must not be read
//    as a with-trade close and erase the two real bearish candles behind it.
const zeroDojiRun = [
  { open: 1.1030, high: 1.1032, low: 1.1025, close: 1.1028 },
  { open: 1.1028, high: 1.1029, low: 1.1020, close: 1.1022 },
  { open: 1.1022, high: 1.1023, low: 1.1015, close: 1.1017 },
  { open: 0, high: 0, low: 0, close: 0, ts: openedSec },
];
check('zero forming bar is detected as forming', isLastCandleForming(zeroDojiRun, '15m', fixedNow), true);
const zeroDojiCount = countRetraceCandles(zeroDojiRun, 'buy', 2, {
  skipLast: false, strictMode: false, skipTrailingAligned: true,
});
check('zero doji does not erase the 2-candle retrace', zeroDojiCount.confirmed, true);
check('zero doji count indices', zeroDojiCount.indices, [2, 1]);

console.log(ok ? '\nPASS: post-retrace good-signal confirmation' : '\nFAIL: post-retrace good-signal confirmation');
if (!ok) process.exit(1);
