import type { AutoAnalysisSettings } from '../types';

/**
 * Resumable auto-analysis (radar) progress.
 *
 * A page refresh used to abort the running scan: the next scan started again
 * from the FIRST symbol (and only after the re-analysis interval). The owner
 * asked for the scan to survive a refresh and continue from the symbol it was
 * analyzing. We persist the job list + position after every symbol and restore
 * it on load, so `runRadarScan` resumes exactly where it stopped.
 */

export interface RadarScanJob {
  cat: string;
  /** Stock exchange region (us/eu/jp) for split stock jobs. */
  region?: string;
}

export interface RadarScanProgress {
  version: 1;
  /** Signed-in account (email or uid) that owns the scan. */
  owner: string;
  /** Analysis settings fingerprint — a settings change restarts the scan. */
  settingsKey: string;
  running: boolean;
  startedAt: number;
  updatedAt: number;
  jobs: RadarScanJob[];
  /** Next job (category / stock exchange) to process. */
  jobIdx: number;
  /** Symbol to resume at inside the current job (null = first symbol). */
  resumeSymbol: string | null;
  failed: number;
  /** Symbols already analyzed in this scan (progress counter only). */
  analyzed: number;
}

const KEY = 'finalyze_radar_scan_progress_v1';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function normOwner(owner: string | null | undefined): string {
  return String(owner || '').toLowerCase().trim();
}

/** Settings fingerprint: changing any of these invalidates a saved scan. */
export function radarSettingsKey(
  s: Pick<AutoAnalysisSettings, 'category' | 'timeframe' | 'tradingStyle'>,
  paid: boolean,
): string {
  return [s?.category || 'all', s?.timeframe || '', s?.tradingStyle || '', paid ? 'paid' : 'free'].join('|');
}

export function saveRadarScanProgress(
  progress: Omit<RadarScanProgress, 'version' | 'updatedAt'>,
): void {
  try {
    const payload: RadarScanProgress = {
      ...progress,
      version: 1,
      updatedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch { /* storage full / private mode — scanning still works */ }
}

/** Reads a still-valid, in-progress scan for this account + settings. */
export function readRadarScanProgress(owner: string, settingsKey: string): RadarScanProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RadarScanProgress;
    if (!p || p.version !== 1 || p.running !== true) {
      localStorage.removeItem(KEY);
      return null;
    }
    const age = Date.now() - Number(p.updatedAt || 0);
    if (!isFinite(age) || age < 0 || age > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    if (!Array.isArray(p.jobs) || p.jobs.length === 0) return null;
    if (normOwner(p.owner) !== normOwner(owner)) return null;
    if (p.settingsKey !== settingsKey) return null;
    return p;
  } catch {
    return null;
  }
}

export function hasRadarScanProgress(owner: string, settingsKey: string): boolean {
  return !!readRadarScanProgress(owner, settingsKey);
}

export function clearRadarScanProgress(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
