import { topPerCategory } from '../src/lib/signalFeed';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

type Sig = { symbol: string; signal: string; confidence: number; category: string; timestamp: string };

const t = new Date().toISOString();
const sig = (symbol: string, signal: string, confidence: number, category = 'forex'): Sig => ({
  symbol, signal, confidence, category, timestamp: t,
});
const ids = (list: Sig[]) => list.map(s => s.symbol);

// A radar pass publishes each completed symbol live. The display rule must be
// "best 3 per category" only — correlated symbols must NOT be deleted before
// the ranking (that used to make good forex signals disappear mid-scan).
const radarFeed: Sig[] = [
  sig('EURUSD', 'strong_buy', 95),
  sig('GBPUSD', 'buy', 90),
  sig('AUDUSD', 'buy', 85),
  sig('NZDUSD', 'strong_buy', 96),
  sig('USDJPY', 'buy', 80),
  sig('EURJPY', 'strong_sell', 93),
  sig('USDCHF', 'sell', 88),
  sig('NZDCAD', 'buy', 84),
  sig('EURGBP', 'buy', 82),
  sig('USDCAD', 'strong_buy', 97),
];

let updated: Sig[] = [];
const publishedCounts: number[] = [];
for (const fresh of radarFeed) {
  // Mirrors updateTopSignals' accumulating set (newest first, one per symbol).
  updated = [fresh, ...updated.filter(s => s.symbol !== fresh.symbol)];
  const published = topPerCategory(updated, 3);
  publishedCounts.push(published.length);
}
check('display grows to 3 and never shrinks during the pass', publishedCounts, [1, 2, 3, 3, 3, 3, 3, 3, 3, 3]);

const final = topPerCategory(updated, 3);
check('final forex set is exactly the best 3', ids(final), ['USDCAD', 'NZDUSD', 'EURUSD']);

// Strong-before-regular beats a higher-confidence regular signal.
const mixed = [
  sig('AUDUSD', 'buy', 99),
  sig('EURUSD', 'strong_buy', 70),
  sig('GBPUSD', 'buy', 85),
  sig('USDJPY', 'buy', 80),
];
check('strong signals outrank regular ones', ids(topPerCategory(mixed, 3)), ['EURUSD', 'AUDUSD', 'GBPUSD']);

// Per-category independence: crypto never pushes forex out of its own slots.
const cross = [
  ...radarFeed.slice(0, 3),
  sig('BTCUSD', 'strong_buy', 99, 'crypto'),
  sig('ETHUSD', 'buy', 92, 'crypto'),
  sig('SOLUSD', 'buy', 88, 'crypto'),
  sig('XAUUSD', 'buy', 91, 'metals'),
];
const crossTop = topPerCategory(cross, 3);
check('forex keeps 3 slots', ids(crossTop.filter(s => s.category === 'forex')), ['EURUSD', 'GBPUSD', 'AUDUSD']);
check('crypto keeps 3 slots', ids(crossTop.filter(s => s.category === 'crypto')), ['BTCUSD', 'ETHUSD', 'SOLUSD']);
check('metals keeps its slot', ids(crossTop.filter(s => s.category === 'metals')), ['XAUUSD']);

// A newly analyzed stronger symbol immediately replaces the weakest card.
const before = topPerCategory(radarFeed.slice(0, 3), 3);
check('before upgrade', ids(before), ['EURUSD', 'GBPUSD', 'AUDUSD']);
const after = topPerCategory([sig('NZDUSD', 'strong_buy', 96), ...radarFeed.slice(0, 3)], 3);
check('after upgrade', ids(after), ['NZDUSD', 'EURUSD', 'GBPUSD']);

console.log(ok ? '\nPASS: radar best-3 signal display' : '\nFAIL: radar best-3 signal display');
if (!ok) process.exit(1);
