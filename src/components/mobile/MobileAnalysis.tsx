import React, { useState, useEffect } from 'react';
import { Zap, Hand, Play, Square, Activity, Settings2 } from 'lucide-react';

interface MobileAnalysisProps {
  lang: 'en' | 'ar';
  onManualAnalyze: () => void;
  compact?: boolean;
}

function readAuto(): { on: boolean; iv: number; last: string | null } {
  try {
    const raw = localStorage.getItem('auto_settings');
    if (raw) {
      const s = JSON.parse(raw);
      return {
        on: !!s.isEnabled,
        iv: typeof s.interval === 'number' ? s.interval : 15,
        last: s.lastFinishedAt ? new Date(s.lastFinishedAt).toLocaleTimeString() : null,
      };
    }
  } catch {}
  return { on: false, iv: 15, last: null };
}

function writeAuto(patch: any) {
  try {
    const raw = localStorage.getItem('auto_settings');
    const s = raw ? JSON.parse(raw) : {};
    localStorage.setItem('auto_settings', JSON.stringify({ ...s, ...patch }));
  } catch {}
}

export function MobileAnalysis({ lang, onManualAnalyze, compact = false }: MobileAnalysisProps) {
  const isAr = lang === 'ar';
  const [autoOn, setAutoOn] = useState(false);
  const [intervalMin, setIntervalMin] = useState(15);
  const [lastRun, setLastRun] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => { const r = readAuto(); setAutoOn(r.on); setIntervalMin(r.iv); setLastRun(r.last); };
    sync();
    window.addEventListener('storage', sync);
    const iv = setInterval(sync, 5000);
    return () => { window.removeEventListener('storage', sync); clearInterval(iv); };
  }, []);

  const toggleAuto = () => {
    const v = !autoOn;
    writeAuto({ isEnabled: v });
    setAutoOn(v);
    try { window.dispatchEvent(new CustomEvent('mobile-auto-analysis', { detail: { enabled: v } })); } catch {}
  };
  const setIv = (m: number) => { writeAuto({ interval: m }); setIntervalMin(m); };
  const IVS = [5, 15, 30, 60];

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
        </div>
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
      </div>
    </div>
  );
}