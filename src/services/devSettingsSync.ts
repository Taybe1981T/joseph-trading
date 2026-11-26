import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { applySharedValues } from '../lib/sharedSettingsApply';

/**
 * Developer settings — ONE account, two devices.
 *
 * Every manual change a developer makes on the desktop must appear on the phone
 * (and vice versa) within ~1 second. The source of truth is the public-read,
 * developer-write document `shared_settings/dev_sync`; localStorage stays the
 * fast, offline cache every screen already reads.
 *
 * Safety rules:
 *   • Only a developer session starts the sync (clients never write/apply).
 *   • Only plain, non-secret settings keys are mirrored. API keys, the GitHub
 *     token, developer e-mail/phone and large data URLs (logo/avatar) are
 *     deliberately excluded because the document is publicly readable and has
 *     a 1 MiB size limit.
 *   • Values are JSON/localStorage strings, exactly as stored on the device, so
 *     applying a remote value is a byte-for-byte replacement.
 *   • Trade data, history, signals and plan/identity records are NEVER synced:
 *     they belong to the individual account/device.
 */

export const DEV_SYNC_DOC = 'dev_sync';
export const DEV_SETTINGS_EVENT = 'finalyze:dev-settings-sync';

/** Settings that must behave as one shared developer account. */
export const DEV_SYNC_KEYS: string[] = [
  // Analysis engine / filters (Salman's settings)
  'strategy_settings',
  // Auto trade master switch
  'paper_trading_auto_trade',
  // Store / client access switches
  'finalyze_mirror_free_allowed',
  'finalyze_freemium_disabled',
  'finalyze_client_login_required',
  'finalyze_hide_plans',
  'subscription_prices',
  // Store payment wait period (cached copy; the shared doc also exists)
  'payment_timer_hours',
  // Brand / appearance
  'card_color',
  'language',
  'theme',
  'finalyze_ui_click_sound',
  // Symbol library additions / removals
  'finalyze_custom_symbols',
  'finalyze_hidden_symbols',
  'finalyze_custom_tv_symbols',
];

/**
 * Entry/analysis logic that a subscribed client inherits from the developer
 * while actually using the paid plan. `auto_settings` stays per-device (the
 * radar ON/OFF and cadence belong to the client), and identity/payment keys
 * are never copied.
 */
export const CLIENT_ENTRY_SYNC_KEYS: readonly string[] = ['strategy_settings'];

const POLL_MS = 900;
const DEVICE_ID_KEY = 'finalyze_device_id';

function newDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable id for THIS browser/phone, so a device can ignore its own writes. */
export function devDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = newDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return 'unknown-device';
  }
}

type Snapshot = Record<string, string | null>;

function readSnapshot(): Snapshot {
  const out: Snapshot = {};
  for (const key of DEV_SYNC_KEYS) {
    try {
      let v = localStorage.getItem(key);
      // The radar on/off toggle is per-device: strip it from the synced value
      // so it can never propagate (and never triggers a sync by itself).
      if (key === 'auto_settings' && typeof v === 'string') {
        try {
          const o = JSON.parse(v);
          if (o && typeof o === 'object') { delete o.isEnabled; v = JSON.stringify(o); }
        } catch {}
      }
      out[key] = v;
    } catch { out[key] = null; }
  }
  return out;
}

/** Only non-null values are published, so a device that never set a key can
 *  never wipe the other device's value. */
function toPublishedValues(snap: Snapshot): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of DEV_SYNC_KEYS) {
    const value = snap[key];
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

function emitApplied(keys: string[]) {
  try {
    window.dispatchEvent(new CustomEvent(DEV_SETTINGS_EVENT, { detail: { keys, remote: true } }));
  } catch {}
}

export interface DevSettingsSyncOptions {
  /** Developer session only. When false the starter is a no-op. */
  isDeveloper: boolean;
  /** Called after remote values have been written to localStorage. */
  onApplied?: (keys: string[]) => void;
}

/**
 * Starts the two-way sync. Returns a cleanup function.
 *
 * - `onSnapshot` pulls remote changes instantly and applies them to
 *   localStorage (then fires DEV_SETTINGS_EVENT so React state re-reads).
 * - A light poll detects manual/localStorage changes and pushes them to the
 *   shared document. Failed writes (offline / not signed in yet) are retried.
 */
export function startDevSettingsSync(opts: DevSettingsSyncOptions): () => void {
  if (!opts.isDeveloper) return () => {};

  const myId = devDeviceId();
  let stopped = false;
  let applyingRemote = false;
  // Last state we are sure of: pushed to Firestore or applied from a remote.
  let baseline = readSnapshot();
  let pendingWrite = false;

  const publish = async (snap: Snapshot) => {
    if (!auth.currentUser) return false; // wait for the developer session
    try {
      await setDoc(
        doc(db, 'shared_settings', DEV_SYNC_DOC),
        { values: toPublishedValues(snap), writer: myId, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch (e) {
      console.warn('[dev-sync] write failed:', e);
      return false;
    }
  };

  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = onSnapshot(
      doc(db, 'shared_settings', DEV_SYNC_DOC),
      (snap) => {
        if (stopped || !snap.exists()) return;
        const data: any = snap.data() || {};
        if (data.writer === myId) return; // our own write — never echo
        const values = data.values;
        if (!values || typeof values !== 'object') return;

        applyingRemote = true;
        const changed: string[] = [];
        try {
          for (const key of DEV_SYNC_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
            const incoming = values[key];
            if (typeof incoming !== 'string') continue;
            let toStore = incoming;
            // The radar on/off toggle is PER-DEVICE: a developer pressing it on
            // the desktop must NOT start/stop the radar on the phone (and vice
            // versa). Other auto_settings fields (interval, category, volume,
            // ...) still sync. Preserve the local isEnabled on apply.
            if (key === 'auto_settings') {
              try {
                const local = JSON.parse(localStorage.getItem(key) || '{}');
                const remote = JSON.parse(incoming);
                if (local && typeof local === 'object' && local.isEnabled !== undefined) {
                  remote.isEnabled = local.isEnabled;
                } else if (remote.isEnabled === undefined) {
                  remote.isEnabled = false;
                }
                toStore = JSON.stringify(remote);
              } catch {}
            }
            let current: string | null = null;
            try { current = localStorage.getItem(key); } catch {}
            if (current === toStore) continue;
            try { localStorage.setItem(key, toStore); } catch {}
            changed.push(key);
          }
          // Remote is authoritative: rebase the poll so we don't bounce it back.
          baseline = readSnapshot();
          pendingWrite = false;
        } finally {
          applyingRemote = false;
        }

        if (changed.length > 0) {
          emitApplied(changed);
          try { opts.onApplied?.(changed); } catch {}
        }
      },
      (err) => console.warn('[dev-sync] listener unavailable:', err),
    );
  } catch (e) {
    console.warn('[dev-sync] could not start listener:', e);
  }

  const timer = setInterval(() => {
    if (stopped || applyingRemote) return;
    const now = readSnapshot();
    let dirty = pendingWrite;
    for (const key of DEV_SYNC_KEYS) {
      if (now[key] !== baseline[key]) { dirty = true; break; }
    }
    if (!dirty) return;

    // Optimistically mark clean; if the write fails we keep dirty and retry.
    pendingWrite = true;
    void publish(now).then((ok) => {
      if (stopped) return;
      if (ok) {
        baseline = now;
        pendingWrite = false;
      }
    });
  }, POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    try { unsubscribe?.(); } catch {}
  };
}

/**
 * READ-ONLY mirror for a subscribed client. The desktop developer's entry
 * settings (strategy_settings) drive the same analysis logic on the client's
 * phone while their plan is active. This function NEVER writes to Firestore,
 * so a client can only receive values, never change the shared developer doc.
 */
export function startClientEntrySettingsMirror(): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = onSnapshot(
      doc(db, 'shared_settings', DEV_SYNC_DOC),
      (snap) => {
        if (stopped || !snap.exists()) return;
        const data: any = snap.data() || {};
        const changed = applySharedValues(data.values, CLIENT_ENTRY_SYNC_KEYS, localStorage);
        if (changed.length > 0) emitApplied(changed);
      },
      (err) => console.warn('[client-settings] listener unavailable:', err),
    );
  } catch (e) {
    console.warn('[client-settings] could not start listener:', e);
  }
  return () => {
    stopped = true;
    try { unsubscribe?.(); } catch {}
  };
}
