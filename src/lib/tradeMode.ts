/**
 * Trade display mode — free vs paid.
 *
 * A client can switch between the FREE view (developer signals, read-only) and
 * the PAID view (the client's own analysis). Trades are tagged with the mode
 * they were opened in, and the platform only DISPLAYS the trades that belong to
 * the mode currently in use:
 *
 *   • a free-mode trade (copy of a developer signal) disappears when the client
 *     switches to paid, and reappears automatically when they return to free;
 *   • a paid-mode trade is only shown while paid mode is active.
 *
 * The trade itself is NEVER deleted or closed by a mode switch — this is a
 * display scope only, so balances/P&L stay intact.
 */

import { isDeveloperEmail } from './clientIds';
import { clientScopeKey, currentUserEmail } from './clientScope';

export type TradeMode = 'free' | 'paid';

function storedEmail(email?: string | null): string {
  if (email && email.includes('@')) return email.toLowerCase().trim();
  try {
    const raw = localStorage.getItem('finalyze_user') || localStorage.getItem('finalyze_auth_user');
    const o = raw ? JSON.parse(raw) : null;
    const e = String(o?.email || '').toLowerCase().trim();
    if (e) return e;
  } catch {}
  return (currentUserEmail() || '').toLowerCase().trim();
}

/**
 * The mode currently in use on this device for this account.
 * Mirrors `isPlanClient` on desktop and mobile:
 *   developer                  → paid (own analysis / all data)
 *   explicit free_mode = true  → free
 *   paid_mode = false          → free
 *   no owned running plan      → free
 *   otherwise                  → paid
 */
export function currentTradeMode(email?: string | null): TradeMode {
  const e = storedEmail(email);
  if (!e) return 'free';
  if (isDeveloperEmail(e)) return 'paid';
  try {
    if (localStorage.getItem(clientScopeKey(e, 'free_mode')) === 'true') return 'free';
    if (localStorage.getItem(clientScopeKey(e, 'paid_mode')) === 'false') return 'free';
    const raw = localStorage.getItem('active_subscription');
    const sub = raw ? JSON.parse(raw) : null;
    if (!sub || String(sub?.email || '').toLowerCase().trim() !== e) return 'free';
    if (sub?.expiryDate) {
      const ms = new Date(sub.expiryDate).getTime();
      if (isFinite(ms) && ms <= Date.now()) return 'free';
    }
    return 'paid';
  } catch {
    return 'free';
  }
}

/** Whether a trade belongs to the mode currently in use. */
export function isTradeVisibleInMode(tradeMode: TradeMode | undefined | null, active: TradeMode): boolean {
  if (!tradeMode) return true; // legacy trade (stamped by the one-time migration)
  return tradeMode === active;
}

interface TradeStoreLike {
  listTrades(): Promise<any[]>;
  updateTrade(id: string, patch: any): Promise<void>;
}

/**
 * ONE-TIME migration for trades created before mode tagging existed.
 *
 * Manual/legacy trades are stamped with the current mode. Legacy AUTO trades
 * (copy-trades opened from the developer feed) are stamped `free` unless their
 * symbol is part of the client's own paid analysis — this is what makes the
 * old free-mode positions disappear immediately after upgrading to paid.
 */
export async function stampLegacyTradeModes(
  store: TradeStoreLike,
  active: TradeMode,
  paidSymbols: string[] = [],
  email?: string | null,
): Promise<void> {
  const e = storedEmail(email) || 'guest';
  const safe = e.replace(/[^a-z0-9@._-]/g, '_');
  const marker = `finalyze_trade_mode_stamped_v1__${safe}`;
  try {
    if (localStorage.getItem(marker) === '1') return;
  } catch {}
  // In PAID mode we can only tell a legacy copy-trade apart from the client's
  // own auto trade by comparing symbols with their own paid analysis. If that
  // analysis has not loaded yet, DO NOT stamp (and do not set the marker) — a
  // blind run would hide the client's real positions as "free" copy trades.
  // The migration retries on the next load, after the signals are available.
  if (active === 'paid' && paidSymbols.length === 0) return;
  let list: any[] = [];
  try { list = await store.listTrades(); } catch { return; }
  const paidSet = new Set((paidSymbols || []).map((s) => String(s || '').toUpperCase()));
  for (const t of list) {
    if (!t || t.mode === 'free' || t.mode === 'paid') continue;
    let mode: TradeMode = active;
    if (t.source === 'auto' && active === 'paid') {
      mode = paidSet.has(String(t.symbol || '').toUpperCase()) ? 'paid' : 'free';
    }
    try { await store.updateTrade(t.id, { mode }); } catch {}
  }
  try { localStorage.setItem(marker, '1'); } catch {}
}
