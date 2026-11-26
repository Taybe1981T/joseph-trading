/**
 * Regression: a symbol added by one client must stay in that account only,
 * and the desktop/mobile manual Stop control must share ONE abort controller.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  get length(): number { return this.map.size; }
}

(globalThis as any).localStorage = new MemoryStorage();
(globalThis as any).sessionStorage = new MemoryStorage();

let ok = true;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

async function main() {
  const {
    customStorageKeys, registerCustomSymbol, customSymbolsForCategory,
    readCustomSymbols, CUSTOM_SYMBOLS_KEY, CUSTOM_TV_KEY,
  } = await import('../src/lib/customSymbols');
  const { MarketType } = await import('../src/types');
  const {
    beginManualAnalysis, stopManualAnalysis, endManualAnalysis, isManualAnalysisRunning,
  } = await import('../src/services/manualAnalysisControl');

  const clientA = 'client-a@example.com';
  const clientB = 'client-b@example.com';
  const developer = (await import('../src/lib/clientIds')).DEVELOPER_EMAILS[0];

  // Developer keeps the classic global keys so the two developer devices sync.
  check('developer uses global symbol keys', customStorageKeys(developer), {
    symbols: CUSTOM_SYMBOLS_KEY, hidden: 'finalyze_hidden_symbols', tv: CUSTOM_TV_KEY,
  });
  check('guest never inherits the global library', customStorageKeys('').symbols !== CUSTOM_SYMBOLS_KEY, true);

  registerCustomSymbol('XALTEST', MarketType.METALS, clientA);
  check('client A sees own symbol', readCustomSymbols(clientA), ['XALTEST']);
  check('client B cannot see client A symbol', readCustomSymbols(clientB), []);
  check('developer cannot see client A symbol', readCustomSymbols(developer), []);
  check('client A metals group includes it', customSymbolsForCategory('metals', clientA), ['XALTEST']);
  check('client B metals group stays clean', customSymbolsForCategory('metals', clientB), []);

  const first = beginManualAnalysis();
  check('manual analysis is running', isManualAnalysisRunning(), true);
  const second = beginManualAnalysis();
  check('starting a new run stops the old one', first.aborted, true);
  check('stop returns true for an active run', stopManualAnalysis(), true);
  check('signal is aborted', second.aborted, true);
  check('stop clears running state', isManualAnalysisRunning(), false);
  endManualAnalysis();
  check('stop with no active run is harmless', stopManualAnalysis(), false);

  console.log(ok ? '\nPASS: custom symbol scope + manual stop' : '\nFAIL: custom symbol scope + manual stop');
  if (!ok) process.exit(1);
}

void main();
