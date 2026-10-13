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
import { isOpened, markOpened, markClosed, lastClosedAt } from './autoGuard';
import { SYMBOL_CATEGORIES } from '../constants';

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
  signals: Array<{ symbol: string; signal: SignalType }>;
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
    this.config = { ...this.config, ...patch };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scan();
    this.timer = window.setInterval(() => this.scan(), SCAN_INTERVAL_MS);
    console.log('[AutoTradeEngine] started');
  }

  stop() {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    console.log('[AutoTradeEngine] stopped');
  }

  private async scan() {
    if (!this.running) return;
    try {
      const store = getTradeStore(this.config.user);
      const [{ balance, leverage }, allTrades] = await Promise.all([
        store.getAccount(),
        store.listTrades(),
      ]);
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
      for (const sig of this.config.signals) {
        const isBuy = sig.signal === SignalType.STRONG_BUY || sig.signal === SignalType.BUY;
        const isSell = sig.signal === SignalType.STRONG_SELL || sig.signal === SignalType.SELL;
        if (!isBuy && !isSell) continue;
        const sym = sig.symbol;
        if (!sym) continue;
        // Persistent guards: survives refresh/reload. Cleared only on real close.
        if (isOpened(sym)) continue;
        if (openAuto.some((t) => t.symbol === sym)) continue;
        const lastClose = lastClosedAt(sym);
        if (lastClose && Date.now() - lastClose < REOPEN_COOLDOWN_MS) continue;

        const cat = detectCategory(sym);
        if (!isMarketOpen(cat, sym)) continue;

        const price = await this.getPrice(sym);
        if (price == null || !(price > 0)) continue;

        const q = getDefaultQty(cat, balance);
        const requiredMargin = notionalInUSD(cat, sym, price, q) / leverage;
        if (requiredMargin > balance) continue;

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

