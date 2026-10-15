/**
 * Trade Mirror — copy-trading bridge: developer → subscribed clients.
 *
 * HOW IT WORKS (follows the SAME pattern as `shared_results`):
 * - The DEVELOPER's AutoTradeEngine broadcasts every auto open/close into the
 *   public `shared_trades` collection (one doc per trade event).
 * - Each SUBSCRIBED CLIENT (paid plan active + mirror switch ON) polls
 *   `shared_trades`, dedupes by event id, and executes the same trade locally
 *   in their OWN account (own balance, own sizing), in sync with the developer.
 * - Close commands are broadcast too, so the client closes the same position.
 *
 * WHY CLIENT-SIDE EXECUTION (not server-side):
 * - Firestore rules forbid writing into another account's trades
 *   (`paper_trades` is per-uid). The developer can NEVER open a trade directly
 *   inside a client's account. The broadcast is the safe middle ground:
 *   developer publishes public EVENTS; each client device executes them in its
 *   OWN store with its OWN guards (one position per symbol, cooldowns).
 */

import { db } from '../lib/firebase';
import { collection, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import {
  getDefaultQty,
  calcRiskUSD,
  calcPnl,
  isMarketOpen,
  getLivePrice,
  getTradeStore,
} from './paperTradingService';
import { notionalInUSD, usdToPrice } from '../lib/positionMath';
import {
  isOpened as guardIsOpened,
  markOpened as guardMarkOpened,
  markClosed as guardMarkClosed,
  clearOpened as guardClearOpened,
  lastClosedAt as guardLastClosedAt,
} from './autoGuard';

export interface MirrorTradeEvent {
  /** Stable unique id: `open:<symbol>:<openedAt>` or `close:<symbol>:<ts>` */
  id: string;
  kind: 'open' | 'close';
  symbol: string;
  side?: 'buy' | 'sell';
  signal?: string;
  openedAt: number;
  devEntry?: number | null;
  devSl?: number | null;
  devTp?: number | null;
  closeReason?: 'tp' | 'sl' | 'manual';
  origin: string;
  publishedAt: number;
}

export const MIRROR_COLLECTION = 'shared_trades';
export const MIRROR_TTL_MS = 6 * 3600 * 1000;
export const MIRROR_SEEN_KEY = 'finalyze_mirror_seen_v1';
export const MIRROR_ENABLED_KEY = 'finalyze_client_mirror_enabled';

export function readMirrorSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(MIRROR_SEEN_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((s: any) => typeof s === 'string') : []);
  } catch { return new Set(); }
}

export function writeMirrorSeen(s: Set<string>) {
  try { localStorage.setItem(MIRROR_SEEN_KEY, JSON.stringify([...s].slice(-300))); } catch {}
}

/** Client mirror switch — ON by default; anyone (free or paid) mirrors unless
 *  they explicitly switch it OFF ('0'). The developer can additionally gate
 *  free accounts off entirely via MIRROR_FREE_ALLOWED (default ON). */
export function isMirrorEnabled(): boolean {
  try { return localStorage.getItem(MIRROR_ENABLED_KEY) !== '0'; } catch { return true; }
}
export function setMirrorEnabled(on: boolean): void {
  try { localStorage.setItem(MIRROR_ENABLED_KEY, on ? '1' : '0'); } catch {}
  try { window.dispatchEvent(new CustomEvent('finalyze-mirror-changed', { detail: { on } })); } catch {}
}

/**
 * DEVELOPER kill-switch: may the mirror run for FREE (non-plan) accounts?
 * Stored in Firestore (`config/mirror`) so one flip on the developer device
 * applies everywhere; defaults to ON (allowed) so free clients mirror too.
 * Local override key lets the developer preview either mode on this device.
 */
export const MIRROR_FREE_LOCAL_KEY = 'finalyze_mirror_free_allowed';
export function isMirrorFreeAllowedLocal(): boolean {
  try {
    const v = localStorage.getItem(MIRROR_FREE_LOCAL_KEY);
    return v == null ? true : v !== '0';
  } catch { return true; }
}
export function setMirrorFreeAllowedLocal(on: boolean): void {
  try { localStorage.setItem(MIRROR_FREE_LOCAL_KEY, on ? '1' : '0'); } catch {}
  try { window.dispatchEvent(new CustomEvent('finalyze-mirror-free-changed', { detail: { on } })); } catch {}
}

/** DEVELOPER SIDE — broadcast one open/close event (best-effort). */
export async function broadcastMirrorEvent(ev: Omit<MirrorTradeEvent, 'publishedAt'>): Promise<void> {
  try {
    await setDoc(doc(db, MIRROR_COLLECTION, ev.id), {
      ...ev,
      publishedAt: Date.now(),
      createdAt: Timestamp.now(),
    }, { merge: true });
  } catch (e) {
    console.warn('[TradeMirror] broadcast failed:', (e as any)?.message || e);
  }
}

/** Build an OPEN event from a just-opened auto trade. */
export function openEventFor(symbol: string, side: 'buy' | 'sell', signal: string, openedAt: number, opts: { devEntry?: number | null; devSl?: number | null; devTp?: number | null; origin: string }): Omit<MirrorTradeEvent, 'publishedAt'> {
  return {
    id: `open:${symbol}:${openedAt}`,
    kind: 'open', symbol, side, signal, openedAt,
    devEntry: opts.devEntry ?? null,
    devSl: opts.devSl ?? null,
    devTp: opts.devTp ?? null,
    origin: opts.origin,
  };
}

/** Build a CLOSE event for a developer-closed auto trade. */
export function closeEventFor(symbol: string, reason: 'tp' | 'sl' | 'manual', origin: string): Omit<MirrorTradeEvent, 'publishedAt'> {
  return {
    id: `close:${symbol}:${Date.now()}`,
    kind: 'close', symbol, closeReason: reason, openedAt: Date.now(), origin,
  };
}

export function detectMirrorCategory(sym: string): string {
  const s = sym.toUpperCase().replace(/[-_=]/g, '');
  if (/^(BTC|ETH|XRP|SOL|DOGE|ADA|DOT|LINK|MATIC|AVAX|ATOM|NEAR|LTC|TRX|BNB|ARB|OP|PEPE|SHIB)/.test(s)) return 'crypto';
  if (/^(XAUUSD|GOLD|XAGUSD|SILVER|XPTUSD|XPDUSD)/.test(s)) return 'metals';
  if (/^[A-Z]{3,4}USD$/.test(s) && !/^(BTC|ETH)/.test(s)) return 'forex';
  return 'stocks';
}

/**
 * CLIENT SIDE — pull unseen mirror events and execute them in the client's
 * OWN account with the client's OWN balance/sizing and guards.
 * Returns the executed events (for sound/toast wiring).
 */
export async function pollMirrorEvents(opts: {
  user: any;
  playChampagne: () => void;
  notify: (msg: string) => void;
  /**
   * Symbols with a currently DISPLAYED signal on this device (topSignals +
   * client signals). When provided, OPEN events are honoured ONLY for these
   * symbols — so a developer manual ticket (never in the signal lists) can
   * never open a position in a client account. CLOSE events are always
   * honoured (closing is safe even if the signal vanished).
   */
  displayedSymbols?: string[];
}): Promise<MirrorTradeEvent[]> {
  const executed: MirrorTradeEvent[] = [];
  const seen = readMirrorSeen();
  let docs: any[] = [];
  try {
    const snap = await getDocs(collection(db, MIRROR_COLLECTION));
    snap.forEach((d) => docs.push({ id: d.id, ...(d.data() as any) }));
  } catch (e) {
    console.warn('[TradeMirror] poll failed:', (e as any)?.message || e);
    return executed;
  }
  const now = Date.now();
  const fresh = docs
    .filter((d) => d && typeof d.id === 'string' && (d.kind === 'open' || d.kind === 'close'))
    .filter((d) => typeof d.publishedAt === 'number' && now - d.publishedAt < MIRROR_TTL_MS)
    .filter((d) => !seen.has(d.id))
    .sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
  if (fresh.length === 0) return executed;

  const store = getTradeStore(opts.user);
  let balance = 10000;
  let leverage = 100;
  let allTrades: any[] = [];
  try {
    const acc = await store.getAccount();
    balance = acc.balance;
    leverage = acc.leverage;
    allTrades = await store.listTrades();
  } catch { /* local defaults */ }

  const openFor = (sym: string) => allTrades.find((t: any) => t.status === 'open' && t.symbol === sym);

  for (const ev of fresh) {
    seen.add(ev.id);
    const sym: string = ev.symbol;
    if (!sym) continue;
    // ANALYSIS-ONLY FENCE: mirror OPENs only for symbols with a displayed
    // signal (auto radar OR manual analysis). Developer hand-opened tickets
    // never appear in the signal lists, so they are never mirrored.
    if (ev.kind === 'open' && opts.displayedSymbols && opts.displayedSymbols.length > 0) {
      const ok = opts.displayedSymbols.some((s) => String(s || '').toUpperCase() === String(sym).toUpperCase());
      if (!ok) {
        console.log(`[TradeMirror] skip ${sym}: not in displayed signals (analysis-only)`);
        continue;
      }
    }
    try {
      if (ev.kind === 'open') {
        const sig = String(ev.signal || '');
        const isBuy = sig === 'strong_buy' || sig === 'buy' || ev.side === 'buy';
        const isSell = sig === 'strong_sell' || sig === 'sell' || ev.side === 'sell';
        if (!isBuy && !isSell) continue;
        if (openFor(sym)) continue;
        if (guardIsOpened(sym)) continue;
        const lastClose = guardLastClosedAt(sym);
        if (lastClose && Date.now() - lastClose < 8000) continue;
        const cat = detectMirrorCategory(sym);
        if (!isMarketOpen(cat, sym)) continue;
        const price = await getLivePrice(sym).catch(() => null);
        if (price == null || !(price > 0)) continue;
        const q = getDefaultQty(cat, balance);
        const requiredMargin = notionalInUSD(cat, sym, price, q) / leverage;
        if (requiredMargin > balance) continue;
        const { slUsd, tpUsd } = calcRiskUSD(balance);
        const side: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';
        await store.addTrade({
          symbol: sym, category: cat, side, qty: q, entryPrice: price,
          status: 'open' as const,
          tp: usdToPrice(sym, tpUsd, price, side === 'buy', q, cat),
          sl: usdToPrice(sym, slUsd, price, side === 'sell', q, cat),
          openedAt: Date.now(),
          source: 'auto',
        });
        guardMarkOpened(sym);
        allTrades = await store.listTrades().catch(() => allTrades);
        const acc2 = await store.getAccount().catch(() => null);
        if (acc2) { balance = acc2.balance; leverage = acc2.leverage; }
        executed.push(ev);
        try { opts.playChampagne(); } catch {}
        try { opts.notify(`نسخ تلقائي: ${side === 'buy' ? 'شراء' : 'بيع'} ${sym}`); } catch {}
        console.log(`[TradeMirror] mirrored open ${side} ${sym} (dev event ${ev.id})`);
      } else if (ev.kind === 'close') {
        const mine = openFor(sym);
        if (!mine) { guardClearOpened(sym); continue; }
        const price = await getLivePrice(sym).catch(() => null);
        if (price == null || !(price > 0)) continue;
        const pnl = calcPnl(mine, price);
        await store.updateTrade(mine.id, { status: 'closed', exitPrice: price, pnl, closeReason: ev.closeReason === 'manual' ? 'manual' : ((ev.closeReason as any) || 'manual'), closedAt: Date.now() });
        await store.saveBalance(balance + pnl).catch(() => {});
        guardMarkClosed(sym);
        balance = balance + pnl;
        allTrades = await store.listTrades().catch(() => allTrades);
        executed.push(ev);
        console.log(`[TradeMirror] mirrored close ${sym} (${ev.closeReason})`);
      }
    } catch (e) {
      console.warn('[TradeMirror] execute failed for', ev.id, (e as any)?.message || e);
    }
  }
  writeMirrorSeen(seen);
  return executed;
}

