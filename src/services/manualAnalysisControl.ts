/**
 * ONE stop control for manual analysis on BOTH desktop and mobile.
 *
 * The desktop form and the phone sheet used to create private AbortControllers
 * that nothing else could reach, so neither Stop button worked. This tiny
 * registry gives every manual run a single controller that any Stop button can
 * cancel, while keeping radar/auto analysis untouched.
 */
let active: AbortController | null = null;

export function beginManualAnalysis(): AbortSignal {
  active?.abort();
  const ac = new AbortController();
  active = ac;
  return ac.signal;
}

export function stopManualAnalysis(): boolean {
  if (!active) return false;
  active.abort();
  active = null;
  return true;
}

export function endManualAnalysis(): void {
  active = null;
}

export function isManualAnalysisRunning(): boolean {
  return !!active && !active.signal.aborted;
}

export function isManualAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any).name === 'AbortError';
}
