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
const PRICE_TTL = 1000;

async function fetchServerLastPrice(symbol: string): Promise<number | null> {
  try {
    // Use the lightweight /api/quote endpoint (real-time spot price) rather than
    // pulling a full 5m candle history. This makes open-trade P&L track the live
    // market instead of freezing to a delayed candle close, and reduces payload.
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!r.ok) return null;
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

  // Route ALL assets (crypto, forex, metals, indices) through the backend
  // server proxy /api/market-data. The server resolves crypto -> Binance and
  // forex/metals -> Yahoo/TwelveData server-side, bypassing browser CORS.
  // No browser-direct Binance calls (CORS-blocked) and no unreliable external
  // CORS proxies (corsproxy.io/allorigins often fail with 403).
  const price = await fetchServerLastPrice(symbol);

  if (price != null) {
    _priceCache.set(symbol, { price, ts: Date.now() });
  }
  return price;
}

// Poll prices for a list of symbols, calling listener on each update.
export function subscribePrices(symbols: string[], listener: (symbol: string, price: number) => void): () => void {
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    const unique = [...new Set(symbols)];
    await Promise.all(unique.map(async (sym) => {
      const p = await getLivePrice(sym);
      if (p != null && alive) listener(sym, p);
    }));
  };
  tick();
  const iv = setInterval(tick, 1000);
  return () => { alive = false; clearInterval(iv); };
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
