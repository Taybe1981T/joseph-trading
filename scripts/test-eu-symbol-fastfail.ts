import { AnalysisSymbolNotFoundError, isEuropeanStockSymbol, resolveAnalysisSymbol } from '../src/lib/analysisSymbolAliases';
import { fetchMarketDataDirect } from '../src/services/apiDirect';

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// Data-only aliases: display symbols are unchanged, only provider queries change.
check('Roche alias', resolveAnalysisSymbol('ROG.SW'), 'ROP.SW');
check('LVMH alias', resolveAnalysisSymbol('LVMH.PA'), 'MC.PA');
check('Swedish alias', resolveAnalysisSymbol('SBAB'), 'SBB-B.ST');
check('unknown symbol untouched', resolveAnalysisSymbol('AAPL'), 'AAPL');
check('alias is EU stock', isEuropeanStockSymbol(resolveAnalysisSymbol('ROG.SW')), true);
check('forex is not EU stock', isEuropeanStockSymbol('EURUSD'), false);

// A provider-confirmed missing ticker must stop after ONE server attempt:
// no second server retry, no CSS-proxy waterfall.
const originalFetch = globalThis.fetch;
const urls: string[] = [];
(globalThis as any).fetch = async (url: string) => {
  urls.push(String(url));
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: async () => ({ error: 'Symbol not found' }),
  } as any;
};

let thrown: unknown = null;
try {
  await fetchMarketDataDirect('SBAB', '1d');
} catch (e) {
  thrown = e;
} finally {
  globalThis.fetch = originalFetch;
}

check('definitive 404 throws typed error', thrown instanceof AnalysisSymbolNotFoundError, true);
check('EU bad ticker makes one request only', urls.length, 1);
check('request kept the user-facing symbol', urls[0]?.includes('symbol=SBAB'), true);

console.log(ok ? '\nPASS: EU symbol aliases + fast-fail' : '\nFAIL: EU symbol aliases + fast-fail');
if (!ok) process.exit(1);
