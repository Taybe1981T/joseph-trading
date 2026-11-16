import { SYMBOL_CATEGORIES, ALL_SYMBOLS_DB } from '../constants';
import { readCustomTvMap } from './customSymbols';

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

const CAT_ORDER = ['forex', 'crypto', 'stocks', 'metals', 'energy', 'indices', 'custom', 'other'];

/** Strong signals first, then the highest confidence. */
export function compareSignalRank(a: any, b: any): number {
  const strongA = a?.signal === 'strong_buy' || a?.signal === 'strong_sell' ? 1 : 0;
  const strongB = b?.signal === 'strong_buy' || b?.signal === 'strong_sell' ? 1 : 0;
  return (
    strongB - strongA ||
    (Number(b?.confidence) || 0) - (Number(a?.confidence) || 0) ||
    new Date(a?.timestamp || 0).getTime() - new Date(b?.timestamp || 0).getTime() ||
    String(a?.symbol || '').localeCompare(String(b?.symbol || ''))
  );
}

/**
 * The canonical "best signals" rule used by the display AND by auto-trading:
 * de-dupe, group by market category, keep the top `limit` (strong first, then
 * confidence) and return them in the fixed category order. Using the same
 * helper everywhere guarantees the number of automatically opened trades
 * matches the number of displayed signals — no more, no less.
 */
export function topPerCategory<T = any>(list: readonly T[] | null | undefined, limit = 3): T[] {
  const unique = dedupeSignals(list);
  const groups = new Map<string, T[]>();
  for (const item of unique) {
    const rec = item as any;
    if (!rec || rec.signal === 'neutral' || rec.signal === 'no_entry' || rec.isSideways) continue;
    const cat = String(rec.category || getSymbolCategory(String(rec.symbol || '')));
    const arr = groups.get(cat);
    if (arr) arr.push(item);
    else groups.set(cat, [item]);
  }
  const cats = [...groups.keys()].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const out: T[] = [];
  for (const cat of cats) {
    out.push(...(groups.get(cat) as T[]).slice().sort(compareSignalRank).slice(0, Math.max(1, limit)));
  }
  return out;
}

/** Normalizes a category label; every stocks sub-category collapses to 'stocks'. */
export function normalizeCategory(cat: string | null | undefined): string | null {
  const c = String(cat || '').toLowerCase().trim();
  if (!c) return null;
  if (c.startsWith('stocks')) return 'stocks';
  return c;
}

/** Fiat currency codes — used to tell a 6-letter FX pair from a crypto coin. */
const FIAT_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNH', 'CNY',
  'MXN', 'SEK', 'NOK', 'DKK', 'PLN', 'TRY', 'ZAR', 'SGD', 'HKD', 'CZK', 'HUF',
]);

/**
 * One category resolver for the WHOLE app — desktop display, mobile display and
 * the auto-trade engine all call this. It first honours an explicitly registered
 * custom symbol (any Binance / TradingView symbol the developer added), so those
 * signals appear under the category they were added to instead of falling back
 * to "forex" and looking like they are missing.
 */
export function getSymbolCategory(symbol: string): string {
  const raw = String(symbol || '');
  const key = raw.toUpperCase().trim();
  const sym = key.replace(/[-_=]/g, '');
  if (!sym) return 'other';
  // 1) Explicit custom mapping (Binance pair / TradingView exchange symbol).
  try {
    const mapped = normalizeCategory(readCustomTvMap()[key]?.category);
    if (mapped) return mapped;
  } catch { /* storage unavailable */ }
  // 2) Curated library.
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  for (const [cat, syms] of Object.entries(ALL_SYMBOLS_DB)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  // 3) Obvious families when the symbol is not in the library.
  if (/^(XAU|XAG|XPT|XPD|XCU|XAL)/.test(sym)) return 'metals';
  if (/(USDT|USDC|FDUSD|BUSD|TUSD)$/.test(sym)) return 'crypto';
  if (sym.endsWith('USD')) {
    const base = sym.slice(0, -3);
    if (base && !FIAT_CODES.has(base)) return 'crypto';
  }
  if (/^[A-Z]{6}$/.test(sym)) {
    if (FIAT_CODES.has(sym.slice(0, 3)) && FIAT_CODES.has(sym.slice(3))) return 'forex';
  }
  if (/\.(T|AS|PA|DE|L|SW|CO|HK|SS|SZ|KS|KQ|SI|AX|NS|BO|MI|ST|OL|HE|WA|IS)$/.test(key)) return 'stocks';
  return 'forex';
}

/**
 * Ensures EVERY signal carries its resolved category. Publishers call this
 * before writing `shared_results`, so desktop, mobile and every free/guest
 * mirror render the exact same grouping (previously a custom symbol or an
 * energy/index signal could silently fall into the wrong bucket).
 */
export function attachCategories<T = any>(list: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const rec = item as any;
    if (!rec || typeof rec !== 'object') return item;
    const cat = normalizeCategory(rec.category) || getSymbolCategory(String(rec.symbol || ''));
    if (rec.category === cat) return item;
    return { ...rec, category: cat };
  });
}
