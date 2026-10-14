/**
 * Global Auto-Trade Engine — runs independently of the current page.
 * Scans the displayed signals every few seconds and opens/closes paper
 * trades exactly like the manual ticket, reusing positionMath.ts sizing.
 */

import { SignalType } from '../types';
import {
  notionalInUSD,
  usdToPrice,
} from '../lib/positionMath';
import {
  getDefaultQty,
  baseQtyPerCategory,
  calcRiskUSD,
  calcPnl,
  isMarketOpen,
  getLivePrice,
  getTradeStore,
  type PaperTrade,
} from './paperTradingService';
import { calcTrailingStop } from '../lib/trailingStop';
import { isOpened, markOpened, markClosed, clearOpened, lastClosedAt } from './autoGuard';
import { SYMBOL_CATEGORIES } from '../constants';

// ── PENDING-OPEN QUEUE (persisted) ──
// When a displayed signal can't open right away (market closed at scan time,
// or the quote feed has no price yet), dropping it means "signal with no
// trade" — opening only "magically" after a later refresh. This queue
// remembers the intent in localStorage so the next scan opens it as soon as
// conditions allow (market opens / price arrives), with zero user action.
const PENDING_KEY = 'finalyze_pending_opens_v1';
const PENDING_TTL_MS = 48 * 3600 * 1000; // forget stale intents after 48h
interface PendingOpen { signal: string; entryPrice?: number | null; stopLoss?: number | null; takeProfit?: number | null; queuedAt: number }
function readPending(): Record<string, PendingOpen> {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    const out: Record<string, PendingOpen> = {};
    for (const [k, v] of Object.entries<any>(raw)) {
      if (v && typeof v.signal === 'string' && typeof v.queuedAt === 'number' && now - v.queuedAt < PENDING_TTL_MS) out[k] = v as PendingOpen;
    }
    return out;
  } catch { return {}; }
}
function writePending(p: Record<string, PendingOpen>) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
function enqueuePendingOpen(sym: string, p: PendingOpen) {
  const all = readPending();
  all[sym] = p;
  writePending(all);
}
function consumePendingOpen(sym: string) {
  const all = readPending();
  if (all[sym]) { delete all[sym]; writePending(all); }
}

// Trailing settings (mirrors TradeNowPage's local copy so the global engine can
// trail auto trades on every page, not just the trade page).
function loadTrailingSettings(): { enabled: boolean; baseActivationUSD: number; baseStepUSD: number; activationLotStep: number; stepLotStep: number } {
  const fallback = { enabled: true, baseActivationUSD: 5, baseStepUSD: 2, activationLotStep: 2, stepLotStep: 1 };
  try {
    const raw = JSON.parse(localStorage.getItem('strategy_settings') || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      enabled: raw.enabled !== false,
      baseActivationUSD: Number(raw.baseActivationUSD) || fallback.baseActivationUSD,
      baseStepUSD: Number(raw.baseStepUSD) || fallback.baseStepUSD,
      activationLotStep: Number(raw.activationLotStep) || fallback.activationLotStep,
      stepLotStep: Number(raw.stepLotStep) || fallback.stepLotStep,
    };
  } catch { return fallback; }
}

// Local category detection (mirrors TradeNowPage) so the engine stays fully
// decoupled from any component — avoids a circular import.
function detectCategory(sym: string): string {
  const s = sym.toUpperCase().replace(/[-_=]/g, '');
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(s)) return cat;
  }
  if (/^[A-Z]{6}$/.test(s)) return 'forex';
  if (/BTC|ETH|USDT|COIN|DOGE/.test(s)) return 'crypto';
  if (/XAU|XAG|GOLD|SILVER/.test(s)) return 'metals';
  if (/\.T$/.test(sym)) return 'stocks';
  if (/\.(AS|PA|DE|L|SW|CO)$/.test(sym)) return 'stocks';
  return 'stocks';
}

export interface AutoTradeConfig {
  user: any; // Firebase user or null
  leverage: number;
  signals: Array<{ symbol: string; signal: SignalType; entryPrice?: number | null; stopLoss?: number | null; takeProfit?: number | null }>;
}

const SCAN_INTERVAL_MS = 3000;
const REOPEN_COOLDOWN_MS = 8000;

export class AutoTradeEngine {
  private timer: number | null = null;
  private config: AutoTradeConfig;
  private running = false;

  constructor(config: AutoTradeConfig) {
    this.config = config;
  }

  updateConfig(patch: Partial<AutoTradeConfig>) {
    const prevSignals = this.config.signals;
    this.config = { ...this.config, ...patch };
    // When the displayed signals change while the engine is already running,
    // fire a scan IMMEDIATELY instead of waiting for the next interval tick.
    // Without this, a signal produced by a just-finished radar scan could sit
    // unopened for up to SCAN_INTERVAL_MS (or be missed entirely if the timer
    // was throttled while the tab was backgrounded) — the user would only see
    // the trade appear after a manual page refresh (which re-runs start()).
    if (this.running && patch.signals && patch.signals !== prevSignals) {
      // Defer a tick so the patched config is fully committed before scanning.
      setTimeout(() => this.scan(), 0);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scan();
    this.timer = window.setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    console.log('[AutoTradeEngine] started');
  }

  /** Public immediate scan — lets App kick the engine synchronously the very
   *  tick new signals are published (no waiting for effect/interval timing). */
  scanNow() {
    if (!this.running) {
      // Engine exists but was stopped (e.g. toggled off then on without a
      // topSignals change to re-trigger the App effect) — restart it.
      try { this.start(); } catch { try { this.scan(); } catch {} }
      return;
    }
    try { this.scan(); } catch (e) { console.error('[AutoTradeEngine] scanNow error:', e); }
  }

  stop() {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    console.log('[AutoTradeEngine] stopped');
  }

  private async scan() {
    if (!this.running) return;
    // Honor the same-tab toggle instantly. The App effect that starts/stops
    // this engine depends on [topSignals, user] only, so flipping the
    // auto-trade switch on the trade page (same tab) does NOT re-run it —
    // without this in-scan check a switched-OFF engine would keep opening.
    try { if (typeof localStorage !== 'undefined' && localStorage.getItem('paper_trading_auto_trade') === '0') return; } catch { /* keep scanning */ }
    try {
    let store = getTradeStore(this.config.user);
    let balance = 0;
    let leverage = 1;
    let allTrades: PaperTrade[] = [];
    try {
      const [r, t] = await Promise.all([store.getAccount(), store.listTrades()]);
      balance = r.balance;
      leverage = r.leverage;
      allTrades = t;
    } catch (e) {
      // Firestore permission/auth failure (e.g. user object restored from
      // localStorage with a stale token) → fall back to the local store so
      // the scan keeps working WITHOUT a page refresh.
      console.warn('[AutoTradeEngine] Firestore unavailable, falling back to local store:', e);
      store = getTradeStore(null); // LocalStore
      const [r, t] = await Promise.all([store.getAccount(), store.listTrades()]);
      balance = r.balance;
      leverage = r.leverage;
      allTrades = t;
    }
      // This engine ONLY owns auto trades. Manual trades are managed by the
      // trade page's own engine — touching them here would double-close them.
      const openAuto = allTrades.filter((t) => t.status === 'open' && t.source === 'auto');

      // CLOSE PASS: trail + hit SL/TP for auto trades only.
      for (const t of openAuto) {
        const price = await this.getPrice(t.symbol);
        if (price == null || !(price > 0)) continue;

        // ── DYNAMIC TRAILING STOP (same logic as the manual engine) ──
        if (typeof t.qty === 'number' && t.qty > 0 && typeof t.entryPrice === 'number') {
          const ts = loadTrailingSettings();
          if (ts.enabled) {
            const pnlUSD = calcPnl(t, price);
            const trail = calcTrailingStop({
              qty: t.qty, openPnlUSD: pnlUSD,
              baseUnit: baseQtyPerCategory(t.category || detectCategory(t.symbol)),
              baseActivationUSD: ts.baseActivationUSD, baseStepUSD: ts.baseStepUSD,
              activationLotStep: ts.activationLotStep, stepLotStep: ts.stepLotStep,
            });
            if (trail.active && trail.offsetUSD >= 0) {
              const above = t.side === 'buy';
              const newSl = usdToPrice(t.symbol, trail.offsetUSD, t.entryPrice, above, t.qty, t.category);
              if (isFinite(newSl) && newSl > 0) {
                const better = t.side === 'buy' ? newSl > (t.sl ?? -Infinity) : newSl < (t.sl ?? Infinity);
                if (better) {
                  try { await store.updateTrade(t.id, { sl: newSl }); t.sl = newSl; } catch { /* local mirror stands */ }
                }
              }
            }
          }
        }

        const hitTp = t.tp != null && ((t.side === 'buy' && price >= t.tp) || (t.side === 'sell' && price <= t.tp));
        const hitSl = t.sl != null && ((t.side === 'buy' && price <= t.sl) || (t.side === 'sell' && price >= t.sl));
        if (hitTp || hitSl) await this.closeTrade(store, t, price, hitTp ? 'tp' : 'sl', balance);
      }

      // OPEN PASS: open new signals (persistent guard prevents re-open on reload).
      // Merge in pending-open intents (queued while market was closed or the
      // quote feed had no price). A pending symbol whose signal is no longer
      // displayed is still opened — it was a completed, filtered category
      // signal that simply couldn't fill at scan time.
      let openList = this.config.signals;
      try {
        const pend = readPending();
        const seen = new Set(openList.map((s) => s.symbol));
        const extra: typeof openList = [];
        for (const [sym, p] of Object.entries(pend)) {
          if (seen.has(sym)) continue;
          if (p.signal !== SignalType.STRONG_BUY && p.signal !== SignalType.BUY && p.signal !== SignalType.STRONG_SELL && p.signal !== SignalType.SELL) continue;
          extra.push({ symbol: sym, signal: p.signal as SignalType, entryPrice: p.entryPrice ?? null, stopLoss: p.stopLoss ?? null, takeProfit: p.takeProfit ?? null });
        }
        if (extra.length) openList = [...openList, ...extra];
      } catch { /* pending merge is best-effort */ }
      for (const sig of openList) {
        const isBuy = sig.signal === SignalType.STRONG_BUY || sig.signal === SignalType.BUY;
        const isSell = sig.signal === SignalType.STRONG_SELL || sig.signal === SignalType.SELL;
        if (!isBuy && !isSell) continue;
        const sym = sig.symbol;
        if (!sym) continue;
        // Persistent guard: survives refresh/reload. Cleared only on real close.
        // STUCK-GUARD REPAIR: the guard lives in localStorage, but a trade can be
        // closed manually / reset / cleared on the trade page without the engine
        // running. When that happens the symbol stays stuck in `opened` forever
        // and its (still-displayed) signal would NEVER open again. So if the guard
        // says "opened" but there is genuinely no open auto position for it, we
        // clear the stale entry and let it re-open — matching the reality on the
        // trade page (no open position ⇒ nothing to protect against re-opening).
        if (isOpened(sym) && !openAuto.some((t) => t.symbol === sym)) {
          console.warn(`[AutoTradeEngine] stuck guard for ${sym} — no open position, clearing so it can re-open`);
          clearOpened(sym);
        }
        if (isOpened(sym)) { console.warn(`[AutoTradeEngine] skip ${sym}: guard says opened`); continue; }
        if (openAuto.some((t) => t.symbol === sym)) { console.warn(`[AutoTradeEngine] skip ${sym}: open auto position already exists`); continue; }
        const lastClose = lastClosedAt(sym);
        if (lastClose && Date.now() - lastClose < REOPEN_COOLDOWN_MS) { console.warn(`[AutoTradeEngine] skip ${sym}: reopen cooldown`); continue; }

        const cat = detectCategory(sym);
        const marketOpen = isMarketOpen(cat, sym);
        // ── WEEKEND PENDING QUEUE ──
        // A fresh analysis (metals/forex/stocks) routinely lands while the
        // market is closed (weekend). Skipping it outright means the signal is
        // displayed but never traded — the user sees "signal with no trade"
        // even though auto-trade is ON. A page refresh during open hours then
        // "magically" opens it. Instead: remember the pending intent and open
        // automatically the moment the market opens, without any refresh.
        if (!marketOpen) {
          try { enqueuePendingOpen(sym, { signal: sig.signal, entryPrice: sig.entryPrice ?? null, stopLoss: sig.stopLoss ?? null, takeProfit: sig.takeProfit ?? null, queuedAt: Date.now() }); } catch {}
          console.warn(`[AutoTradeEngine] queued ${sym}: market closed (${cat}) — will auto-open at open`);
          continue;
        }
        // Market just opened (or pending from an earlier closed-market scan):
        // drain any queued intent for this symbol first so weekend analyses
        // open in order before fresh scans compete for margin.
        try { consumePendingOpen(sym); } catch {}

        const price = await this.getPrice(sym);
        if (price == null || !(price > 0)) {
          // ── NO-PRICE PENDING QUEUE ──
          // Same idea as the closed-market queue: the quote feed (/api/quote)
          // often returns null for metals/forex right after an analysis while
          // the provider warms up. Skipping here drops the trade silently.
          // Queue it so the next scan with a valid price opens it.
          try { enqueuePendingOpen(sym, { signal: sig.signal, entryPrice: sig.entryPrice ?? null, stopLoss: sig.stopLoss ?? null, takeProfit: sig.takeProfit ?? null, queuedAt: Date.now() }); } catch {}
          console.warn(`[AutoTradeEngine] queued ${sym}: no live price — will retry`);
          continue;
        }

        const q = getDefaultQty(cat, balance);
        const requiredMargin = notionalInUSD(cat, sym, price, q) / leverage;
        if (requiredMargin > balance) { console.warn(`[AutoTradeEngine] skip ${sym}: insufficient margin (need ${requiredMargin.toFixed(2)} > balance ${balance})`); continue; }

        const { slUsd, tpUsd } = calcRiskUSD(balance);
        const side: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';
        const entryPrice = price;
        const slPrice = usdToPrice(sym, slUsd, entryPrice, side === 'sell', q, cat);
        const tpPrice = usdToPrice(sym, tpUsd, entryPrice, side === 'buy', q, cat);

        const tradeData: Omit<PaperTrade, 'id'> = {
          symbol: sym, category: cat, side, qty: q, entryPrice,
          status: 'open' as const, tp: tpPrice, sl: slPrice, openedAt: Date.now(),
          source: 'auto',
        };

        try {
          await store.addTrade(tradeData);
          markOpened(sym);
          console.log(`[AutoTradeEngine] opened ${side} ${sym} @ ${entryPrice} SL:${slPrice} TP:${tpPrice}`);
        } catch (e) { console.error(`[AutoTradeEngine] failed to open ${sym}:`, e); }
      }
    } catch (e) { console.error('[AutoTradeEngine] scan error:', e); }
  }

  private async closeTrade(store: any, t: PaperTrade, exitPrice: number, reason: 'tp' | 'sl', currentBalance: number) {
    const pnl = calcPnl(t, exitPrice);
    const newBalance = currentBalance + pnl;
    try {
      await store.updateTrade(t.id, { status: 'closed', exitPrice, pnl, closeReason: reason, closedAt: Date.now() });
      await store.saveBalance(newBalance);
      console.log(`[AutoTradeEngine] closed ${t.symbol} @ ${exitPrice} (${reason}) P&L: ${pnl.toFixed(2)}`);
      markClosed(t.symbol);
    } catch (e) { console.error(`[AutoTradeEngine] failed to close ${t.symbol}:`, e); }
  }

  private async getPrice(sym: string): Promise<number | null> {
    try { return await getLivePrice(sym); } catch { return null; }
  }
}

