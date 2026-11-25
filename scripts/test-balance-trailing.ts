import { calcTrailingStop } from '../src/lib/trailingStop';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// 1) Balance-based activation / step, identical for every lot size.
// The activation is floored by one full step so the stop can NEVER sit at entry.
const expectations = [
  { balance: 1000, activationUSD: 5, stepUSD: 5 },
  { balance: 2000, activationUSD: 7, stepUSD: 7 },
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

// 3) A trivial profit must NOT move the stop. The old code returned offset 0
// (entry price) on the first positive tick, which closed trades at breakeven.
const flat = calcTrailingStop({ qty: 0.01, openPnlUSD: 0, balance: 1000 });
const tiny = calcTrailingStop({ qty: 0.01, openPnlUSD: 2, balance: 1000 });
const oneStep = calcTrailingStop({ qty: 0.01, openPnlUSD: 5, balance: 1000 });
check('flat trade stays inactive', flat.active, false);
check('tiny profit does not move the stop', [tiny.active, tiny.offsetUSD], [false, 0]);
check('first full step locks one step, never breakeven', [oneStep.active, oneStep.offsetUSD], [true, 5]);
check('no NaN in result', [tiny.activationUSD, tiny.stepUSD].every(Number.isFinite), true);

// 4) Ratchet: every completed window locks one full step above entry.
const at45 = calcTrailingStop({ qty: 0.01, openPnlUSD: 45, balance: 10000 });
const at90 = calcTrailingStop({ qty: 0.01, openPnlUSD: 90, balance: 10000 });
const at135 = calcTrailingStop({ qty: 0.01, openPnlUSD: 135, balance: 10000 });
check('profit 45 locks 23 (never entry)', at45.offsetUSD, 23);
check('profit 90 locks 46', at90.offsetUSD, 46);
check('profit 135 locks 69', at135.offsetUSD, 69);
check('ratchet never decreases', [at45.offsetUSD, at90.offsetUSD, at135.offsetUSD].every((v, i, a) => i === 0 || v >= a[i - 1]), true);

// 5) The same rule applies to every category — only the balance is an input.
check('category-neutral', calcTrailingStop({ qty: 0.01, openPnlUSD: 50, balance: 10000 }).offsetUSD,
  calcTrailingStop({ qty: 99, openPnlUSD: 50, balance: 10000 }).offsetUSD);

console.log(ok ? '\nPASS: balance-based trailing never parks the stop at entry' : '\nFAIL');
if (!ok) process.exitCode = 1;
