/**
 * Auto-analysis start gate — shared by the desktop site and the mobile app.
 *
 * Rule requested by the owner: a client with an active plan must NOT start a
 * scan merely because the page was refreshed or the app was reopened.
 * Auto-analysis may start ONLY:
 *
 *   1. when the client turns it ON manually, or
 *   2. when the periodic re-analysis interval is actually due.
 *
 * Opening/refreshing therefore only resumes the interval timer: a scan runs
 * when `lastFinishedAt + interval` has passed, never just because the page
 * loaded. `flagManualRadarStart()` is called from the exact user action that
 * switches auto-analysis ON.
 */

const SESSION_KEY = 'finalyze_radar_session_v1';

let sessionFresh: boolean | null = null;
let manualStartPending = false;
// Armed = the client turned auto-analysis ON in THIS page session. A refresh or
// a fresh app open reloads the module, so it always starts unarmed: the client
// must press ON again, then the interval loop continues on its own.
let autoArmed = false;

/** Computes (once) whether this is the first page load of the session. */
function ensureSession(): boolean {
  if (sessionFresh !== null) return sessionFresh;
  try {
    sessionFresh = !sessionStorage.getItem(SESSION_KEY);
    if (sessionFresh) {
      // Mark the session immediately: any later reload is a refresh, not a
      // fresh open. The value is only a timestamp, never used for logic.
      sessionStorage.setItem(SESSION_KEY, String(Date.now()));
    }
  } catch {
    // No sessionStorage (private mode / restricted webview): be conservative
    // and behave like a refresh, so we never scan on every reload.
    sessionFresh = false;
  }
  return sessionFresh;
}

/** Call once on mount to establish the session marker. */
export function isFreshRadarSession(): boolean {
  return ensureSession();
}

/** Call from the exact user action (button/switch) that turns auto ON. */
export function flagManualRadarStart(): void {
  manualStartPending = true;
  autoArmed = true;
}

/** True once auto-analysis was explicitly turned ON in this page session. */
export function isRadarArmed(): boolean {
  return autoArmed;
}

/** Used when the signed-in account changes/logs out within one page session. */
export function disarmRadar(): void {
  autoArmed = false;
  manualStartPending = false;
}

/**
 * True only when the scan may start right now because the client just turned
 * auto-analysis ON. Opening or refreshing the page never qualifies; in that
 * case the normal interval timer decides when the next scan is due.
 */
export function takeRadarStartNow(): boolean {
  if (manualStartPending) {
    manualStartPending = false;
    return true;
  }
  return false;
}
