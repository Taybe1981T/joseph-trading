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
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';
import {
  calcPnl,
  isMarketOpen,
  getLivePrice,
  getTradeStore,
} from './paperTradingService';
import { notionalInUSD } from '../lib/positionMath';
import { tradeQtyFor, resolveRiskLevels } from './tradingValues';
import type { AnalysisResult } from '../types';
import {
  isOpened as guardIsOpened,
  markOpened as guardMarkOpened,
  markClosed as guardMarkClosed,
  clearOpened as guardClearOpened,
  lastClosedAt as guardLastClosedAt,
} from './autoGuard';

export interface MirrorTradeEvent {
  /** Stable unique id: `open:<symbol>:<openedAt>` or `close:<symbol>:<ts>` or `clear:history`/`clear:reset` */
  id: string;
  kind: 'open' | 'close' | 'clear';
  symbol: string;
  side?: 'buy' | 'sell';
  signal?: string;
  openedAt: number;
  devEntry?: number | null;
  devSl?: number | null;
  devTp?: number | null;
  closeReason?: 'tp' | 'sl' | 'manual';
  /** For `kind: 'clear'`: clear the closed history only, or the WHOLE free book. */
  scope?: 'history' | 'all';
  /** For a FULL RESET: the developer's new balance (free mirrors follow it). */
  resetBalance?: number;
  origin: string;
  publishedAt: number;
}

export const MIRROR_COLLECTION = 'shared_trades';
export const MIRROR_TTL_MS = 6 * 3600 * 1000;
export const MIRROR_SEEN_KEY = 'finalyze_mirror_seen_v1';
export const MIRROR_ENABLED_KEY = 'finalyze_client_mirror_enabled';
/** Last developer "clear history" timestamp applied on this device. */
export const MIRROR_CLEARED_KEY = 'finalyze_mirror_cleared_at_v1';
/** Last developer FULL RESET (open + closed book wiped) applied on this device. */
export const MIRROR_RESET_KEY = 'finalyze_mirror_reset_at_v1';
/**
 * Developer's live book mirror (public read): `shared_status/book` holds the
 * symbols the developer currently holds open. FREE-mode accounts reconcile
 * against it, so a developer reset/clear can never leave stale open copies.
 */
export const DEV_BOOK_DOC = { collection: 'shared_status', id: 'book' } as const;
/** Ignore a book older than this — the developer has not published recently. */
const DEV_BOOK_MAX_AGE_MS = 24 * 3600 * 1000;
/** Grace period before a copy counts as "stale" (book publish lags by ~15s). */
const RECONCILE_GRACE_MS = 90 * 1000;

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
  // Default OFF: a client account only auto-trades from its OWN analysis.
  // Copy-trading (mirror) requires explicit opt-in.
  try { return localStorage.getItem(MIRROR_ENABLED_KEY) === '1'; } catch { return false; }
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

/**
 * Build a CLEAR-HISTORY event. One fixed document id is reused (merge), so a
 * device that was offline still sees the LATEST clear timestamp on its next
 * poll and drops its stale closed history. The event carries no TTL.
 */
export function clearEventFor(origin: string): Omit<MirrorTradeEvent, 'publishedAt'> {
  return {
    id: 'clear:history',
    kind: 'clear', symbol: '', scope: 'history', openedAt: Date.now(), origin,
  };
}

/**
 * Build a FULL RESET event (developer "reset account" / wipe everything).
 * Free/guest accounts drop their whole mirrored book: open copies AND history.
 * A paid client's own trades and signals are never touched.
 */
export function resetEventFor(origin: string, newBalance?: number): Omit<MirrorTradeEvent, 'publishedAt'> {
  return {
    id: 'clear:reset',
    kind: 'clear', symbol: '', scope: 'all', openedAt: Date.now(), origin,
    ...(typeof newBalance === 'number' && isFinite(newBalance) && newBalance >= 0 ? { resetBalance: newBalance } : {}),
  };
}

/**
 * DEVELOPER SIDE — publish the live book (open symbols) so free/guest accounts
 * can reconcile: any mirrored position the developer no longer holds is
 * removed automatically, even if its close event was missed.
 */
export async function publishDevBook(
  trades: { symbol?: string; status?: string }[],
  origin: string,
): Promise<void> {
  try {
    const openSymbols = [...new Set(
      (trades || [])
        .filter((t) => t && t.status === 'open' && t.symbol)
        .map((t) => String(t.symbol).toUpperCase()),
    )];
    await setDoc(doc(db, DEV_BOOK_DOC.collection, DEV_BOOK_DOC.id), {
      openSymbols,
      updatedAt: Date.now(),
      origin,
    }, { merge: true });
  } catch (e) {
    console.warn('[TradeMirror] book publish failed:', (e as any)?.message || e);
  }
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
 *
 * A pass is SERIALIZED across this page (promise chain) and, when the browser
 * supports it, across every tab of this origin (Web Locks). Without this, the
 * 10s poll and the realtime listener (and several mounted components) could all
 * read the same "unseen" event before any of them persisted it, opening the
 * SAME position several times.
 */
export function pollMirrorEvents(opts: {
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
  /** Display mode the mirrored trades belong to (free view vs paid). */
  mode?: 'free' | 'paid';
  /**
   * Bypass the per-client mirror toggle. FREE / GUEST accounts are a mirror of
   * the developer's book and must follow it automatically — they have no
   * control over open/close/history.
   */
  force?: boolean;
  /**
   * Whether NEW developer opens may be copied. Defaults to true. The
   * developer's free-mirror kill-switch only gates opens — closes, history
   * clears and full resets ALWAYS apply so a free book can never drift.
   */
  allowOpen?: boolean;
}): Promise<MirrorTradeEvent[]> {
  const exec = (): Promise<MirrorTradeEvent[]> => {
    const run = _mirrorChain
      .then(() => runMirrorPass(opts))
      .catch((e) => {
        console.warn('[TradeMirror] pass failed:', (e as any)?.message || e);
        return [] as MirrorTradeEvent[];
      });
    _mirrorChain = run.then(() => undefined, () => undefined);
    return run;
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : null;
  if (locks && typeof locks.request === 'function') {
    return locks.request('finalyze_mirror_pass', () => exec());
  }
  return exec();
}

/** Serializes mirror passes inside this page. */
let _mirrorChain: Promise<any> = Promise.resolve();

async function runMirrorPass(opts: {
  user: any;
  playChampagne: () => void;
  notify: (msg: string) => void;
  displayedSymbols?: string[];
  mode?: 'free' | 'paid';
  force?: boolean;
  allowOpen?: boolean;
}): Promise<MirrorTradeEvent[]> {
  const executed: MirrorTradeEvent[] = [];
  // Respect the user's mirror toggle — both the 10s poll and the real-time
  // onSnapshot listener route through here, so this guards both paths.
  // A forced (free/guest) mirror ignores the per-client switch.
  if (!opts.force && !isMirrorEnabled()) return executed;
  const seen = readMirrorSeen();
  // Write `seen` IMMEDIATELY: a poll and a realtime listener (or two mounted
  // components) can overlap, and only persistence prevents a second pass from
  // opening the same position again.
  const markSeen = (id: string) => {
    if (!id) return;
    seen.add(id);
    writeMirrorSeen(seen);
  };
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
    .filter((d) => d && typeof d.id === 'string' && (d.kind === 'open' || d.kind === 'close' || d.kind === 'clear'))
    .filter((d) => {
      // History-clear events are persistent state (fixed id) — never TTL'd or
      // deduped by `seen`; the applied timestamp decides whether to run them.
      if (d.kind === 'clear') return true;
      return typeof d.publishedAt === 'number' && now - d.publishedAt < MIRROR_TTL_MS;
    })
    .filter((d) => d.kind === 'clear' || !seen.has(d.id))
    .sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));

  const store = getTradeStore(opts.user);
  // Per-account markers: several accounts may share this browser/phone.
  const acctKey = String(opts.user?.uid || 'guest');
  const clearKey = `${MIRROR_CLEARED_KEY}__${acctKey}`;
  const resetKey = `${MIRROR_RESET_KEY}__${acctKey}`;
  let balance = 10000;
  let leverage = 100;
  let allTrades: any[] = [];
  try {
    const acc = await store.getAccount();
    balance = acc.balance;
    leverage = acc.leverage;
    allTrades = await store.listTrades();
  } catch { /* local defaults */ }

  // ── RECONCILE with the developer's live book (FREE mode only) ──────────────
  // The developer publishes the symbols they currently hold open. Any copy
  // this account still shows that the developer no longer holds is removed —
  // this is what makes a developer reset/clear apply even to clients that were
  // offline when the close event was broadcast (or copies opened by an old
  // build that never broadcast closes).
  // Symbols the developer currently holds, when a fresh book is available. Used
  // to skip OPEN events left over from before a reset (see the open branch).
  let devHeld: Set<string> | null = null;
  if (opts.mode === 'free') {
    // ONE COPY PER SYMBOL: an older build could let overlapping passes open the
    // same symbol several times. Keep the earliest copy, drop the extras.
    try {
      const openFree = allTrades
        .filter((t: any) => t && t.status === 'open' && t.mode !== 'paid')
        .sort((a: any, b: any) => Number(a.openedAt || 0) - Number(b.openedAt || 0));
      const firstBySym = new Set<string>();
      const dups: any[] = [];
      for (const t of openFree) {
        const s = String(t.symbol || '').toUpperCase();
        if (firstBySym.has(s)) dups.push(t); else firstBySym.add(s);
      }
      if (dups.length) {
        await store.deleteTrades(dups.map((t: any) => t.id));
        const drop = new Set(dups.map((t: any) => t.id));
        allTrades = allTrades.filter((t: any) => !drop.has(t.id));
        console.log(`[TradeMirror] removed ${dups.length} duplicate copy(ies)`);
      }
    } catch { /* retry next poll */ }
    try {
      const bookSnap = await getDoc(doc(db, DEV_BOOK_DOC.collection, DEV_BOOK_DOC.id));
      const book: any = bookSnap.exists() ? bookSnap.data() : null;
      const bookFresh = !!book && typeof book.updatedAt === 'number' && now - book.updatedAt < DEV_BOOK_MAX_AGE_MS;
      if (bookFresh && Array.isArray(book.openSymbols)) {
        const held = new Set<string>(book.openSymbols.map((s: any) => String(s || '').toUpperCase()));
        devHeld = held;
        const stale = allTrades.filter((t: any) =>
          t && t.status === 'open' && t.mode !== 'paid' &&
          !held.has(String(t.symbol || '').toUpperCase()) &&
          Number(t.openedAt || 0) < now - RECONCILE_GRACE_MS);
        if (stale.length) {
          await store.deleteTrades(stale.map((t: any) => t.id));
          const drop = new Set(stale.map((t: any) => t.id));
          allTrades = allTrades.filter((t: any) => !drop.has(t.id));
          for (const t of stale) guardClearOpened(String(t.symbol || ''));
          console.log(`[TradeMirror] removed ${stale.length} stale copy(ies) not in developer book`);
        }
      }
    } catch (e) {
      console.warn('[TradeMirror] book reconcile failed:', (e as any)?.message || e);
    }
  }

  if (fresh.length === 0) return executed;

  const openFor = (sym: string) => allTrades.find((t: any) => t.status === 'open' && t.symbol === sym);
  // Close only a position that actually came from the developer's book:
  //   • new mirrored trades carry `mirrored: true`;
  //   • in FREE mode every non-paid row is a copy (free accounts cannot open);
  //   • legacy copies (pre-flag) are therefore matched via their free mode.
  const mirroredFor = (sym: string) => allTrades.find((t: any) => {
    if (t.status !== 'open' || t.symbol !== sym) return false;
    if (opts.mode === 'free') return t.mode !== 'paid';
    return t.mirrored === true;
  });

  // Track symbols mirrored-opened during THIS poll pass so we don't clear
  // their guard mid-loop (allTrades may be stale if listTrades() failed
  // after an earlier open in this same pass). Mirrors the autoTradeEngine
  // `openedThisScan` pattern.
  const openedThisPoll = new Set<string>();

  for (const ev of fresh) {
    // CLEAR (history or FULL RESET): free/guest accounts mirror the developer's
    // book exactly — closed history and/or the whole book is dropped. Paid
    // clients own their account: their own trades and history are never touched
    // (mode 'paid' rows are always preserved).
    if (ev.kind === 'clear') {
      if (opts.mode !== 'free') continue;
      const scope: 'history' | 'all' = ev.scope === 'all' ? 'all' : 'history';
      const key = scope === 'all' ? resetKey : clearKey;
      try {
        const applied = Number(localStorage.getItem(key) || 0);
        const stamp = Number(ev.publishedAt || 0);
        if (stamp > applied) {
          const doomed = allTrades.filter((t: any) =>
            t && t.mode !== 'paid' && (scope === 'all' || t.status !== 'open'));
          if (doomed.length) {
            await store.deleteTrades(doomed.map((t: any) => t.id));
            const drop = new Set(doomed.map((t: any) => t.id));
            allTrades = allTrades.filter((t: any) => !drop.has(t.id));
            for (const t of doomed) {
              if (t.status === 'open') guardClearOpened(String(t.symbol || ''));
            }
          }
          // A developer RESET also resets the copied balance (their new start).
          if (scope === 'all' && typeof ev.resetBalance === 'number' && isFinite(ev.resetBalance) && ev.resetBalance >= 0) {
            const nb = ev.resetBalance;
            await store.saveBalance(nb).catch(() => {});
            balance = nb;
          }
          try { localStorage.setItem(key, String(stamp)); } catch {}
          executed.push(ev);
          console.log(`[TradeMirror] mirrored ${scope === 'all' ? 'FULL RESET' : 'history clear'} from developer`);
        }
      } catch (e) {
        console.warn('[TradeMirror] clear failed:', (e as any)?.message || e);
      }
      continue;
    }
    const sym: string = ev.symbol;
    if (!sym) { markSeen(ev.id); continue; } // malformed event — definitive
    // Developer kill-switch: do not OPEN new free copies. Closes/history/reset
    // above are never gated, so the free book always matches the developer's.
    if (ev.kind === 'open' && opts.allowOpen === false) continue;
    // BOOK GATE (free mode): never open a copy for a symbol the developer does
    // not currently hold. Stale OPEN events from before a reset are dropped; a
    // brand-new open is retried for up to 2 minutes while the book catches up.
    const inDevBook = devHeld ? devHeld.has(String(sym).toUpperCase()) : false;
    if (ev.kind === 'open' && devHeld) {
      if (!inDevBook) {
        const age = now - Number(ev.publishedAt || 0);
        console.log(`[TradeMirror] skip ${sym}: not in dev book (age ${Math.round(age/1000)}s)${age > 2*60*1000 ? ' — marked seen' : ' — will retry'}`);
        if (age > 2 * 60 * 1000) markSeen(ev.id);
        continue;
      }
    }
    // ANALYSIS-ONLY FENCE: mirror OPENs only for symbols with a displayed
    // signal (auto radar OR manual analysis). Developer hand-opened tickets
    // never appear in the signal lists, so they are never mirrored.
    // FREE/GUEST mirror exception: if the developer's live book confirms they
    // currently hold this symbol, the copy MUST open so free views match the
    // developer account exactly (all open trades visible), even if the displayed
    // signal list lags.
    // NOTE: a fence rejection does NOT mark the event as seen — the client's
    // shared_results poll (signals) can LAG the trade event, so the signal
    // may appear a few seconds later; the event must be retried until then.
    if (ev.kind === 'open' && opts.displayedSymbols && opts.displayedSymbols.length > 0) {
      const ok = opts.displayedSymbols.some((s) => String(s || '').toUpperCase() === String(sym).toUpperCase());
      if (!ok && !(opts.mode === 'free' && inDevBook)) {
        console.log(`[TradeMirror] skip ${sym}: not in displayed signals (analysis-only) — will retry`);
        continue;
      }
    }
    try {
      if (ev.kind === 'open') {
        const sig = String(ev.signal || '');
        const isBuy = sig === 'strong_buy' || sig === 'buy' || ev.side === 'buy';
        const isSell = sig === 'strong_sell' || sig === 'sell' || ev.side === 'sell';
        if (!isBuy && !isSell) { markSeen(ev.id); continue; } // invalid signal — definitive
        if (openFor(sym)) { markSeen(ev.id); continue; } // already have the position
        // At this point openFor(sym) already returned null (no open position).
        // If the guard still says "opened", it's a stuck guard from a position
        // that was closed manually without the engine clearing the flag.
        // If we opened it earlier THIS poll pass, skip to avoid a duplicate.
        // Otherwise, clear the stale guard so the mirror open can proceed.
        if (guardIsOpened(sym) && openedThisPoll.has(sym)) { markSeen(ev.id); continue; } // just opened this pass — skip duplicate
        if (guardIsOpened(sym)) {
          guardClearOpened(sym);
          console.warn(`[TradeMirror] stuck guard for ${sym} — clearing so mirror open can proceed`);
        }
        const lastClose = guardLastClosedAt(sym);
        if (lastClose && Date.now() - lastClose < 8000) { console.log(`[TradeMirror] retry ${sym}: reopen cooldown`); continue; } // retry after cooldown
        const cat = detectMirrorCategory(sym);
        if (!isMarketOpen(cat, sym)) { console.log(`[TradeMirror] retry ${sym}: market closed (${cat})`); continue; } // retry — market may open later
        const price = await getLivePrice(sym).catch(() => null);
        if (price == null || !(price > 0)) { console.log(`[TradeMirror] retry ${sym}: no price`); continue; } // retry — quote feed warms up
        // Same sizing/risk rules as the developer's auto engine and the manual
        // ticket: crypto → tiered balance-scaled lot + percentage SL/TP;
        // other categories → fixed values (when ON) or dynamic $ risk.
        const q = tradeQtyFor(cat, sym, balance);
        const requiredMargin = notionalInUSD(cat, sym, price, q) / leverage;
        if (requiredMargin > balance) { console.log(`[TradeMirror] retry ${sym}: insufficient margin (${requiredMargin.toFixed(2)} > ${balance.toFixed(2)})`); continue; } // retry — balance may free up
        const side: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';
        const levels = resolveRiskLevels({
          category: cat, symbol: sym, entry: price, isBuy, qty: q, balance,
          signalSl: ev.devSl, signalTp: ev.devTp,
        });
        await store.addTrade({
          symbol: sym, category: cat, side, qty: q, entryPrice: price,
          status: 'open' as const,
          tp: levels.tpPrice,
          sl: levels.slPrice,
          openedAt: Date.now(),
          source: 'auto',
          mode: opts.mode || 'free',
          mirrored: true,
        });
        guardMarkOpened(sym);
        openedThisPoll.add(sym);
        markSeen(ev.id); // executed — never reprocess
        allTrades = await store.listTrades().catch(() => allTrades);
        const acc2 = await store.getAccount().catch(() => null);
        if (acc2) { balance = acc2.balance; leverage = acc2.leverage; }
        executed.push(ev);
        try { opts.playChampagne(); } catch {}
        try { opts.notify(`نسخ تلقائي: ${side === 'buy' ? 'شراء' : 'بيع'} ${sym}`); } catch {}
        console.log(`[TradeMirror] mirrored open ${side} ${sym} (dev event ${ev.id})`);
      } else if (ev.kind === 'close') {
        const mine = mirroredFor(sym);
        if (!mine) { guardClearOpened(sym); markSeen(ev.id); continue; } // nothing to close
        const price = await getLivePrice(sym).catch(() => null);
        if (price == null || !(price > 0)) continue; // retry — quote feed warms up
        const pnl = calcPnl(mine, price);
        await store.updateTrade(mine.id, { status: 'closed', exitPrice: price, pnl, closeReason: ev.closeReason === 'manual' ? 'manual' : ((ev.closeReason as any) || 'manual'), closedAt: Date.now() });
        await store.saveBalance(balance + pnl).catch(() => {});
        guardMarkClosed(sym);
        markSeen(ev.id); // executed — never reprocess
        balance = balance + pnl;
        allTrades = await store.listTrades().catch(() => allTrades);
        executed.push(ev);
        console.log(`[TradeMirror] mirrored close ${sym} (${ev.closeReason})`);
      }
    } catch (e) {
      // Transient failure — do NOT mark seen; retry on the next poll.
      console.warn('[TradeMirror] execute failed for', ev.id, (e as any)?.message || e);
    }
  }
  writeMirrorSeen(seen);
  return executed;
}

/**
 * REAL-TIME mirror listener — the client subscribes once to `shared_trades`
 * and runs the SAME pollMirrorEvents pipeline the moment any event lands,
 * so a developer open executes on the client device within milliseconds
 * (instead of waiting for the next 10s poll). Dedupe, the analysis-only
 * fence and retry semantics are shared with the poll path.
 * Returns an unsubscribe function.
 */
export function listenMirrorEvents(opts: {
  user: any;
  playChampagne: () => void;
  notify: (msg: string) => void;
  displayedSymbols?: string[];
  mode?: 'free' | 'paid';
  force?: boolean;
  allowOpen?: boolean;
}): VoidFunction {
  let busy = false;
  const trigger = () => {
    if (busy) return;
    busy = true;
    pollMirrorEvents(opts)
      .then((executed) => {
        if (executed.length) console.log(`[TradeMirror] realtime pass executed ${executed.length} event(s)`);
      })
      .catch((e) => console.warn('[TradeMirror] realtime pass failed:', (e as any)?.message || e))
      .finally(() => { busy = false; });
  };
  const unsub = onSnapshot(
    collection(db, MIRROR_COLLECTION),
    {
      next: () => trigger(),
      error: (err) => console.warn('[TradeMirror] realtime listener error:', err),
    },
  );
  return () => {
    try { unsub(); } catch { /* already unsubscribed */ }
  };
}

/**
 * DEVELOPER SIDE â€” bulk-publish manual-analysis results as mirror OPEN events
 * so subscribed clients can copy them into their own accounts.
 *
 * - Keeps only executable signals (buy/sell/strong_buy/strong_sell).
 * - One event per symbol (the strongest by confidence) â€” no duplicates.
 * - Honours a per-symbol cooldown (default 15 min) so the same symbol isn't
 *   re-broadcast every cycle.
 * - Writes directly to `shared_trades` (public); clients execute via
 *   `pollMirrorEvents` / `listenMirrorEvents` with their own guards.
 */
export async function publishMirrorEventsFor(
  signals: AnalysisResult[],
  opts: { maxPerSymbol?: number; cooldownMs?: number; origin?: string } = {},
): Promise<{ published: number; skipped: number }> {
  const { maxPerSymbol = 1, cooldownMs = 15 * 60 * 1000, origin = 'mobile' } = opts;
  const now = Date.now();

  const bySymbol = new Map<string, AnalysisResult[]>();
  for (const s of signals || []) {
    const sig = String(s.signal || '').toLowerCase();
    if (sig !== 'strong_buy' && sig !== 'strong_sell' && sig !== 'buy' && sig !== 'sell') continue;
    const arr = bySymbol.get(s.symbol) || [];
    arr.push(s);
    bySymbol.set(s.symbol, arr);
  }

  const lastRaw = localStorage.getItem('finalyze_mirror_last_publish_v1');
  const lastPublish: Record<string, number> = lastRaw ? JSON.parse(lastRaw) : {};

  let published = 0;
  let skipped = 0;

  for (const [sym, arr] of bySymbol) {
    arr.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const best = arr[0];
    const side: 'buy' | 'sell' = best.signal === 'strong_sell' || best.signal === 'sell' ? 'sell' : 'buy';

    const last = lastPublish[sym] || 0;
    if (now - last < cooldownMs) { skipped++; continue; }

    const openedAt = now;
    try {
      await broadcastMirrorEvent({
        id: `open:${sym}:${openedAt}`,
        kind: 'open',
        symbol: sym,
        side,
        signal: best.signal,
        openedAt,
        devEntry: best.entryPrice ?? null,
        devSl: best.stopLoss ?? null,
        devTp: best.takeProfit ?? null,
        origin,
      });
      lastPublish[sym] = now;
      published++;
    } catch {
      skipped++;
    }
  }

  try { localStorage.setItem('finalyze_mirror_last_publish_v1', JSON.stringify(lastPublish)); } catch {}
  return { published, skipped };
}

