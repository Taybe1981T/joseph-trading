import { db } from '../lib/firebase';
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, query, where, getDocs, Timestamp, writeBatch } from 'firebase/firestore';
import { User } from 'firebase/auth';
import { SYMBOL_CATEGORIES } from '../constants';
import { isExchangeOpen } from '../lib/marketHours';
import { STOCK_CONTRACT_SIZE, currencyToUsdFactor } from '../lib/positionMath';

export interface PaperTrade {
  id: string;
  symbol: string;
  category: string;
  side: 'buy' | 'sell';
  qty: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  status: 'open' | 'closed';
  closeReason?: 'manual' | 'tp' | 'sl';
  tp?: number | null;
  sl?: number | null;
  openedAt: number;
  closedAt?: number;
  // Who owns open/close for this trade. 'auto' = global AutoTradeEngine,
  // 'manual' = the user's own ticket on the trade page. Exactly one engine
  // manages a given trade so SL/TP/trailing is never applied twice.
  source?: 'auto' | 'manual';
}

export const START_BALANCE = 10000;
export const MIN_BALANCE = 500;
export const DEFAULT_LEVERAGE = 100; // 1:100
export const LEVERAGE_OPTIONS = [50, 100, 200, 400, 500];

// Map a stock symbol to its exchange region (us/eu/jp) based on its ticker suffix.
function detectStockExchange(symbol: string): 'us' | 'eu' | 'jp' | null {
  const s = (symbol || '').toUpperCase();
  if (/^\d{4}\.T$/.test(s) || /\.T$/.test(s)) return 'jp';
  if (/\.(AS|PA|SW|DE|L|CO|MI)$/.test(s)) return 'eu';
  return null;
}

// Market opening hours by asset category.
// Crypto trades 24/7; forex/metals trade Mon-Fri with the weekly break
// (Fri 21:00 UTC -> Sun 21:00 UTC); stocks follow their own exchange session
// (US/Europe/Japan) determined by the symbol.
export function isMarketOpen(category: string, symbol?: string, now: Date = new Date()): boolean {
  if (category === 'crypto') return true; // 24/7

  // Stocks/indices: check the specific exchange session for the symbol.
  if (category === 'stocks') {
    const ex = detectStockExchange(symbol || '');
    if (ex && ex !== 'us') return isExchangeOpen(ex, now);
    // Otherwise fall through to default US-session logic below.
  }

  const u = new Date(now.toUTCString());
  const day = u.getUTCDay(); // 0 Sun .. 6 Sat
  const hour = u.getUTCHours() + u.getUTCMinutes() / 60 + u.getUTCSeconds() / 3600;

  if (category === 'forex' || category === 'metals') {
    if (day === 6) return false;               // Saturday closed
    if (day === 5 && hour >= 21) return false; // Friday closes 21:00 UTC
    if (day === 0) return hour >= 21;          // Sunday opens 21:00 UTC
    return true;                               // Monday-Thursday
  }

  // stocks & indices: US market session (approx ET = UTC-5)
  const et = (((hour - 5) % 24) + 24) % 24;
  if (day === 0 || day === 6) return false;    // closed weekends
  return et >= 9.5 && et <= 16;                // 09:30 - 16:00 ET
}

// ---------- Contract specs (TradingView-style) ----------
// Base (per-lot) quantity per category at a $1,000 balance. The lot scales with
// the account: every extra $1,000 adds one base unit (see dynamicLotSize), so a
// $3,000 balance trades 3× the base, a $7,000 balance 7×, etc.
export function baseQtyPerCategory(category: string): number {
  switch (category) {
    case 'crypto': return 0.1;   // 0.1 units of coin per $1,000
    case 'forex': return 0.01;   // 0.01 lots per $1,000 (1 lot = 100,000 units)
    case 'metals': return 0.01;  // 0.01 lots per $1,000 (1 lot = 100 oz)
    case 'stocks': return 0.01;  // 0.01 lots per $1,000 (1 lot = 100 shares)
    default: return 0.01;
  }
}

// How many $1,000 steps the balance represents (minimum 1, so even a $1 balance
// still trades the base size). e.g. $3,000 -> 3, $7,500 -> 7.
export function balanceThousands(balance: number): number {
  const b = Number.isFinite(balance) && balance > 0 ? balance : START_BALANCE;
  return Math.max(1, Math.floor(b / 1000));
}

// Lot size that scales with the account balance: base × thousands.
// $1,000 -> 0.01 (forex), $3,000 -> 0.03, $7,000 -> 0.07, $10,000 -> 0.10.
export function getDefaultQty(category: string, balance: number = START_BALANCE): number {
  const base = baseQtyPerCategory(category);
  const scaled = base * balanceThousands(balance);
  // Keep lot precision tidy (avoid 0.070000000001 style values).
  return Math.round(scaled * 1000) / 1000;
}

// ---------- Dynamic risk (SL/TP in USD) ----------
// Stop-loss / take-profit scale with the account in fixed $5 steps per $1,000,
// anchored at a $1,000 balance. Take-profit is always 2× the stop (1:2 R:R).
//   $1,000 -> SL $15 , TP $30
//   $2,000 -> SL $20 , TP $40
//   $7,000 -> SL $45 , TP $90
export function calcRiskUSD(balance: number): { slUsd: number; tpUsd: number } {
  const thousands = balanceThousands(balance);
  const slUsd = 5 * thousands + 10;
  return { slUsd, tpUsd: slUsd * 2 };
}

export function calcPnl(trade: Pick<PaperTrade, 'category' | 'symbol' | 'side' | 'qty' | 'entryPrice'>, currentPrice: number): number {
  const dir = trade.side === 'buy' ? 1 : -1;
  const diff = (currentPrice - trade.entryPrice) * dir;
  switch (trade.category) {
    case 'forex': {
      // Standard lot = 100k units. USD-quote pairs: P&L in USD directly.
      // Quote-currency pairs (JPY/crosses): convert approximately through price.
      const s = trade.symbol.toUpperCase();
      if (s.endsWith('USD')) return diff * trade.qty * 100000;
      return (diff / Math.max(currentPrice, 0.0001)) * trade.qty * 100000;
    }
    case 'metals':
      return diff * trade.qty * 100; // 1 lot = 100 oz
    case 'crypto':
      return diff * trade.qty;
    case 'stocks': {
      // 0.01 lot = 1 share (contract size 100). Japanese/European stock prices
      // are in local currency, so convert the P&L to USD.
      return diff * trade.qty * STOCK_CONTRACT_SIZE * currencyToUsdFactor(trade.symbol);
    }
    default:
      return diff * trade.qty;
  }
}

export function formatPnl(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${v < 0 ? '' : ''}` .replace('+$', v >= 0 ? '+$' : '-$');
}

// ---------- Price engine ----------
type PriceListener = (price: number) => void;

const _priceCache = new Map<string, { price: number; ts: number }>();
const PRICE_TTL = 1500;
// In-flight de-duplication: several mobile components (watchlist, positions,
// account bar) ask for the SAME symbol at the same time. Without this each one
// fires its own /api/quote request; with it they share a single round trip.
const _priceInflight = new Map<string, Promise<number | null>>();

async function fetchServerLastPrice(symbol: string): Promise<number | null> {
  try {
    // Use the lightweight /api/quote endpoint (real-time spot price) rather than
    // pulling a full 5m candle history. This makes open-trade P&L track the live
    // market instead of freezing to a delayed candle close, and reduces payload.
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    // Do NOT return null here — fall through to the candle fallback below.
    // The /api/quote endpoint doesn't support every symbol (e.g. metals like
    // XAUUSD sometimes 404), and /api/market-data (Yahoo Finance) DOES. Returning
    // null immediately on a non-ok quote response would silently skip the
    // fallback and cause metals/forex signals to never open (pending-queue
    // starvation). Throwing routes us into the catch → candle fallback.
    if (!r.ok) throw new Error(`quote endpoint returned ${r.status}`);
    const d = await r.json();
    const p = Number(d?.price);
    if (typeof p === 'number' && isFinite(p) && p > 0) return p;
  } catch {}
  // Fallback to candle close if the quote route fails (keeps old behaviour).
  try {
    const r2 = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&timeframe=5m`);
    if (r2.ok) {
      const d2 = await r2.json();
      const closes = d2?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (Array.isArray(closes)) {
        for (let i = closes.length - 1; i >= 0; i--) {
          const c = closes[i];
          if (c != null && c > 0) return c;
        }
      }
    }
  } catch {}
  return null;
}

export async function getLivePrice(symbol: string): Promise<number | null> {
  const cached = _priceCache.get(symbol);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.price;

  // Coalesce concurrent requests for the same symbol into one network call.
  const pending = _priceInflight.get(symbol);
  if (pending) return pending;

  // Route ALL assets (crypto, forex, metals, indices) through the backend
  // server proxy /api/market-data. The server resolves crypto -> Binance and
  // forex/metals -> Yahoo/TwelveData server-side, bypassing browser CORS.
  // No browser-direct Binance calls (CORS-blocked) and no unreliable external
  // CORS proxies (corsproxy.io/allorigins often fail with 403).
  const request = fetchServerLastPrice(symbol)
    .then((price) => {
      if (price != null) {
        _priceCache.set(symbol, { price, ts: Date.now() });
      }
      return price;
    })
    .finally(() => {
      _priceInflight.delete(symbol);
    });

  _priceInflight.set(symbol, request);
  return request;
}

// ── Shared quote hub ────────────────────────────────────────────────────────
// Every mobile surface (watchlist, positions list, account header, ticket)
// needs live prices at the same time. Each one used to run its own timer and
// issue its own /api/quote request per symbol, which multiplied into dozens
// of redundant round trips per second on mobile data.
//
// The hub keeps ONE timer for the whole app, batches every interested symbol
// into a single /api/quotes request, and fans the result out to subscribers.
type HubListener = (symbol: string, price: number) => void;
type HubBatchListener = (prices: Map<string, number>) => void;

const _hubListeners = new Map<string, Set<HubListener>>();
const _hubBatchListeners = new Set<HubBatchListener>();
const _hubPrices = new Map<string, number>();
let _hubTimer: ReturnType<typeof setInterval> | null = null;
let _hubBusy = false;
let _hubInFlight: Promise<void> | null = null;

const HUB_INTERVAL = 1000;

/** Subscribe to live prices for a symbol. Returns an unsubscribe function. */
export function subscribeQuote(symbol: string, listener: HubListener): () => void {
  const sym = (symbol || '').trim().toUpperCase();
  if (!sym) return () => {};
  let set = _hubListeners.get(sym);
  if (!set) { set = new Set(); _hubListeners.set(sym, set); }
  set.add(listener);
  startHub();
  // Deliver the last known price immediately so the UI is never empty.
  const last = _hubPrices.get(sym);
  if (last != null) { try { listener(sym, last); } catch {} }
  return () => {
    const s = _hubListeners.get(sym);
    if (!s) return;
    s.delete(listener);
    if (!s.size) _hubListeners.delete(sym);
    maybeStopHub();
  };
}

/** Last price the hub has seen for a symbol (no network call). */
export function getCachedQuote(symbol: string): number | null {
  const p = _hubPrices.get((symbol || '').trim().toUpperCase());
  return p == null ? null : p;
}

/**
 * Subscribe to a set of symbols in ONE callback per tick.
 * Far cheaper than per-symbol subscriptions: the listener is invoked once
 * with every price that changed, so the consumer can commit a single
 * state update instead of one per symbol.
 */
export function subscribeQuoteBatch(symbols: string[], listener: HubBatchListener): () => void {
  const unique = [...new Set((symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean))];
  // Register each symbol so the hub knows to include it in the batch request.
  const unsubs = unique.map((sym) => subscribeQuote(sym, () => {}));
  _hubBatchListeners.add(listener);
  startHub();
  return () => {
    _hubBatchListeners.delete(listener);
    for (const u of unsubs) u();
    maybeStopHub();
  };
}

/**
 * Subscribe to a LIST of symbols. Kept for the desktop watchlist
 * (TradeNowPage) — implemented on top of the shared hub so desktop and mobile
 * share a single polling loop and a single batched request.
 */
export function subscribePrices(symbols: string[], listener: (symbol: string, price: number) => void): () => void {
  const unique = [...new Set((symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean))];
  const unsubs = unique.map((sym) => subscribeQuote(sym, listener));
  return () => { for (const u of unsubs) u(); };
}

function startHub() {
  if (_hubTimer != null) return;
  _hubTimer = setInterval(() => { void hubTick(); }, HUB_INTERVAL);
  void hubTick();
}

// Stop the shared timer once nothing is subscribed any more, so a backgrounded
// tab (or a fully closed watchlist) doesn't keep polling.
function maybeStopHub() {
  if (_hubListeners.size || _hubBatchListeners.size) return;
  if (_hubTimer != null) { clearInterval(_hubTimer); _hubTimer = null; }
}

async function hubTick() {
  if (_hubBusy) return;
  const symbols = [..._hubListeners.keys()];
  if (!symbols.length && !_hubBatchListeners.size) return;
  _hubBusy = true;
  _hubInFlight = (async () => {
    try {
      const prices = await fetchBatchPrices(symbols);
      for (const [sym, price] of prices) {
        _hubPrices.set(sym, price);
        const set = _hubListeners.get(sym);
        if (!set) continue;
        for (const l of set) { try { l(sym, price); } catch {} }
      }
      // Batch listeners get everything in a single callback.
      if (_hubBatchListeners.size && prices.size) {
        for (const l of _hubBatchListeners) { try { l(prices); } catch {} }
      }
    } catch {}
  })();
  try { await _hubInFlight; } finally { _hubBusy = false; _hubInFlight = null; }
}

/**
 * Fetch live prices for MANY symbols in one HTTP request.
 * Uses the same batched endpoint as the quote hub.
 */
export async function getLivePrices(symbols: string[]): Promise<Map<string, number>> {
  const unique = [...new Set((symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean))];
  if (!unique.length) return new Map();
  return fetchBatchPrices(unique);
}

// The server caps a single /api/quotes request at 40 symbols. Larger sets are
// split into chunks and fetched in parallel so nothing is silently dropped.
const BATCH_LIMIT = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Fetch several quotes in ONE /api/quotes request (chunked if needed).
// Falls back to per-symbol requests when the batch endpoint is unavailable.
async function fetchBatchPrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const chunks = chunk(symbols, BATCH_LIMIT);

  const batchOk = await Promise.all(chunks.map(async (chunkSymbols) => {
    try {
      const r = await fetch(`/api/quotes?symbols=${encodeURIComponent(chunkSymbols.join(','))}`);
      if (!r.ok) return false;
      const d = await r.json();
      const quotes = d?.quotes || {};
      for (const sym of chunkSymbols) {
        const p = Number(quotes[sym]?.price);
        if (typeof p === 'number' && isFinite(p) && p > 0) {
          out.set(sym, p);
          _priceCache.set(sym, { price: p, ts: Date.now() });
        }
      }
      return true;
    } catch { return false; }
  }));

  // If ANY chunk failed, fill the gaps with per-symbol fetches
  // (these share the cache / in-flight dedup and are much cheaper).
  if (batchOk.some((ok) => !ok)) {
    const missing = symbols.filter((sym) => !out.has(sym));
    await Promise.all(missing.map(async (sym) => {
      const p = await getLivePrice(sym);
      if (p != null && p > 0) out.set(sym, p);
    }));
  }
  return out;
}

// ---------- Storage adapters ----------
interface TradeStore {
  getAccount(): Promise<{ balance: number; leverage: number }>;
  saveBalance(balance: number): Promise<void>;
  saveLeverage(leverage: number): Promise<void>;
  listTrades(): Promise<PaperTrade[]>;
  addTrade(t: Omit<PaperTrade, 'id'>): Promise<string>;
  updateTrade(id: string, patch: Partial<PaperTrade>): Promise<void>;
  resetAccount(newBalance: number): Promise<void>;
  clearHistory(): Promise<void>;
}

class LocalStore implements TradeStore {
  private key = 'paper_trading_data';
  private read(): { balance: number; leverage: number; trades: PaperTrade[] } {
    try {
      const d = JSON.parse(localStorage.getItem(this.key) || '') || { balance: START_BALANCE, trades: [] };
      return { leverage: d.leverage ?? DEFAULT_LEVERAGE, balance: d.balance, trades: d.trades };
    } catch { return { balance: START_BALANCE, leverage: DEFAULT_LEVERAGE, trades: [] }; }
  }
  private write(data: { balance: number; leverage: number; trades: PaperTrade[] }) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
  async getAccount() { const d = this.read(); return { balance: d.balance, leverage: d.leverage }; }
  async saveBalance(balance: number) { const d = this.read(); d.balance = balance; this.write(d); }
  async saveLeverage(leverage: number) { const d = this.read(); d.leverage = leverage; this.write(d); }
  async listTrades() { return this.read().trades; }
  async addTrade(t: Omit<PaperTrade, 'id'>) {
    const d = this.read();
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    d.trades.unshift({ ...t, id });
    this.write(d);
    return id;
  }
  async updateTrade(id: string, patch: Partial<PaperTrade>) {
    const d = this.read();
    const idx = d.trades.findIndex((t) => t.id === id);
    if (idx >= 0) { d.trades[idx] = { ...d.trades[idx], ...patch }; this.write(d); }
  }
  async resetAccount(newBalance: number) {
    this.write({ balance: newBalance, leverage: DEFAULT_LEVERAGE, trades: [] });
  }
  async clearHistory() {
    const d = this.read();
    d.trades = d.trades.filter((t) => t.status === 'open');
    this.write(d);
  }
}

class FirestoreStore implements TradeStore {
  constructor(private uid: string) {}
  async getAccount() {
    const snap = await getDoc(doc(db, 'paper_accounts', this.uid));
    if (!snap.exists()) {
      await setDoc(doc(db, 'paper_accounts', this.uid), { balance: START_BALANCE, leverage: DEFAULT_LEVERAGE, createdAt: Timestamp.now() });
      return { balance: START_BALANCE, leverage: DEFAULT_LEVERAGE };
    }
    return { balance: snap.data().balance ?? START_BALANCE, leverage: snap.data().leverage ?? DEFAULT_LEVERAGE };
  }
  async saveBalance(balance: number) {
    await setDoc(doc(db, 'paper_accounts', this.uid), { balance, updatedAt: Timestamp.now() }, { merge: true });
  }
  async saveLeverage(leverage: number) {
    await setDoc(doc(db, 'paper_accounts', this.uid), { leverage, updatedAt: Timestamp.now() }, { merge: true });
  }
  async listTrades(): Promise<PaperTrade[]> {
    const q = query(collection(db, 'paper_trades'), where('uid', '==', this.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PaperTrade[];
  }
  async addTrade(t: Omit<PaperTrade, 'id'>) {
    const ref = await addDoc(collection(db, 'paper_trades'), { ...t, uid: this.uid });
    return ref.id;
  }
  async updateTrade(id: string, patch: Partial<PaperTrade>) {
    await updateDoc(doc(db, 'paper_trades', id), patch as any);
  }
  async resetAccount(newBalance: number) {
    await setDoc(doc(db, 'paper_accounts', this.uid), { balance: newBalance, startBalance: newBalance, leverage: DEFAULT_LEVERAGE, updatedAt: Timestamp.now() }, { merge: true });
    const snap = await getDocs(query(collection(db, 'paper_trades'), where('uid', '==', this.uid)));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  async clearHistory() {
    const snap = await getDocs(query(collection(db, 'paper_trades'), where('uid', '==', this.uid), where('status', '==', 'closed')));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export function getTradeStore(user: User | null): TradeStore {
  if (user?.uid) return new FirestoreStore(user.uid);
  return new LocalStore();
}
