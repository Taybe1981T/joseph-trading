import React, { useState, useEffect } from 'react';
import { Zap, Loader2, Settings } from 'lucide-react';
import { MobileProgress, readMobileAuto, startMobileRadar, stopMobileRadar, getMobileRadarProgress } from '../../services/mobileAnalysisEngine';
import { MobileRadarSettings } from './MobileRadarSettings';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

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
    if (readMobileAuto().isEnabled) {
      const { uid, email } = uidEmail();
      startMobileRadar(uid, email, (p) => setProg(p), (r) => {
        setProg(null);
        setLastRun(new Date().toLocaleTimeString());
        setDoneMsg(mobileT(lang, `Done: ${r.scanned} scanned, ${r.fresh} fresh`, `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد`));
        setTimeout(() => setDoneMsg(null), 15000);
      });
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
    if (v) {
      setDoneMsg(null);
      const { uid, email } = uidEmail();
      startMobileRadar(uid, email, (p) => setProg(p), (r) => {
        setProg(null);
        setLastRun(new Date().toLocaleTimeString());
        setDoneMsg(mobileT(lang, `Done: ${r.scanned} scanned, ${r.fresh} fresh`, `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد`));
        setTimeout(() => setDoneMsg(null), 15000);
      });
    } else {
      stopMobileRadar();
      setProg(null);
    }
  };

  const pct = prog && prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mt5-card" style={autoOn ? { borderColor: 'rgba(0,255,136,0.4)' } : undefined}>
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Zap size={18} style={{ color: autoOn ? '#00ff88' : '#888' }} fill={autoOn ? 'currentColor' : 'none'} />
              {autoOn && <span style={{ position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />}
            </span>
            {mobileT(lang, 'Auto Analysis', 'التحليل التلقائي')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="mt5-btn mt5-btn-secondary" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setShowSettings(!showSettings)}>
              <Settings size={14} />
            </button>
            <button className={`mt5-btn ${autoOn ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 16px', fontSize: 13 }} onClick={toggleAuto}>
              {autoOn ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
        <div className="mt5-card-subtitle">
          {autoOn ? mobileT(lang, 'Radar active', 'الرادار نشط') : mobileT(lang, 'Radar off', 'الرادار متوقف')}
          {lastRun && autoOn && <span style={{ display: 'block', marginTop: 4 }}>{mobileT(lang, 'Last: ', 'آخر فحص: ')}{lastRun}</span>}
          {doneMsg && <span style={{ display: 'block', marginTop: 4, color: '#00ff88' }}>{doneMsg}</span>}
        </div>
        {prog && (
          <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#00ff88' }} />
              <span style={{ flex: 1 }}>{prog.current}{prog.exchange ? ' · ' + prog.exchange : ''}</span>
              <span style={{ color: '#00ff88' }}>{pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#2a2a2a', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pct + '%', background: '#00ff88', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{prog.index}/{prog.total}{prog.failed > 0 ? ' · ' + prog.failed + (isAr ? ' فشل' : ' failed') : ''}</div>
          </div>
        )}
      </div>

      {showSettings && <MobileRadarSettings lang={lang} />}
    </div>
  );
}
