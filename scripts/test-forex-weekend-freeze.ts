import { isForexMarketClosedUTC } from '../src/lib/forexClock';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const utc = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));

check('Friday 20:59 UTC is open', isForexMarketClosedUTC(utc(2026, 11, 27, 20, 59)), false);
check('Friday 21:00 UTC is closed', isForexMarketClosedUTC(utc(2026, 11, 27, 21, 0)), true);
check('Saturday is closed', isForexMarketClosedUTC(utc(2026, 11, 28, 12)), true);
check('Sunday 20:59 UTC is closed', isForexMarketClosedUTC(utc(2026, 11, 29, 20, 59)), true);
check('Sunday 21:00 UTC is open', isForexMarketClosedUTC(utc(2026, 11, 29, 21, 0)), false);
check('Monday is open', isForexMarketClosedUTC(utc(2026, 11, 30, 10)), false);

console.log(ok ? '\nPASS: forex weekend clock' : '\nFAIL: forex weekend clock');
if (!ok) process.exit(1);
