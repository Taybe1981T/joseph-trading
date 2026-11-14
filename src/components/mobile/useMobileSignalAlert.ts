import { useEffect, useRef } from 'react';
import { playChampagnePop } from '../../lib/tradeSounds';
import { initAudio } from '../../lib/audioEngine';
import { mobileSignalsStorageKey } from '../../services/mobileAnalysisEngine';

export function useMobileSignalAlert(onFresh: (count: number) => void, enabled = true) {
  const prevRef = useRef<Set<string>>(new Set());
  const firstRef = useRef(true);
  useEffect(() => {
    // PAID-ONLY: a free-plan client (or a paid client in free mode) must get no
    // new-signal alerts at all. Reset the baseline so reactivating the paid plan
    // does not fire a burst for signals that appeared while disabled.
    if (!enabled) {
      firstRef.current = true;
      prevRef.current = new Set();
      return;
    }
    const snapshot = () => {
      try {
        const raw = localStorage.getItem(mobileSignalsStorageKey());
        const arr = raw ? JSON.parse(raw) : [];
        const keys = new Set<string>((Array.isArray(arr) ? arr : []).map((s: any) => `${s.symbol}_${s.timeframe || '1d'}_${s.signal}`));
        if (firstRef.current) {
          firstRef.current = false;
          prevRef.current = keys;
          return;
        }
        let fresh = 0;
        keys.forEach((k) => { if (!prevRef.current.has(k)) fresh++; });
        prevRef.current = keys;
        if (fresh > 0) {
          try { initAudio(); } catch {}
          try {
            const rawA = localStorage.getItem('auto_settings');
            const vol = rawA ? (JSON.parse(rawA)?.volume ?? 0.7) : 0.7;
            playChampagnePop(Math.max(0.05, Math.min(1, vol)));
          } catch { playChampagnePop(0.7); }
          onFresh(fresh);
        }
      } catch {}
    };
    snapshot();
    const iv = setInterval(snapshot, 5000);
    window.addEventListener('storage', snapshot);
    return () => { clearInterval(iv); window.removeEventListener('storage', snapshot); };
  }, [onFresh, enabled]);
}