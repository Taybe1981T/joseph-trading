// Shared, persistent auto-trade guard.
//
// WHY THIS EXISTS
// The auto-trade "already opened / recently closed" bookkeeping used to live in
// component/engine memory only. A page refresh, a hard reload, or navigating
// away from the trade page and back wiped that memory, so the engine believed
// every symbol was brand-new and RE-OPENED the same displayed signal again —
// the "same trade re-opens over and over" bug.
//
// This module persists that guard in localStorage so it survives reloads. A
// symbol is marked "opened" the instant a position opens and is only cleared
// when that position is actually closed — never on refresh. The cooldown
// (lastClosedAt) is persisted too, so a still-valid signal can re-open a fresh
// position a few seconds after a close, but a reload never triggers a re-open.

const GUARD_KEY = 'finalyze_auto_guard_v1';

interface GuardState {
  opened: string[];                 // symbols with a live auto position
  closed: Record<string, number>;   // symbol -> epoch ms of last auto-close
}

function read(): GuardState {
  try {
    const raw = JSON.parse(localStorage.getItem(GUARD_KEY) || '{}');
    return {
      opened: Array.isArray(raw.opened) ? raw.opened.filter((s: any) => typeof s === 'string') : [],
      closed: raw.closed && typeof raw.closed === 'object' ? raw.closed : {},
    };
  } catch {
    return { opened: [], closed: {} };
  }
}

function write(s: GuardState) {
  try { localStorage.setItem(GUARD_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

export function isOpened(sym: string): boolean {
  return read().opened.includes(sym);
}

export function markOpened(sym: string): void {
  const s = read();
  if (!s.opened.includes(sym)) { s.opened.push(sym); write(s); }
}

export function clearOpened(sym: string): void {
  const s = read();
  if (s.opened.includes(sym)) { s.opened = s.opened.filter((x) => x !== sym); write(s); }
}

export function markClosed(sym: string, at: number = Date.now()): void {
  const s = read();
  s.opened = s.opened.filter((x) => x !== sym);
  s.closed[sym] = at;
  write(s);
}

export function lastClosedAt(sym: string): number {
  return read().closed[sym] || 0;
}

// Test/maintenance helper: wipe the whole guard.
export function resetGuard(): void {
  try { localStorage.removeItem(GUARD_KEY); } catch { /* ignore */ }
}
