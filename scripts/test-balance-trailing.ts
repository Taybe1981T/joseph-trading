import { calcTrailingStop } from '../src/lib/trailingStop';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// 1) Balance-based activation / step, identical for every lot size.
const expectations = [
  { balance: 1000, activationUSD: 0, stepUSD: 5 },
  { balance: 2000, activationUSD: 5, stepUSD: 7 },
  { balance: 10000, activationUSD: 45, stepUSD: 23 },
  { balance: 20000, activationUSD: 95, stepUSD: 43 },
];
for (const e of expectations) {
  const r = calcTrailingStop({ qty: 0.01, openPnlUSD: 0, balance: e.balance });
  check(`balance ${e.balance} activation`, r.activationUSD, e.activationUSD);
  check(`balance ${e.balance} step`, r.stepUSD, e.stepUSD);
}

// 2) Lot size must have ZERO effect (the old bug closed trades early).
const small = calcTrailingStop({ qty: 0.01, openPnlUSD: 100, balance: 10000 });
const huge = calcTrailingStop({ qty: 10, openPnlUSD: 100, balance: 10000 });
check('lot-size independence', [small.activationUSD, small.stepUSD, small.offsetUSD], [huge.activationUSD, huge.stepUSD, huge.offsetUSD]);

// 3) Zero activation at $1,000 is safe (no divide-by-zero, no flat-trade move).
const flat = calcTrailingStop({ qty: 0.01, openPnlUSD: 0, balance: 1000 });
const tiny = calcTrailingStop({ qty: 0.01, openPnlUSD: 2, balance: 1000 });
check('flat trade stays inactive', flat.active, false);
check('first profit arms at breakeven', [tiny.active, tiny.offsetUSD], [true, 0]);
check('no NaN in result', [tiny.activationUSD, tiny.stepUSD].every(Number.isFinite), true);

// 4) Ratchet: first window secures breakeven, later windows lock one step each.
const at45 = calcTrailingStop({ qty: 0.01, openPnlUSD: 45, balance: 10000 });
const at90 = calcTrailingStop({ qty: 0.01, openPnlUSD: 90, balance: 10000 });
const at135 = calcTrailingStop({ qty: 0.01, openPnlUSD: 135, balance: 10000 });
check('profit 45 locks breakeven', at45.offsetUSD, 0);
check('profit 90 locks 46', at90.offsetUSD, 46);
check('profit 135 locks 69', at135.offsetUSD, 69);

console.log(ok ? 'PASS: balance-based trailing rule' : 'FAIL');
if (!ok) process.exitCode = 1;
