import React, { useState, useEffect } from 'react';
import { Zap, Hand, Play, Activity, Settings2, Loader2, Upload } from 'lucide-react';
import { MobileProgress, readMobileAuto, startMobileRadar, stopMobileRadar, isMobileRadarOn } from '../../services/mobileAnalysisEngine';

interface MobileAnalysisProps {
  lang: 'en' | 'ar';
  onManualAnalyze: () => void;
  onPublish?: () => void;
  compact?: boolean;
}

export function MobileAnalysis({ lang, onManualAnalyze, onPublish, compact = false }: MobileAnalysisProps) {
  const isAr = lang === 'ar';
  const [autoOn, setAutoOn] = useState(() => readMobileAuto().isEnabled);
  const [intervalMin, setIntervalMin] = useState(() => readMobileAuto().interval || 15);
  const [lastRun, setLastRun] = useState<string | null>(() => {
    const t = readMobileAuto().lastFinishedAt;
    return t ? new Date(t).toLocaleTimeString() : null;
  });
  const [prog, setProg] = useState<MobileProgress | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const r = readMobileAuto();
      setAutoOn(r.isEnabled);
      setIntervalMin(r.interval || 15);
      setLastRun(r.lastFinishedAt ? new Date(r.lastFinishedAt).toLocaleTimeString() : null);
    };
    sync();
    window.addEventListener('storage', sync);
    const iv = setInterval(sync, 5000);
    return () => { window.removeEventListener('storage', sync); clearInterval(iv); };
  }, []);

  const uidEmail = () => {
    try {
      const raw = localStorage.getItem('finalyze_user');
      const o = raw ? JSON.parse(raw) : {};
      return { uid: String(o.uid || 'anonymous'), email: String(o.email || '') };
    } catch { return { uid: 'anonymous', email: '' }; }
  };

  const toggleAuto = async () => {
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
      startMobileRadar(uid, email,
        (p) => setProg(p),
        (r) => {
          setProg(null);
          setLastRun(new Date().toLocaleTimeString());
          setDoneMsg(isAr ? `اكتمل: ${r.scanned} رمز، ${r.fresh} جديد` : `Done: ${r.scanned} scanned, ${r.fresh} fresh`);
          setTimeout(() => setDoneMsg(null), 15000);
        }
      );
    } else {
      stopMobileRadar();
      setProg(null);
    }
  };
  const setIv = (m: number) => {
    try {
      const raw = localStorage.getItem('auto_settings');
      const s = raw ? JSON.parse(raw) : {};
      localStorage.setItem('auto_settings', JSON.stringify({ ...s, interval: m }));
    } catch {}
    setIntervalMin(m);
  };
  const IVS = [5, 15, 30, 60];
  const pct = prog && prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;

  if (compact) {
    return (
      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={15} /> {isAr ? 'التحليل' : 'Analysis'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="mt5-btn mt5-btn-secondary" style={{ padding: '7px 12px', fontSize: 12 }} onClick={onManualAnalyze}>
              <Hand size={13} /> {isAr ? 'يدوي' : 'Manual'}
            </button>
            <button className={`mt5-btn ${autoOn ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '7px 12px', fontSize: 12 }} onClick={toggleAuto}>
              <Zap size={13} /> {autoOn ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mt5-card" style={autoOn ? { borderColor: 'rgba(0,255,136,0.4)' } : undefined}>
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Zap size={18} style={{ color: autoOn ? '#00ff88' : '#888' }} fill={autoOn ? 'currentColor' : 'none'} />
              {autoOn && <span style={{ position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />}
            </span>
            {isAr ? 'التحليل التلقائي' : 'Auto Analysis'}
          </div>
          <button className={`mt5-btn ${autoOn ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 18px', fontSize: 13, minWidth: 76 }} onClick={toggleAuto}>
            {autoOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="mt5-card-subtitle">
          {autoOn
            ? (isAr ? 'الرادار نشط — يفحص كل ' + intervalMin + ' دقيقة' : 'Radar active — every ' + intervalMin + ' min')
            : (isAr ? 'الرادار متوقف' : 'Radar off')}
          {lastRun && autoOn && <span style={{ display: 'block', marginTop: 4 }}>{isAr ? 'آخر فحص: ' : 'Last: '}{lastRun}</span>}
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
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              {prog.index}/{prog.total}{prog.failed > 0 ? ' · ' + prog.failed + (isAr ? ' فشل' : ' failed') : ''}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Settings2 size={14} style={{ color: '#888' }} />
          {IVS.map((m) => (
            <button key={m} onClick={() => setIv(m)}
              style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid ' + (intervalMin === m ? '#10B981' : '#2a2a2a'), background: intervalMin === m ? 'rgba(16,185,129,0.15)' : '#1a1a1a', color: intervalMin === m ? '#00ff88' : '#888' }}>
              {m}m
            </button>
          ))}
        </div>
      </div>
      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Hand size={18} style={{ color: '#F59E0B' }} />
            {isAr ? 'التحليل اليدوي' : 'Manual Analysis'}
          </div>
        </div>
        <div className="mt5-card-subtitle">
          {isAr ? 'حلّل أي رمز فوراً بمحرك الذكاء الاصطناعي' : 'Analyze any symbol instantly with AI'}
        </div>
        <button className="mt5-btn mt5-btn-block" style={{ background: '#F59E0B', color: '#000' }} onClick={onManualAnalyze}>
          <Play size={15} /> {isAr ? 'بدء تحليل يدوي' : 'Start Manual Analysis'}
        </button>
        {onPublish && (
          <button className="mt5-btn mt5-btn-block" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', marginTop: 8 }} onClick={onPublish}>
            <Upload size={15} /> {isAr ? 'نشر الإشارات للعملاء' : 'Publish Signals to Clients'}
          </button>
        )}
      </div>
    </div>
  );
}