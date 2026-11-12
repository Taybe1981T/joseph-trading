// Per-account, per-UTC-day manual-analysis quota.
//
// Paid clients are limited to a small number of manual analyses every 24 hours
// (resetting at 00:00 UTC). Three independent buckets exist:
//   - 'fullBatch'    : all categories at once          -> 6 / day
//   - 'perCategory'  : all symbols of one category     -> 6 / day per category
//   - 'individual'   : 1..10 symbols                  -> 20 / day
//
// Developers are never limited. Free/guest accounts are handled by the existing
// symbol locks and never reach this module.
//
// Shared by the desktop site and the mobile app (same localStorage shape, keyed
// by the signed-in email so the two platforms stay in sync on one device).

import { isDeveloperEmail } from '../lib/clientIds';

export const MANUAL_QUOTA_MSG_AR =
  'لقد استنفدت رصيد التحليل اليومي، انتظر حتى بداية يوم آخر لتجديد الرصيد تلقائياً بعد 12 ليلاً بتوقيت غرينتش';
export const MANUAL_QUOTA_MSG_EN =
  'You have exhausted your daily analysis balance. Wait until the start of a new day for automatic renewal at midnight UTC (GMT).';

export const MANUAL_QUOTA_LIMITS = {
  fullBatch: 6,
  perCategory: 6,
  individual: 20,
};

export type ManualQuotaBucket = 'fullBatch' | 'perCategory' | 'individual';

interface BucketState {
  fullBatch: number;
  perCategory: Record<string, number>;
  individual: number;
}

interface QuotaState {
  date: string; // UTC YYYY-MM-DD
  buckets: BucketState;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function storageKey(email: string): string {
  return `finalyze_manual_quota_${(email || '').toLowerCase().trim()}`;
}

function loadState(email: string): QuotaState {
  const empty: QuotaState = { date: todayUTC(), buckets: { fullBatch: 0, perCategory: {}, individual: 0 } };
  if (!email) return empty;
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== todayUTC()) return empty; // new day -> reset
    return {
      date: parsed.date,
      buckets: {
        fullBatch: Number(parsed.buckets?.fullBatch || 0),
        perCategory: parsed.buckets?.perCategory || {},
        individual: Number(parsed.buckets?.individual || 0),
      },
    };
  } catch {
    return empty;
  }
}

function saveState(email: string, state: QuotaState): void {
  if (!email) return;
  try { localStorage.setItem(storageKey(email), JSON.stringify(state)); } catch {}
}

export function isDeveloperAccount(email: string | null | undefined): boolean {
  return isDeveloperEmail(email);
}

/**
 * Classify a manual request into one of the three buckets.
 *  - 1..10 symbols -> 'individual'
 *  - >10 symbols spanning a single category -> 'perCategory'
 *  - >10 symbols spanning multiple categories -> 'fullBatch'
 */
export function classifyManualSymbols(
  selectedSymbols: string[],
  categorySymbols: Record<string, string[]>,
): { bucket: ManualQuotaBucket; category?: string } {
  const n = selectedSymbols.length;
  if (n >= 1 && n <= 10) return { bucket: 'individual' };
  const set = new Set(selectedSymbols);
  for (const [cat, syms] of Object.entries(categorySymbols)) {
    if (syms.length > 0 && syms.length === n && syms.every((s) => set.has(s))) {
      return { bucket: 'perCategory', category: cat };
    }
  }
  return { bucket: 'fullBatch' };
}

/**
 * Returns whether a manual analysis may run, and consumes one unit if allowed.
 * Developers are never limited. Returns { allowed, message }.
 */
export function tryConsumeManualQuota(
  email: string | null | undefined,
  bucket: ManualQuotaBucket,
  category?: string,
  lang: 'ar' | 'en' = 'en',
): { allowed: boolean; message?: string } {
  if (isDeveloperEmail(email)) return { allowed: true };
  if (!email) return { allowed: false, message: lang === 'ar' ? MANUAL_QUOTA_MSG_AR : MANUAL_QUOTA_MSG_EN };

  const state = loadState(email);
  const limit = MANUAL_QUOTA_LIMITS[bucket];
  const msg = lang === 'ar' ? MANUAL_QUOTA_MSG_AR : MANUAL_QUOTA_MSG_EN;

  if (bucket === 'perCategory') {
    const cat = category || 'all';
    const used = Number(state.buckets.perCategory[cat] || 0);
    if (used >= limit) return { allowed: false, message: msg };
    state.buckets.perCategory[cat] = used + 1;
  } else if (bucket === 'fullBatch') {
    if (state.buckets.fullBatch >= limit) return { allowed: false, message: msg };
    state.buckets.fullBatch += 1;
  } else {
    if (state.buckets.individual >= limit) return { allowed: false, message: msg };
    state.buckets.individual += 1;
  }

  saveState(email, state);
  return { allowed: true };
}

/** Remaining counts for display (optional). */
export function getManualQuotaRemaining(email: string | null | undefined): { fullBatch: number; perCategory: (cat: string) => number; individual: number } {
  if (isDeveloperEmail(email)) return { fullBatch: Infinity, perCategory: () => Infinity, individual: Infinity };
  const state = loadState(email || '');
  return {
    fullBatch: Math.max(0, MANUAL_QUOTA_LIMITS.fullBatch - state.buckets.fullBatch),
    perCategory: (cat: string) => Math.max(0, MANUAL_QUOTA_LIMITS.perCategory - Number(state.buckets.perCategory[cat] || 0)),
    individual: Math.max(0, MANUAL_QUOTA_LIMITS.individual - state.buckets.individual),
  };
}
