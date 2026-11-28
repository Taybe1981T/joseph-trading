/**
 * Regression for the opt-in "windowed" Retrace mode.
 * The existing consecutive mode must stay byte-for-byte equivalent when no
 * mode is stored, and the new mode must never reach into older candles after
 * a failed (two with-trade candles) retrace.
 */
import { DEFAULT_STRATEGY_SETTINGS } from '../src/constants';
import {
  countRetraceCandles,
  resolveRetraceConfig,
  RetraceCandle,
} from '../src/services/retraceFilter';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

let ts = 1700000000000;
function bar(open: number, close: number, span = 0.2): RetraceCandle {
  return {
    open,
    close,
    high: Math.max(open, close) + span,
    low: Math.min(open, close) - span,
    ts: ts += 3600000,
  };
}
const down = (open: number, close: number, span?: number) => bar(open, close, span);
const up = (open: number, close: number, span?: number) => bar(open, close, span);
const doji = (price: number) => ({ open: price, close: price, high: price + 0.5, low: price - 0.5, ts: ts += 3600000 });
// Lenient counting (the shipped default) keeps these synthetic bars focused on
// the mode switch itself; strict neutral patterns get their own check below.
const opts = (mode: 'consecutive' | 'windowed') => ({ mode, skipLast: false, strictMode: false });

// 1) The developer's exact example: bearish, bullish, bearish BELOW the bullish
//    close, bearish → counts 3 in windowed mode, only 2 in consecutive mode.
const buyWindow = [down(105, 104), up(103, 104.5), down(104.5, 103.5), down(103.5, 102.5)];
const buyConsecutive = countRetraceCandles(buyWindow, 'buy', 3, opts('consecutive'));
const buyWindowed = countRetraceCandles(buyWindow, 'buy', 3, opts('windowed'));
check('consecutive stops at the bounce', buyConsecutive.found, 2);
check('consecutive rejects the example', buyConsecutive.confirmed, false);
check('windowed counts across the small bounce', buyWindowed.found, 3);
check('windowed accepts the example', buyWindowed.confirmed, true);
check('windowed records its mode', buyWindowed.mode, 'windowed');

// 2) Mirror image for SELL.
const sellWindow = [up(100, 101), down(101.5, 100.5), up(100.5, 102), up(102, 103)];
const sellWindowed = countRetraceCandles(sellWindow, 'sell', 3, opts('windowed'));
const sellConsecutive = countRetraceCandles(sellWindow, 'sell', 3, opts('consecutive'));
check('windowed counts the mirrored bounce', sellWindowed.found, 3);
check('windowed accepts the sell example', sellWindowed.confirmed, true);
check('consecutive rejects the sell example', sellConsecutive.confirmed, false);

// 3) Two with-trade candles invalidate the run and MUST NOT reach back to the
//    older three bearish candles. The old mode still uses them (unchanged).
const failed = [
  down(105, 104), down(104, 103), down(103, 102), // older completed retrace
  up(102, 103), up(103, 104),                     // newest: two bullish candles
];
const failedWindowed = countRetraceCandles(failed, 'buy', 3, opts('windowed'));
const failedConsecutive = countRetraceCandles(failed, 'buy', 3, { ...opts('consecutive'), skipTrailingAligned: true });
check('two with-trade candles stop the scan', failedWindowed.barrierStopped, true);
check('no older retrace is reused', failedWindowed.found, 0);
check('failed run stays unconfirmed', failedWindowed.confirmed, false);
check('no counted indices behind the barrier', failedWindowed.indices, []);
check('old consecutive mode is unchanged', failedConsecutive.confirmed, true);

// 4) A bounce that was NOT reclaimed is not a retrace either.
const unresolved = [down(105, 104), up(104, 105), down(106, 105.6)];
const unresolvedResult = countRetraceCandles(unresolved, 'buy', 2, opts('windowed'));
check('unreclaimed bounce stops the scan', unresolvedResult.barrierStopped, true);
check('unreclaimed bounce fails', unresolvedResult.confirmed, false);

// 5) A doji stays transparent in the new mode, exactly as in the old one.
const withDoji = [down(105, 104), doji(104), down(104, 103), down(103, 102)];
const dojiResult = countRetraceCandles(withDoji, 'buy', 3, opts('windowed'));
check('doji skipped in windowed mode', dojiResult.dojiSkipped, 1);
check('doji does not break the window', dojiResult.confirmed, true);

// 5b) Strict-mode neutral candles (spinning tops) are still skipped in the
//     new mode — the switch changes only the bounce rule.
const spinningTops = [down(105, 104, 2), down(104, 103, 2), down(103, 102, 2)];
const strictResult = countRetraceCandles(spinningTops, 'buy', 3, { mode: 'windowed', skipLast: false, strictMode: true });
const lenientResult = countRetraceCandles(spinningTops, 'buy', 3, opts('windowed'));
check('strict mode still skips spinning tops', strictResult.neutralSkipped, 3);
check('strict spinning tops are not counted', strictResult.confirmed, false);
check('lenient mode still counts them', lenientResult.confirmed, true);

// 6) Too many separate bounces are not one small counter-trend. The newest
//    candle is itself a with-trade bounce, so the third bounce hits the limit
//    before the required three opposite candles are found.
const alternating = [
  down(110, 109), down(109, 108), up(107, 108), down(108, 107),
  up(106, 107), down(107, 106), up(105, 106),
];
const alternatingResult = countRetraceCandles(alternating, 'buy', 3, opts('windowed'));
check('three separate bounces are rejected', alternatingResult.confirmed, false);
check('three separate bounces hit the barrier', alternatingResult.barrierStopped, true);

// 7) Settings: current mode is the default for every category; an explicit
//    'windowed' opt-in resolves per category; invalid/legacy values are safe.
for (const category of ['Forex', 'Crypto', 'Stocks', 'Metals'] as const) {
  check(`${category} default mode`, DEFAULT_STRATEGY_SETTINGS[`retraceMode${category}`], 'consecutive');
  check(`${category} resolves to default`, resolveRetraceConfig(undefined, category.toLowerCase()).mode, 'consecutive');
}
const mixed: any = { ...DEFAULT_STRATEGY_SETTINGS, retraceModeCrypto: 'windowed', retraceModeStocks: 'invalid' };
check('crypto opted in', resolveRetraceConfig(mixed, 'crypto').mode, 'windowed');
check('invalid value stays consecutive', resolveRetraceConfig(mixed, 'stocks').mode, 'consecutive');
check('untouched category stays consecutive', resolveRetraceConfig(mixed, 'metals').mode, 'consecutive');

console.log(ok ? '\nPASS: windowed Retrace mode with mode switch' : '\nFAIL: windowed Retrace mode');
if (!ok) process.exit(1);
