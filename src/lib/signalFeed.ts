import { SYMBOL_CATEGORIES, ALL_SYMBOLS_DB } from '../constants';

/**
 * One displayed signal per symbol + timeframe. The developer feed is published
 * from several places (radar settle, startup sync, debounced state sync), so a
 * duplicate could reach `shared_results` and then be rendered twice on mobile.
 * Keep the FIRST occurrence (callers pass the newest / highest-ranked first).
 */
export function dedupeSignals<T = any>(list: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const rec = item as any;
    const sym = String(rec?.symbol || '').toUpperCase().trim();
    if (!sym) continue;
    const tf = String(rec?.timeframe || '').toLowerCase().trim();
    const key = `${sym}_${tf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Desktop parity: resolve a symbol to its market category. */
export function getSymbolCategory(symbol: string): string {
  const sym = String(symbol || '').toUpperCase().replace(/[-_=]/g, '');
  if (!sym) return 'other';
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  for (const [cat, syms] of Object.entries(ALL_SYMBOLS_DB)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  if (sym.endsWith('USD') && !sym.startsWith('USD') && sym.length > 6) return 'crypto';
  if (/\.(T|AS|PA|DE|L|SW|CO)$/.test(String(symbol))) return 'stocks';
  return 'forex';
}
