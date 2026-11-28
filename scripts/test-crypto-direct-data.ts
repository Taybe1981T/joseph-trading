import { fetchMarketDataDirect } from '../src/services/apiDirect';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// 12 valid Binance klines: [openTime, O, H, L, C, volume, ...]
const klines = Array.from({ length: 12 }, (_, i) => [
  String(1700000000000 + i * 86400000),
  '100', '105', '95', String(100 + i), '1000', '0', '0', '0', '0', '0', '0',
]);

const originalFetch = globalThis.fetch;
const urls: string[] = [];
(globalThis as any).fetch = async (url: string) => {
  urls.push(String(url));
  if (String(url).includes('binance')) {
    return { ok: true, status: 200, json: async () => klines } as any;
  }
  return { ok: false, status: 500, statusText: 'Server Error' } as any;
};

try {
  const data = await fetchMarketDataDirect('BTCUSD', '1d');
  check('direct Binance candles parsed', data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.length, 12);
  check('kept the user-facing symbol', data?.chart?.result?.[0]?.meta?.symbol, 'BTCUSD');
  check('no serverless round-trip', urls.some(u => u.includes('/api/market-data')), false);
  check('two Binance mirrors raced', urls.filter(u => u.includes('binance')).length, 2);

  // Fresh call is served from the 2-minute cache: no extra network at all.
  await fetchMarketDataDirect('BTCUSD', '1d');
  check('cached without new requests', urls.length, 2);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(ok ? '\nPASS: crypto data goes direct to Binance' : '\nFAIL: crypto direct data');
if (!ok) process.exit(1);
