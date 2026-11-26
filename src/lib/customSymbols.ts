import { MarketType } from '../types';
import { TOP_CRYPTO_100 } from '../data/topCrypto100';
import { ALL_SYMBOLS_DB, SYMBOL_CATEGORIES } from '../constants';
import { clientScopeKey, currentUserEmail } from './clientScope';
import { isDeveloperEmail } from './clientIds';

/** Curated app crypto symbols are already USD-quoted (BTCUSD = BINANCE:BTCUSDT). */
const APP_CRYPTO_SYMBOLS = new Set<string>(TOP_CRYPTO_100.map((c) => c.symbol));

/**
 * Custom symbol support — any Binance crypto pair, any TradingView symbol.
 *
 * The curated library (top-100 crypto + the built-in forex/stocks/metals
 * lists) is only a convenience index. A developer or client may type ANY
 * symbol that exists on Binance (crypto) or TradingView (any category):
 *
 *   BTCUSDT          → app BTCUSD        chart BINANCE:BTCUSDT
 *   BTC/USDT         → app BTCUSD        chart BINANCE:BTCUSDT
 *   BINANCE:BTCUSDT  → app BTCUSD        chart BINANCE:BTCUSDT
 *   ETHBTC           → app ETHBTC        chart BINANCE:ETHBTC
 *   NASDAQ:TSLA      → app TSLA          chart NASDAQ:TSLA
 *   FX:EURUSD        → app EURUSD        chart FX:EURUSD
 *   OANDA:XAUUSD     → app XAUUSD        chart OANDA:XAUUSD
 *   TSE:7203         → app 7203.T        chart TSE:7203
 *
 * The clean app symbol is what every engine / trade / history record stores;
 * the explicit TradingView (or Binance) symbol is kept in a small persisted
 * map so charts and market-data fetches resolve exactly what was added.
 */

export const CUSTOM_TV_KEY = 'finalyze_custom_tv_symbols';
export const CUSTOM_SYMBOLS_KEY = 'finalyze_custom_symbols';
export const HIDDEN_SYMBOLS_KEY = 'finalyze_hidden_symbols';

/**
 * Symbol libraries are PER ACCOUNT. A developer keeps the classic global keys
 * (so the two developer devices keep syncing them); every client gets an
 * email-scoped copy, so a symbol added by one paid client can never appear in
 * another account or in the developer's list.
 */
export function customSymbolScopeEmail(email?: string | null): string {
  try {
    const direct = email || currentUserEmail();
    if (direct) return String(direct).toLowerCase().trim();
    const raw = JSON.parse(localStorage.getItem('finalyze_user') || '{}');
    return String(raw?.email || '').toLowerCase().trim();
  } catch {
    return '';
  }
}

export function customStorageKeys(email?: string | null): { symbols: string; hidden: string; tv: string } {
  const e = customSymbolScopeEmail(email);
  let devSession = false;
  try { devSession = localStorage.getItem('finalyze_developer_session') === 'true'; } catch {}
  if (devSession || isDeveloperEmail(e)) {
    return { symbols: CUSTOM_SYMBOLS_KEY, hidden: HIDDEN_SYMBOLS_KEY, tv: CUSTOM_TV_KEY };
  }
  // Guests get their own bucket too — never inherit the developer's library
  // from the classic global keys.
  return {
    symbols: clientScopeKey(e, 'custom_symbols'),
    hidden: clientScopeKey(e, 'hidden_symbols'),
    tv: clientScopeKey(e, 'custom_tv_symbols'),
  };
}

/** Read this account's custom symbol list (never another account's). */
export function readCustomSymbols(email?: string | null): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(customStorageKeys(email).symbols) || '[]');
    return Array.isArray(raw) ? raw.map((s) => String(s).toUpperCase().trim()).filter(Boolean) : [];
  } catch { return []; }
}

export function writeCustomSymbols(list: string[], email?: string | null): void {
  try {
    localStorage.setItem(
      customStorageKeys(email).symbols,
      JSON.stringify([...new Set(list.map((s) => String(s).toUpperCase().trim()).filter(Boolean))]),
    );
  } catch {}
}

/** Read this account's hidden symbol list. */
export function readHiddenSymbols(email?: string | null): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(customStorageKeys(email).hidden) || '[]');
    return Array.isArray(raw) ? raw.map((s) => String(s).toUpperCase().trim()).filter(Boolean) : [];
  } catch { return []; }
}

export function writeHiddenSymbols(list: string[], email?: string | null): void {
  try {
    localStorage.setItem(
      customStorageKeys(email).hidden,
      JSON.stringify([...new Set(list.map((s) => String(s).toUpperCase().trim()).filter(Boolean))]),
    );
  } catch {}
}

/** Restore every hidden symbol for THIS account only. */
export function clearHiddenSymbols(email?: string | null): void {
  try { localStorage.removeItem(customStorageKeys(email).hidden); } catch {}
}

/** Shared category detector (desktop + mobile + radar all use one rule). */
export function detectSymbolCategory(symbol: string): MarketType {
  const s = String(symbol || '').toUpperCase().replace(/[-_=]/g, '');
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(s)) return cat as MarketType;
  }
  if (/XAU|XAG|XPT|XCU|XPD|XAL|GOLD|SILVER/.test(s)) return MarketType.METALS;
  if (/BTC|ETH|BNB|SOL|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|UNI|SHIB|LTC|ATOM/.test(s)) return MarketType.CRYPTO;
  if (/EUR|GBP|JPY|CHF|CAD|AUD|NZD|USD/.test(s)) return MarketType.FOREX;
  return MarketType.STOCKS;
}

/** Custom symbols added by THIS account to one category (trained list included). */
export function customSymbolsForCategory(category: string | MarketType, email?: string | null): string[] {
  const cat = String(category).toLowerCase();
  const tv = readCustomTvMap(email);
  const curated = new Set<string>((ALL_SYMBOLS_DB as any)[cat] || []);
  return readCustomSymbols(email).filter((s) => {
    const mapped = tv[s.toUpperCase()]?.category;
    if (mapped) return String(mapped).toLowerCase() === cat;
    if (curated.has(s)) return true;
    return String(detectSymbolCategory(s)).toLowerCase() === cat;
  });
}

export interface CustomTvEntry {
  /** Full TradingView symbol, e.g. BINANCE:BTCUSDT or NASDAQ:TSLA. */
  tv: string;
  /** Binance spot pair when this is crypto (e.g. BTCUSDT). */
  pair?: string;
  category: MarketType;
  name?: string;
  at: number;
}

export interface NormalizedSymbol {
  /** Clean app symbol stored in analysis results, trades and history. */
  symbol: string;
  /** Explicit chart symbol, when it must differ from the derived one. */
  tv?: string;
  /** Binance pair for crypto symbols. */
  pair?: string;
  category: MarketType;
  /** True when the input carried an explicit exchange / wasn't a plain ticker. */
  custom: boolean;
}

const SUFFIX_BY_TV_EXCHANGE: Record<string, string> = {
  // US (Yahoo needs no suffix)
  NASDAQ: '', NYSE: '', AMEX: '', ARCA: '', BATS: '', CBOE: '',
  // Japan / Asia
  TSE: 'T', JPX: 'T', HKEX: 'HK', HSI: 'HK', SSE: 'SS', SZSE: 'SZ',
  KRX: 'KS', KOSDAQ: 'KQ', SGX: 'SI', ASX: 'AX', NSE: 'NS', BSE: 'BO',
  // Europe
  LON: 'L', LSE: 'L', EPA: 'PA', EURONEXT: 'PA', ETR: 'DE', XETR: 'DE',
  FWB: 'DE', AMS: 'AS', SWX: 'SW', SIX: 'SW', MIL: 'MI', BIT: 'MI',
  STO: 'ST', CPH: 'CO', OSL: 'OL', HEL: 'HE', WSE: 'WA', IST: 'IS',
  // Everything else (crypto/forex/indices/commodities) uses the bare ticker.
  BINANCE: '', BINANCEUS: '', BYBIT: '', OKX: '', COINBASE: '', KRAKEN: '',
  OANDA: '', FX: '', FX_IDC: '', TVC: '', SP: '', DJ: '', CME: '', COMEX: '',
  NYMEX: '', ICE: '', CBOT: '', EUREX: '', CAPITALCOM: '', IG: '',
};

/** Strip a TradingView exchange prefix and any quote separators. */
function splitTvInput(raw: string): { prefix: string; body: string } {
  const text = String(raw || '').trim().replace(/^["']|["']$/g, '');
  const m = text.match(/^([A-Za-z0-9._-]{2,20}):(.+)$/);
  if (!m) return { prefix: '', body: text };
  return { prefix: m[1].toUpperCase(), body: m[2].trim() };
}

function cleanBody(body: string): string {
  return body.toUpperCase().replace(/\s+/g, '').replace(/[/\\_-]/g, '');
}

/**
 * Normalizes a typed symbol into the app symbol + optional explicit TV symbol.
 * Returns null for empty / unusable input.
 */
export function normalizeSymbolInput(raw: string, category: MarketType): NormalizedSymbol | null {
  const { prefix, body } = splitTvInput(raw);
  if (!body) return null;

  // ── Crypto: accept any Binance pair form ────────────────────────────────
  if (category === MarketType.CRYPTO) {
    let pair = cleanBody(body).replace(/(PERP|SWAP)$/, '');
    if (!pair) return null;

    // Idempotency: a curated app symbol (BTCUSD, ETHUSD...) already carries the
    // quote suffix. Appending USDT again used to create bogus BTCUSDUSD twins —
    // "select all" turned 100 curated symbols into ~189 analysis targets.
    if (APP_CRYPTO_SYMBOLS.has(pair)) {
      const binancePair = `${pair.slice(0, -3)}USDT`;
      return {
        symbol: pair,
        tv: `BINANCE:${binancePair}`,
        pair: binancePair,
        category,
        custom: true,
      };
    }

    // A bare coin ticker (e.g. "BTC") is treated as BTCUSDT. A real pair always
    // has a base before its quote (ETHBTC, SOLUSDT, BTCFDUSD...).
    const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];
    const hasQuote = QUOTES.some((q) => pair.endsWith(q) && pair.length > q.length + 1);
    if (!hasQuote && /^[A-Z0-9]{2,10}$/.test(pair)) pair = `${pair}USDT`;
    if (!/^[A-Z0-9]{4,24}$/.test(pair)) return null;

    let appSymbol: string;
    if (pair.endsWith('USDT')) appSymbol = `${pair.slice(0, -4)}USD`;
    else if (pair.endsWith('USDC')) appSymbol = `${pair.slice(0, -4)}USDC`;
    else if (pair.endsWith('FDUSD')) appSymbol = pair;
    else appSymbol = pair;

    return {
      symbol: appSymbol,
      tv: `BINANCE:${pair}`,
      pair,
      category,
      custom: true,
    };
  }

  // ── Non-crypto: accept any TradingView symbol ───────────────────────────
  const clean = cleanBody(body);
  if (!clean || !/^[A-Z0-9.\-=^]{1,30}$/.test(clean)) return null;

  if (prefix) {
    const suffix = SUFFIX_BY_TV_EXCHANGE[prefix];
    // Known exchange with a Yahoo suffix (TSE → .T, LON → .L, ...)
    if (suffix) {
      return { symbol: `${clean}.${suffix}`, tv: `${prefix}:${body.toUpperCase()}`, category, custom: true };
    }
    // Known exchange without a suffix (NASDAQ, FX, OANDA, ...)
    if (suffix === '') {
      return { symbol: clean, tv: `${prefix}:${body.toUpperCase()}`, category, custom: true };
    }
    // Unknown exchange: keep the full TV string so the chart still resolves.
    return { symbol: `${prefix}:${clean}`, tv: `${prefix}:${body.toUpperCase()}`, category, custom: true };
  }

  return { symbol: clean, category, custom: /[.\-=^]/.test(clean) };
}

export function readCustomTvMap(email?: string | null): Record<string, CustomTvEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(customStorageKeys(email).tv) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, CustomTvEntry> = {};
    for (const [key, value] of Object.entries(raw as Record<string, any>)) {
      if (!value || typeof value.tv !== 'string') continue;
      out[key.toUpperCase()] = {
        tv: value.tv,
        pair: typeof value.pair === 'string' ? value.pair : undefined,
        category: value.category,
        name: value.name,
        at: Number(value.at) || 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeCustomTvMap(map: Record<string, CustomTvEntry>, email?: string | null) {
  try { localStorage.setItem(customStorageKeys(email).tv, JSON.stringify(map)); } catch {}
}

/** Persists the explicit chart mapping for a custom symbol. */
export function saveCustomTvEntry(symbol: string, entry: Omit<CustomTvEntry, 'at'> & { at?: number }, email?: string | null) {
  const key = String(symbol || '').toUpperCase().trim();
  if (!key) return;
  const map = readCustomTvMap(email);
  map[key] = { ...entry, at: entry.at || Date.now() };
  writeCustomTvMap(map, email);
}

export function removeCustomTvEntry(symbol: string, email?: string | null) {
  const key = String(symbol || '').toUpperCase().trim();
  if (!key) return;
  const map = readCustomTvMap(email);
  if (map[key]) {
    delete map[key];
    writeCustomTvMap(map, email);
  }
}

/** Explicit TV symbol for an app symbol, when one was registered. */
export function getCustomTvSymbol(symbol: string, email?: string | null): string | undefined {
  const key = String(symbol || '').toUpperCase().trim();
  if (!key) return undefined;
  return readCustomTvMap(email)[key]?.tv;
}

/** Binance pair registered for an app symbol (e.g. BTCUSD → BTCUSDT). */
export function getCustomCryptoPair(symbol: string, email?: string | null): string | undefined {
  const key = String(symbol || '').toUpperCase().trim();
  if (!key) return undefined;
  return readCustomTvMap(email)[key]?.pair;
}

/** Adds a symbol to the persisted custom list (and un-hides it). */
export function addCustomSymbolToList(symbol: string, email?: string | null) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return;
  writeCustomSymbols([...readCustomSymbols(email), s], email);
  writeHiddenSymbols(readHiddenSymbols(email).filter((x) => x !== s), email);
}

/**
 * Normalize + persist + register: the one helper used by the desktop and mobile
 * add-symbol UIs. Returns the clean app symbol (or null when invalid).
 */
export function registerCustomSymbol(raw: string, category: MarketType, email?: string | null): NormalizedSymbol | null {
  const normalized = normalizeSymbolInput(raw, category);
  if (!normalized) return null;
  if (normalized.tv || normalized.pair) {
    saveCustomTvEntry(normalized.symbol, {
      tv: normalized.tv || '',
      pair: normalized.pair,
      category,
    }, email);
  }
  addCustomSymbolToList(normalized.symbol, email);
  return normalized;
}
