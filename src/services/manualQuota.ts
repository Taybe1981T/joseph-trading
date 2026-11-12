// Per-account, per-symbol, per-UTC-day analysis quota (simplified).
//
// Rule (same on desktop and mobile):
//   A paid client may analyze any symbol at most 5 times per day, counted across
//   BOTH manual and automatic analysis.
//   - Analyzing one symbol consumes 1 unit of that symbol.
//   - Analyzing a whole category (all its symbols) consumes 1 unit of each of
//     those symbols.
//   - Analyzing every category at once consumes 1 unit of every symbol involved.
//   Example: a symbol analyzed 2 times has 3 units left. When it reaches 5 it is
//   blocked for the rest of the day and becomes available again after 00:00 UTC
//   (midnight GMT), when the counter resets automatically.
//
// Developers are never limited. Free/guest accounts are handled by the existing
// symbol locks and never reach this module.
//
// Shared by the desktop site and the mobile app (same localStorage shape, keyed
// by the signed-in email so both platforms agree on one device).

import { isDeveloperEmail } from '../lib/clientIds';

export const SYMBOL_DAILY_LIMIT = 5;

export const QUOTA_RESET_HINT_AR =
  'يتجدد الرصيد تلقائياً بعد منتصف الليل بتوقيت غرينتش (00:00 UTC).';
export const QUOTA_RESET_HINT_EN =
  'The balance renews automatically after midnight GMT (00:00 UTC).';

interface QuotaState {
  date: string; // UTC YYYY-MM-DD
  counts: Record<string, number>;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase();
}

function storageKey(email: string): string {
  return `finalyze_symbol_quota_${(email || '').toLowerCase().trim()}`;
}

function loadState(email: string): QuotaState {
  const empty: QuotaState = { date: todayUTC(), counts: {} };
  if (!email) return empty;
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== todayUTC() || !parsed.counts) return empty; // new day -> reset
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.counts)) counts[normalizeSymbol(k)] = Number(v) || 0;
    return { date: parsed.date, counts };
  } catch {
    return empty;
  }
}

function saveState(email: string, state: QuotaState): void {
  if (!email) return;
  try { localStorage.setItem(storageKey(email), JSON.stringify(state)); } catch {}
}

/** How many times `symbol` was already analyzed today (UTC). */
export function getSymbolUsage(email: string | null | undefined, symbol: string): number {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return 0;
  const st = loadState(e);
  return Number(st.counts[normalizeSymbol(symbol)] || 0);
}

/** Remaining analyses for `symbol` today. Developers get Infinity. */
export function getSymbolRemaining(email: string | null | undefined, symbol: string): number {
  if (isDeveloperEmail(email)) return Infinity;
  return Math.max(0, SYMBOL_DAILY_LIMIT - getSymbolUsage(email, symbol));
}

/** True when `symbol` reached the daily cap and must not be analyzed again. */
export function isSymbolExhausted(email: string | null | undefined, symbol: string): boolean {
  if (isDeveloperEmail(email)) return false;
  return getSymbolUsage(email, symbol) >= SYMBOL_DAILY_LIMIT;
}

/** Symbols (from `symbols`) that already reached the daily cap. */
export function getExhaustedSymbols(email: string | null | undefined, symbols: string[]): string[] {
  if (isDeveloperEmail(email)) return [];
  const unique = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  return unique.filter((s) => isSymbolExhausted(email, s));
}

/** Builds the user-facing message listing the blocked symbols. */
export function symbolQuotaMessage(symbols: string[], lang: 'ar' | 'en' = 'ar'): string {
  const list = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].join(', ');
  if (lang === 'ar') {
    return `لقد وصل الرمز ${list} إلى الحد الأقصى (${SYMBOL_DAILY_LIMIT} مرات) للتحليل اليوم. لا يمكن إعادة تحليل هذا الرمز اليوم. ${QUOTA_RESET_HINT_AR}`;
  }
  return `Symbol ${list} reached the daily maximum (${SYMBOL_DAILY_LIMIT} analyses today) and cannot be analyzed again today. ${QUOTA_RESET_HINT_EN}`;
}

/**
 * Consumes one analysis unit for each allowed symbol and reports the rest.
 * - Developers / missing email: everything is allowed and nothing is counted.
 * - Already-exhausted symbols are returned in `blocked` and NOT counted.
 * - `message` is present only when at least one symbol was blocked.
 */
export function consumeSymbolAnalyses(
  email: string | null | undefined,
  symbols: string[],
  lang: 'ar' | 'en' = 'ar',
): { allowed: string[]; blocked: string[]; message?: string } {
  const unique = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const e = String(email || '').toLowerCase().trim();
  if (!e || isDeveloperEmail(e)) return { allowed: unique, blocked: [] };

  const st = loadState(e);
  const allowed: string[] = [];
  const blocked: string[] = [];

  for (const sym of unique) {
    const used = Number(st.counts[sym] || 0);
    if (used >= SYMBOL_DAILY_LIMIT) {
      blocked.push(sym);
    } else {
      st.counts[sym] = used + 1;
      allowed.push(sym);
    }
  }

  if (allowed.length > 0) saveState(e, st);
  return blocked.length > 0
    ? { allowed, blocked, message: symbolQuotaMessage(blocked, lang) }
    : { allowed, blocked };
}

/** Clears the whole daily counter for an account (developer/testing helper). */
export function resetSymbolQuota(email: string | null | undefined): void {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return;
  try { localStorage.removeItem(storageKey(e)); } catch {}
}
