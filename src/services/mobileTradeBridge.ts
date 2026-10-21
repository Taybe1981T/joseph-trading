/**
 * Mobile Trade Bridge — desktop parity for paper trading on the mobile app.
 *
 * Desktop (App.tsx + autoTradeEngine.ts + paperTradingService.ts) behaviour, mirrored 1:1:
 *  - Same stores: FirestoreStore when a Firebase uid exists, otherwise LocalStore
 *    (key 'paper_trading_data') — so the SAME account data is shared with desktop.
 *  - Manual ticket: opens ONE PaperTrade with live price, category-aware qty.
 *  - Auto engine: ONE shared AutoTradeEngine fed with the SAME home-page signals.
 *  - Toggle key 'paper_trading_auto_trade': ON unless explicitly '0' (default ON).
 */
import {
  getTradeStore,
  getLivePrice,
  getLivePrices,
  getDefaultQty,
  calcPnl,
  calcRiskUSD,
  type PaperTrade,
} from './paperTradingService';
import { AutoTradeEngine } from './autoTradeEngine';
import { SignalType, type AnalysisResult } from '../types';
import { SYMBOL_CATEGORIES } from '../constants';

export const MOBILE_AUTO_TRADE_KEY = 'paper_trading_auto_trade';

export function isMobileAutoTradeOn(): boolean {
  try { return localStorage.getItem(MOBILE_AUTO_TRADE_KEY) !== '0'; } catch { return true; }
}

export function setMobileAutoTrade(on: boolean): void {
  try { localStorage.setItem(MOBILE_AUTO_TRADE_KEY, on ? '1' : '0'); } catch {}
  try { window.dispatchEvent(new CustomEvent('finalyze-auto-trade-changed', { detail: { on } })); } catch {}
}

/** Firebase user stub from the desktop's localStorage session (or null → LocalStore). */
export function mobileTradeUser(): { uid: string } | null {
  try {
    const raw = localStorage.getItem('finalyze_user');
    const o = raw ? JSON.parse(raw) : {};
    const uid = String(o?.uid || '');
    return uid ? { uid } : null;
  } catch { return null; }
}

export function detectMobileTradeCategory(sym: string): string {
  const s = (sym || '').toUpperCase().replace(/[-_=]/g, '');
  try {
    for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES as any)) {
      if (Array.isArray(syms) && (syms as string[]).includes(s)) return cat;
    }
  } catch {}
  if (/^[A-Z]{6}$/.test(s)) return 'forex';
  if (/BTC|ETH|USDT|COIN|DOGE/.test(s)) return 'crypto';
  if (/XAU|XAG|GOLD|SILVER/.test(s)) return 'metals';
  return 'stocks';
}

export async function listMobileTrades(): Promise<PaperTrade[]> {
  const store = getTradeStore(mobileTradeUser() as any);
  try { return await store.listTrades(); } catch { return []; }
}

export async function readMobileAccount(): Promise<{ balance: number; leverage: number }> {
  const store = getTradeStore(mobileTradeUser() as any);
  try { return await store.getAccount(); } catch { return { balance: 10000, leverage: 100 }; }
}
/**
 * Open a manual trade — same math as the desktop ticket:
 * live price entry, category + balance aware qty, signal TP/SL when linked.
 */
export async function openMobileManualTrade(
  symbol: string,
  side: 'buy' | 'sell',
  volume?: number,
  signal?: AnalysisResult | null,
): Promise<PaperTrade> {
  const sym = (symbol || '').trim().toUpperCase();
  if (!sym) throw new Error('empty symbol');
  const store = getTradeStore(mobileTradeUser() as any);
  const price = await getLivePrice(sym);
  if (price == null || !isFinite(price) || price <= 0) throw new Error('no live price for ' + sym);
  const category = detectMobileTradeCategory(sym);
  let qty = Number(volume);
  if (!isFinite(qty) || qty <= 0) {
    try {
      const acc = await store.getAccount();
      qty = getDefaultQty(category, acc.balance);
    } catch { qty = getDefaultQty(category, 10000); }
  }
  let sl: number | null = signal?.stopLoss ?? null;
  let tp: number | null = signal?.takeProfit ?? null;
  if (sl == null || tp == null) {
    try {
      const acc = await store.getAccount();
      const risk = calcRiskUSD(acc.balance);
      const q = Math.max(qty, 0.0001);
      if (sl == null) sl = side === 'buy' ? price - risk.slUsd / q : price + risk.slUsd / q;
      if (tp == null) tp = side === 'buy' ? price + risk.tpUsd / q : price - risk.tpUsd / q;
    } catch {}
  }
  const row: Omit<PaperTrade, 'id'> = {
    symbol: sym, category, side, qty, entryPrice: price, status: 'open',
    sl: sl ?? null, tp: tp ?? null, openedAt: Date.now(), source: 'manual',
  };
  const id = await store.addTrade(row);
  try { window.dispatchEvent(new CustomEvent('mobile-trades-changed', { detail: { action: 'open', id, symbol: sym } })); } catch {}
  return { ...row, id };
}

/** Close (manual) a trade — desktop parity: status closed, reason manual, live exit price. */
export async function closeMobileTrade(id: string): Promise<void> {
  if (!id) return;
  const store = getTradeStore(mobileTradeUser() as any);
  try {
    const all = await store.listTrades();
    const t = all.find((x) => x.id === id);
    if (t) {
      const p = await getLivePrice(t.symbol);
      const cur = p ?? t.entryPrice;
      const pnl = calcPnl(t, cur);
      await store.updateTrade(id, { status: 'closed', closeReason: 'manual', exitPrice: cur, pnl, closedAt: Date.now() });
      // Desktop parity: realized P&L must move the balance (TradeNowPage/auto engine do this).
      try {
        const acc = await store.getAccount();
        await store.saveBalance((acc.balance ?? 0) + pnl);
      } catch {}
    }
  } catch { /* best effort */ }
  try { window.dispatchEvent(new CustomEvent('mobile-trades-changed', { detail: { action: 'close', id } })); } catch {}
}

/** Update SL/TP of an open trade from chart drag or the position card editor. */
export async function updateMobileTradeLevels(id: string, sl: number | null, tp: number | null): Promise<void> {
  if (!id) return;
  const store = getTradeStore(mobileTradeUser() as any);
  try {
    await store.updateTrade(id, { sl, tp });
  } catch { /* best effort */ }
  try { window.dispatchEvent(new CustomEvent('mobile-trades-changed', { detail: { action: 'levels', id } })); } catch {}
}

// ── Shared mobile auto engine (mirrors App.tsx wiring) ──
let mobileEngine: AutoTradeEngine | null = null;

// ── Mobile position manager (desktop parity: TradeNowPage managePositions) ──
// Runs in the background on the mobile app: for EVERY open trade (auto AND
// manual) it checks live price → TP/SL close (balance += P&L) and the dynamic
// trailing stop (same calcTrailingStop rule + strategy_settings tunables).
// Without this, auto trades opened on mobile would sit unmanaged.
let posMgrTimer: ReturnType<typeof setInterval> | null = null;

function loadMobileTrailing(): { enabled: boolean; baseActivationUSD: number; baseStepUSD: number; activationLotStep: number; stepLotStep: number } {
  const fallback = { enabled: true, baseActivationUSD: 5, baseStepUSD: 2, activationLotStep: 2, stepLotStep: 1 };
  try {
    const s = JSON.parse(localStorage.getItem('strategy_settings') || '{}');
    return {
      enabled: (s as any).trailingEnabled ?? fallback.enabled,
      baseActivationUSD: (s as any).trailingBaseActivationUSD ?? fallback.baseActivationUSD,
      baseStepUSD: (s as any).trailingBaseStepUSD ?? fallback.baseStepUSD,
      activationLotStep: (s as any).trailingActivationLotStep ?? fallback.activationLotStep,
      stepLotStep: (s as any).trailingStepLotStep ?? fallback.stepLotStep,
    };
  } catch { return fallback; }
}

async function mobileManagePositions(): Promise<void> {
  let store: ReturnType<typeof getTradeStore>;
  try { store = getTradeStore(mobileTradeUser() as any); } catch { return; }
  let all: PaperTrade[];
  let balance: number;
  try {
    all = await store.listTrades();
    balance = (await store.getAccount()).balance;
  } catch { return; }
  const open = all.filter((t) => t.status === 'open');
  if (!open.length) return;
  const cfg = loadMobileTrailing();
  let changed = false;
  // ONE batched price fetch for every open position instead of one
  // sequential /api/quote request per position.
  const priceMap = new Map<string, number>();
  try {
    const fetched = await getLivePrices([...new Set(open.map((t) => t.symbol))]);
    for (const [s, p] of fetched) if (p > 0) priceMap.set(s, p);
  } catch {
    for (const t of open) {
      try { const p = await getLivePrice(t.symbol); if (p != null && p > 0) priceMap.set(t.symbol, p); } catch {}
    }
  }
  for (const t of open) {
    const price = priceMap.get(t.symbol) ?? null;
    if (price == null || !(price > 0)) continue;
    const isBuy = t.side === 'buy';
    // 1) TP / SL
    let reason: 'tp' | 'sl' | null = null;
    if (isBuy) {
      if (t.tp != null && price >= t.tp) reason = 'tp';
      else if (t.sl != null && price <= t.sl) reason = 'sl';
    } else {
      if (t.tp != null && price <= t.tp) reason = 'tp';
      else if (t.sl != null && price >= t.sl) reason = 'sl';
    }
    if (reason) {
      try {
        const pnl = calcPnl(t, price);
        await store.updateTrade(t.id, { status: 'closed', closeReason: reason, exitPrice: price, pnl, closedAt: Date.now() });
        await store.saveBalance(balance + pnl);
        balance += pnl;
        changed = true;
      } catch {}
      continue;
    }
    // 2) Trailing stop — same rule as desktop (base unit per category).
    if (!cfg.enabled) continue;
    try {
      const { baseQtyPerCategory } = await import('./paperTradingService');
      const { calcTrailingStop } = await import('../lib/trailingStop');
      const { usdToPrice } = await import('../lib/positionMath');
      const pnl = calcPnl(t, price);
      const tr = calcTrailingStop({
        qty: t.qty, openPnlUSD: pnl, baseUnit: baseQtyPerCategory(t.category || detectMobileTradeCategory(t.symbol)),
        baseActivationUSD: cfg.baseActivationUSD, baseStepUSD: cfg.baseStepUSD,
        activationLotStep: cfg.activationLotStep, stepLotStep: cfg.stepLotStep,
      });
      if (tr.active) {
        const newSl = usdToPrice(t.symbol, tr.offsetUSD, t.entryPrice, isBuy, t.qty, t.category || detectMobileTradeCategory(t.symbol));
        const better = t.sl == null || (isBuy ? newSl > t.sl! : newSl < t.sl!);
        if (better) {
          await store.updateTrade(t.id, { sl: newSl });
          changed = true;
        }
      }
    } catch {}
  }
  if (changed) {
    try { window.dispatchEvent(new CustomEvent('mobile-trades-changed', { detail: { action: 'manage' } })); } catch {}
  }
}

export function startMobilePositionManager(): void {
  if (posMgrTimer) return;
  posMgrTimer = setInterval(() => { mobileManagePositions().catch(() => {}); }, 5000);
  // First pass shortly after start so TP/SL/trailing engage immediately.
  setTimeout(() => { mobileManagePositions().catch(() => {}); }, 3000);
}

export function stopMobilePositionManager(): void {
  if (posMgrTimer) { clearInterval(posMgrTimer); posMgrTimer = null; }
}

function engineSignals(list: AnalysisResult[]) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && s.signal !== 'neutral' && (s.signal as any) !== 'no_entry' && !(s as any).isSideways)
    .slice(0, 40)
    .map((s) => ({
      symbol: s.symbol,
      signal: s.signal as SignalType,
      entryPrice: (s as any).entryPrice ?? null,
      stopLoss: (s as any).stopLoss ?? null,
      takeProfit: (s as any).takeProfit ?? null,
    }));
}

/** Start/stop + feed the shared engine with the SAME home-page signals (desktop parity). */
export function syncMobileAutoEngine(signals: AnalysisResult[]): void {
  const on = isMobileAutoTradeOn();
  if (!on) {
    try { mobileEngine?.stop(); } catch {}
    mobileEngine = null;
    return;
  }
  const user = mobileTradeUser() as any;
  let leverage = 100;
  try {
    const raw = JSON.parse(localStorage.getItem('paper_trading_data') || 'null');
    if (raw && typeof raw.leverage === 'number' && raw.leverage > 0) leverage = raw.leverage;
  } catch {}
  const sigs = engineSignals(signals);
  if (!mobileEngine) {
    try {
      mobileEngine = new AutoTradeEngine({ user, leverage, signals: sigs, isDeveloper: true, origin: '' });
      mobileEngine.start();
    } catch { mobileEngine = null; }
  } else {
    try { mobileEngine.updateConfig({ user, leverage, signals: sigs }); } catch {}
  }
}

/** Live price for P&L display (same quote path as desktop). */
export { getLivePrice as mobileLivePrice };
export type { PaperTrade };

