import React, { useState, useEffect } from 'react';
import { Zap, Loader2, Settings } from 'lucide-react';
import { MobileProgress, readMobileAuto, startMobileRadar, stopMobileRadar, getMobileRadarProgress, isMobileRadarOn, subscribeMobileRadar, isMobileRadarPersisted, readMobileRadarResume } from '../../services/mobileAnalysisEngine';
import { MobileRadarSettings } from './MobileRadarSettings';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

interface Props {
  lang: Language;
  /** Lifted to MobileLayout: the header's single back icon closes this panel. */
  settingsOpen: boolean;
  onSettingsOpenChange: (v: boolean) => void;
}

/** Auto-analysis timestamps are ALWAYS shown in GMT (same rule as the rest of
 * the app) — never the device's local time. */
function fmtGmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
}

export function MobileAnalysis({ lang, settingsOpen, onSettingsOpenChange }: Props) {
  const isAr = lang === 'ar';
  const [autoOn, setAutoOn] = useState(() => isMobileRadarOn() || isMobileRadarPersisted());
  const [lastRun, setLastRun] = useState<string | null>(() => {
    const t = readMobileAuto().lastFinishedAt;
    return t ? fmtGmtTime(t) : null;
  });
  const [prog, setProg] = useState<MobileProgress | null>(() => {
    const p = getMobileRadarProgress();
    if (p) return p;
    if (isMobileRadarPersisted()) {
      const r = readMobileRadarResume();
      if (r) return { current: r.symbol, total: r.total, index: r.index, failed: 0, category: r.category };
    }
    return null;
  });
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const showSettings = settingsOpen;

  useEffect(() => {
    const sync = () => {
      const r = readMobileAuto();
      setLastRun(r.lastFinishedAt ? fmtGmtTime(r.lastFinishedAt) : null);
    };
    sync();
    // The engine (shared with the header button) is the ONE source of truth for
    // ON/OFF and progress. No independent storage polling: that is what made
    // the button flip between ON/START and the bar appear only after leaving
    // and re-entering this tab.
    const unsubscribe = subscribeMobileRadar(({ running, progress }) => {
      setAutoOn((prev) => (prev === running ? prev : running));
      setProg(progress);
    });
    const onSettings = () => sync();
    window.addEventListener('storage', sync);
    window.addEventListener('mobile-radar-settings', onSettings);
    const iv = setInterval(sync, 5000);
    // Refresh during an active scan resumes it; a fresh open never starts.
    if (isMobileRadarPersisted() && !isMobileRadarOn()) {
      const { uid, email } = uidEmail();
      void startMobileRadar(uid, email, undefined, undefined, { resume: true });
    }
    return () => {
      unsubscribe();
      window.removeEventListener('storage', sync);
      window.removeEventListener('mobile-radar-settings', onSettings);
      clearInterval(iv);
    };
  }, []);

  const uidEmail = () => {
    try {
      const raw = localStorage.getItem('finalyze_user');
      const o = raw ? JSON.parse(raw) : {};
      return { uid: String(o.uid || 'anonymous'), email: String(o.email || '') };
    } catch { return { uid: 'anonymous', email: '' }; }
  };

  const toggleAuto = () => {
    // Same engine as the header button: instant flip, no storage polling.
    if (isMobileRadarOn()) {
      stopMobileRadar();
      setDoneMsg(null);
      return;
    }
    const { uid, email } = uidEmail();
    setProg({ current: '…', total: 0, index: 0, failed: 0 });
    setAutoOn(true);
    void startMobileRadar(uid, email, undefined, (r) => {
      setLastRun(fmtGmtTime(Date.now()));
      setDoneMsg(mobileT(lang, `Done: ${r.scanned} scanned, ${r.fresh} fresh`, `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد`));
      setTimeout(() => setDoneMsg(null), 15000);
    }, { immediate: true });
  };

  const pct = prog && prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        className="mt5-card"
        style={{
          background: '#FACC15',
          borderColor: '#EAB308',
          boxShadow: '0 3px 12px rgba(250,204,21,0.35)',
        }}
      >
        <div className="mt5-card-header" style={{ borderBottomColor: 'rgba(17,24,39,0.20)' }}>
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#111827' }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Zap size={20} style={{ color: '#111827' }} fill={autoOn ? '#111827' : 'none'} />
              {autoOn && <span style={{ position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: '50%', background: '#065F46', border: '1.5px solid #FDE047' }} />}
            </span>
            {mobileT(lang, 'Auto Analysis', 'التحليل التلقائي')}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Settings gear: larger, SOLID grey. */}
            <button
              type="button"
              aria-label={isAr ? 'إعدادات التحليل' : 'Analysis settings'}
              onClick={() => onSettingsOpenChange(!showSettings)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                border: '1px solid #4B5563',
                background: '#6B7280',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.22)',
                flexShrink: 0,
              }}
            >
              <Settings size={21} />
            </button>
            <button
              type="button"
              onClick={toggleAuto}
              style={{
                height: 42,
                padding: '0 16px',
                minWidth: 66,
                borderRadius: 12,
                border: `1px solid ${autoOn ? '#065F46' : '#111827'}`,
                background: autoOn ? '#065F46' : '#111827',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {autoOn ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        <div className="mt5-card-subtitle" style={{ color: '#78350F', fontWeight: 800 }}>
          {autoOn ? mobileT(lang, 'Radar active', 'الرادار نشط') : mobileT(lang, 'Radar off', 'الرادار متوقف')}
          {lastRun && autoOn && <span style={{ display: 'block', marginTop: 4, color: '#78350F' }}>{mobileT(lang, 'Last: ', 'آخر فحص: ')}{lastRun}</span>}
        </div>
      </div>

      {showSettings && <MobileRadarSettings lang={lang} />}
    </div>
  );
}
