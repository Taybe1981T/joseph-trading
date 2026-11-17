/**
 * Cross-device signal feed helpers.
 *
 * `shared_results/latest` is the single public document every free/guest view
 * (and every developer device) reads. Besides the visible `results` array it now
 * carries two deletion markers so a developer deletion can never be resurrected
 * by another device's stale re-publish:
 *
 *   deletedSymbols: { SYMBOL: timestampMs }  — one entry per deleted symbol
 *   clearedAt: timestampMs                   — last "clear all signals"
 *
 * A signal is hidden when its own `timestamp` is NOT newer than the matching
 * marker. A brand-new analysis therefore re-appears normally, while an old
 * signal copied back by another device stays deleted. This is what makes a
 * deletion on the desktop apply on the phone (and vice-versa) without a reload.
 */
import { db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export const SHARED_RESULTS_COLLECTION = 'shared_results';
export const SHARED_RESULTS_ID = 'latest';

/** Keep the tombstone map bounded — only the most recent deletions matter. */
const MAX_TOMBSTONES = 150;

export interface SharedSignalFeed {
  results: any[];
  deletedSymbols: Record<string, number>;
  clearedAt: number;
  timestamp: string;
  developerEmail: string;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Normalise a raw Firestore payload (missing/invalid fields tolerated). */
export function normaliseSharedFeed(raw: any): SharedSignalFeed {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const deletedRaw = raw?.deletedSymbols;
  const deletedSymbols: Record<string, number> = {};
  if (deletedRaw && typeof deletedRaw === 'object' && !Array.isArray(deletedRaw)) {
    for (const [k, v] of Object.entries(deletedRaw)) {
      const ts = num(v);
      if (k && ts) deletedSymbols[String(k).toUpperCase()] = ts;
    }
  }
  return {
    results,
    deletedSymbols,
    clearedAt: num(raw?.clearedAt),
    timestamp: typeof raw?.timestamp === 'string' ? raw.timestamp : '',
    developerEmail: typeof raw?.developerEmail === 'string' ? raw.developerEmail : '',
  };
}

/** Read the current shared feed body (never throws). */
export async function readSharedSignalFeed(): Promise<SharedSignalFeed> {
  try {
    const snap = await getDoc(doc(db, SHARED_RESULTS_COLLECTION, SHARED_RESULTS_ID));
    return normaliseSharedFeed(snap.exists() ? snap.data() : null);
  } catch {
    return normaliseSharedFeed(null);
  }
}

/** Signal creation time (ISO `timestamp` field) in ms. */
export function signalTimestampMs(signal: any): number {
  const raw = signal?.timestamp;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }
  const maybe = raw?.toMillis ? raw.toMillis() : raw?.seconds ? raw.seconds * 1000 : 0;
  return num(maybe);
}

/**
 * Drop every signal hidden by a tombstone / clear marker. Idempotent, so it can
 * run on every poll. Signals without a usable timestamp are only dropped when
 * their symbol was explicitly deleted (never by `clearedAt`).
 */
export function applySignalTombstones(
  results: any[],
  feed: Pick<SharedSignalFeed, 'deletedSymbols' | 'clearedAt'> | null | undefined,
): any[] {
  if (!Array.isArray(results) || !feed) return Array.isArray(results) ? results : [];
  const deleted = feed.deletedSymbols || {};
  const clearedAt = num(feed.clearedAt);
  return results.filter((r: any) => {
    const sym = String(r?.symbol || '').toUpperCase();
    const ts = signalTimestampMs(r);
    if (clearedAt && ts && ts <= clearedAt) return false;
    const del = num(deleted[sym]);
    if (del && (!ts || ts <= del)) return false;
    return true;
  });
}

/**
 * Publish the developer's signal feed.
 *
 * Normal publishes merge (so the deletion markers survive). Only a wholesale
 * clear replaces the document and stamps `clearedAt`, which hides every signal
 * generated before that instant on every device.
 */
export async function publishSharedSignals(
  results: any[],
  opts: {
    developerEmail?: string;
    /** A single symbol the developer just deleted. */
    deletedSymbol?: string;
    /** The developer pressed "clear all". */
    clearAll?: boolean;
  } = {},
): Promise<void> {
  const safeResults: any[] = Array.isArray(results)
    ? JSON.parse(JSON.stringify(results))
    : [];
  const now = Date.now();
  const email = opts.developerEmail || '';

  if (opts.clearAll) {
    await setDoc(doc(db, SHARED_RESULTS_COLLECTION, SHARED_RESULTS_ID), {
      results: [],
      deletedSymbols: {},
      clearedAt: now,
      timestamp: new Date(now).toISOString(),
      developerEmail: email,
    });
    return;
  }

  if (!opts.deletedSymbol) {
    // Cheap path (radar batches, startup sync): merge so markers persist.
    await setDoc(doc(db, SHARED_RESULTS_COLLECTION, SHARED_RESULTS_ID), {
      results: safeResults,
      timestamp: new Date(now).toISOString(),
      developerEmail: email,
    }, { merge: true });
    return;
  }

  // Deletion: read/modify/write so the tombstone map is pruned deterministically.
  const prev = await readSharedSignalFeed();
  const deleted: Record<string, number> = { ...prev.deletedSymbols };
  deleted[String(opts.deletedSymbol).toUpperCase()] = now;
  const pruned = Object.entries(deleted)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, MAX_TOMBSTONES);
  const deletedSymbols: Record<string, number> = {};
  for (const [k, v] of pruned) deletedSymbols[k] = Number(v);
  await setDoc(doc(db, SHARED_RESULTS_COLLECTION, SHARED_RESULTS_ID), {
    results: safeResults,
    deletedSymbols,
    clearedAt: prev.clearedAt || 0,
    timestamp: new Date(now).toISOString(),
    developerEmail: email || prev.developerEmail || '',
  });
}
