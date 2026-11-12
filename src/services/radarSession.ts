/**
 * Auto-analysis start gate — shared by the desktop site and the mobile app.
 *
 * Rule requested by the owner: a client with an active plan must NOT start a
 * scan merely because the page was refreshed. Auto-analysis may start ONLY:
 *
 *   1. when the client turns it ON manually,
 *   2. when the periodic re-analysis interval is due, or
 *   3. when the site/app is opened fresh after it had been closed.
 *
 * A browser refresh keeps `sessionStorage`, while closing the tab / the phone
 * app clears it. That is exactly how "refresh" and "reopened after close" are
 * told apart here. The decision is cached for the page session, so the desktop
 * App and the mobile layout can never disagree (and React StrictMode's double
 * effect run cannot consume it twice).
 */

const SESSION_KEY = 'finalyze_radar_session_v1';

let sessionFresh: boolean | null = null;
let freshStartUsed = false;
let manualStartPending = false;

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
}

/**
 * True when the scan may start right now for a non-interval reason:
 * a manual ON, or the first open of a session. Consumed once per page session.
 */
export function takeRadarStartNow(): boolean {
  if (manualStartPending) {
    manualStartPending = false;
    return true;
  }
  if (ensureSession() && !freshStartUsed) {
    freshStartUsed = true;
    return true;
  }
  return false;
}
