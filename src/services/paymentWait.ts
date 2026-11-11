import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

// The payment wait period must be ONE number for the whole site: the developer
// sets it once, and every desktop + phone client reads the same value. It used
// to live in localStorage only, so a client device that never visited Store
// Settings kept showing the old 1-hour default. It is now a public-read,
// developer-write document in Firestore, with localStorage as an offline cache.
export const PAYMENT_WAIT_DOC = 'payment_timer';
export const DEFAULT_PAYMENT_WAIT_HOURS = 48;

const TIMER_STORAGE_KEY = 'payment_timer_hours';
const LEGACY_TIMER_KEY = 'payment_timer_minutes';
const MAX_WAIT_HOURS = 24 * 30; // a wait period is never longer than a month

function normalizeHours(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_WAIT_HOURS, Math.max(1, Math.round(n)));
}

/** Offline/last-known value. Defaults to 48h when this device never had one. */
export function readCachedWaitHours(): number {
  try {
    const saved = normalizeHours(localStorage.getItem(TIMER_STORAGE_KEY));
    if (saved) return saved;
    // One-time migration of the old minutes value (30 min -> 1 h).
    const mins = normalizeHours(localStorage.getItem(LEGACY_TIMER_KEY));
    if (mins) {
      const migrated = Math.max(1, Math.round(mins / 60));
      localStorage.setItem(TIMER_STORAGE_KEY, String(migrated));
      localStorage.removeItem(LEGACY_TIMER_KEY);
      return migrated;
    }
  } catch {}
  return DEFAULT_PAYMENT_WAIT_HOURS;
}

function cacheWaitHours(hours: number): number {
  const h = normalizeHours(hours) ?? DEFAULT_PAYMENT_WAIT_HOURS;
  try { localStorage.setItem(TIMER_STORAGE_KEY, String(h)); } catch {}
  return h;
}

/**
 * Reads the shared wait period. `seedIfMissing` (developer screen only) writes
 * the site default once so older installs migrate to the shared document.
 */
export async function loadPaymentWaitHours(opts: { seedIfMissing?: boolean } = {}): Promise<number> {
  try {
    const snap = await getDoc(doc(db, 'shared_settings', PAYMENT_WAIT_DOC));
    if (snap.exists()) {
      const shared = normalizeHours((snap.data() as any)?.hours);
      if (shared) return cacheWaitHours(shared);
    }
    // No document yet: the site-wide default is 48h, not the old 1h fallback.
    if (opts.seedIfMissing) {
      try { await savePaymentWaitHours(DEFAULT_PAYMENT_WAIT_HOURS); } catch {}
    }
    return cacheWaitHours(DEFAULT_PAYMENT_WAIT_HOURS);
  } catch {
    // Offline or read failed: last known value, else 48h.
    return readCachedWaitHours();
  }
}

/** Developer-only write (firestore.rules: shared_settings write = developer). */
export async function savePaymentWaitHours(hours: number): Promise<number> {
  const h = cacheWaitHours(hours);
  await setDoc(
    doc(db, 'shared_settings', PAYMENT_WAIT_DOC),
    { hours: h, updatedAt: Date.now() },
    { merge: true },
  );
  return h;
}
