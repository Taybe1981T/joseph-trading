import React, { useState, useEffect } from 'react';
import { Zap, Loader2, Settings } from 'lucide-react';
import { MobileProgress, readMobileAuto, startMobileRadar, stopMobileRadar, getMobileRadarProgress, isMobileRadarOn } from '../../services/mobileAnalysisEngine';
import { takeRadarStartNow, isRadarArmed, flagManualRadarStart } from '../../services/radarSession';
import { MobileRadarSettings } from './MobileRadarSettings';
import { Language } from '../../lib/i18n';
import { mobileT, detectMobileMode } from '../../lib/mobileMode';

interface Props {
  lang: Language;
}

export function MobileAnalysis({ lang }: Props) {
  const isAr = lang === 'ar';
  const [autoOn, setAutoOn] = useState(() => readMobileAuto().isEnabled);
  const [lastRun, setLastRun] = useState<string | null>(() => {
    const t = readMobileAuto().lastFinishedAt;
    return t ? new Date(t).toLocaleTimeString() : null;
  });
  const [prog, setProg] = useState<MobileProgress | null>(() => getMobileRadarProgress());
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const sync = () => {
      const r = readMobileAuto();
      setAutoOn(r.isEnabled);
      setLastRun(r.lastFinishedAt ? new Date(r.lastFinishedAt).toLocaleTimeString() : null);
    };
    sync();
    const onSettings = () => sync();
    window.addEventListener('storage', sync);
    window.addEventListener('mobile-radar-settings', onSettings);
    const iv = setInterval(sync, 5000);
    // Reconnect progress callback if radar is already running
    if (readMobileAuto().isEnabled && !isMobileRadarOn()) {
      const isDev = detectMobileMode().mode === 'developer';
      if (!isDev && !isRadarArmed()) {
        // Opening/refreshing must not resume a client's auto-analysis: only a
        // manual ON in THIS session arms it (flagManualRadarStart).
        try {
          localStorage.setItem('auto_settings', JSON.stringify({ ...readMobileAuto(), isEnabled: false }));
        } catch {}
        setAutoOn(false);
      } else {
        const { uid, email } = uidEmail();
        startMobileRadar(uid, email, (p) => setProg(p), (r) => {
          setProg(null);
          setLastRun(new Date().toLocaleTimeString());
          setDoneMsg(mobileT(lang, `Done: ${r.scanned} scanned, ${r.fresh} fresh`, `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد`));
          setTimeout(() => setDoneMsg(null), 15000);
        }, { immediate: takeRadarStartNow() });
      }
    }
    return () => {
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
    const v = !autoOn;
    try {
      const raw = localStorage.getItem('auto_settings');
      const s = raw ? JSON.parse(raw) : {};
      localStorage.setItem('auto_settings', JSON.stringify({ ...s, isEnabled: v }));
    } catch {}
    setAutoOn(v);
    // Manual ON: arm this session and start right away (desktop parity).
    // OFF: stop the engine.
    if (v) {
      flagManualRadarStart();
      const { uid, email } = uidEmail();
      startMobileRadar(uid, email, (p) => setProg(p), (r) => {
        setProg(null);
        setLastRun(new Date().toLocaleTimeString());
        setDoneMsg(mobileT(lang, `Done: ${r.scanned} scanned, ${r.fresh} fresh`, `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد`));
        setTimeout(() => setDoneMsg(null), 15000);
      }, { immediate: true });
    } else {
      stopMobileRadar();
      setProg(null);
    }
    window.dispatchEvent(new CustomEvent('mobile-radar-settings'));
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
              onClick={() => setShowSettings(!showSettings)}
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
