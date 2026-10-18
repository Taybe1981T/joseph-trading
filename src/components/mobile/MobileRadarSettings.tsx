import React, { useState, useMemo } from 'react';
import { Zap, Layers, Sparkles, Clock, Music, Volume2, Check } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { playStart, playSuccess, playFail, playCompletion, playCategoryChange } from '../../lib/audioEngine';

interface AutoSettings {
  isEnabled: boolean; interval: number; timeframe: string; category: string;
  tradingStyle: string; volume: number; showAllSignals?: boolean;
}
function readAuto(): AutoSettings {
  try {
    const raw = localStorage.getItem('auto_settings');
    if (raw) return { volume: 0.8, timeframe: '1d', category: 'all', tradingStyle: 'day_trading', interval: 15, isEnabled: false, successSound: '1', failSound: '3', completionSound: '2', ...JSON.parse(raw) };
  } catch {}
  return { isEnabled: false, interval: 15, timeframe: '1d', category: 'all', tradingStyle: 'day_trading', volume: 0.8, successSound: '1', failSound: '3', completionSound: '2' };
}
function writeAuto(s: AutoSettings) { try { localStorage.setItem('auto_settings', JSON.stringify(s)); } catch {} }

const CATS = [
  { id: 'forex', en: 'Forex', ar: 'فوركس' },
  { id: 'crypto', en: 'Crypto', ar: 'كريبتو' },
  { id: 'stocks', en: 'Stocks', ar: 'الأسهم' },
  { id: 'metals', en: 'Metals', ar: 'المعادن' },
];
const INTERVALS = [1, 5, 15, 60, 120, 240, 1440];
const INTERVAL_LABEL: Record<number, string> = { 1: '1 Min', 5: '5 Min', 15: '15 Min', 60: '1 Hr', 120: '2 Hr', 240: '4 Hr', 1440: '1 Day' };
const TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w', '1M', '1Y'];
const STYLES = [
  { id: 'scalping', en: 'Scalping', ar: 'سكالبينج' },
  { id: 'day_trading', en: 'Day Trading', ar: 'تداول يومي' },
  { id: 'swing_trading', en: 'Swing', ar: 'سوينج' },
];

export function MobileRadarSettings({ lang }: { lang: Language }) {
  const isAr = lang === 'ar';
  const [s, setS] = useState<AutoSettings>(readAuto);
  const commit = (patch: Partial<AutoSettings>) => {
    const next = { ...s, ...patch }; setS(next); writeAuto(next);
    try { window.dispatchEvent(new CustomEvent('mobile-radar-settings')); } catch {}
  };
  const selectedList = useMemo(() => s.category === 'all' ? ['forex', 'crypto', 'stocks', 'metals'] : s.category.split(',').filter(Boolean), [s.category]);
  const toggleCat = (id: string) => {
    let list = [...selectedList];
    if (list.includes(id)) { if (list.length > 1) list = list.filter((x) => x !== id); }
    else list.push(id);
    commit({ category: list.length === 4 ? 'all' : list.join(',') } as any);
  };
  const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="mt5-card">
      <div className="mt5-card-header">
        <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {label}</div>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="mt5-card" style={s.isEnabled ? { borderColor: 'rgba(0,255,136,0.4)' } : undefined}>
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={18} style={{ color: s.isEnabled ? '#00ff88' : '#888' }} fill={s.isEnabled ? 'currentColor' : 'none'} />
            {mobileT(lang, 'Radar System', 'نظام الرادار')}
          </div>
          <button className={`mt5-btn ${s.isEnabled ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 18px', fontSize: 13, minWidth: 72 }} onClick={() => commit({ isEnabled: !s.isEnabled })}>{s.isEnabled ? 'ON' : 'OFF'}</button>
        </div>
        <div className="mt5-card-subtitle">{s.isEnabled ? mobileT(lang, 'Radar Active', 'الرادار نشط') : mobileT(lang, 'Radar Off', 'الرادار متوقف')}</div>
      </div>

      <Row icon={<Music size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Sound Alerts', 'التنبيهات الصوتية')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mt5-btn mt5-btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={() => playSuccess(s.volume || 0.5)}><Volume2 size={14} /> {mobileT(lang, 'Success', 'نجاح')}</button>
          <button className="mt5-btn mt5-btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={() => playFail(s.volume || 0.5)}><Volume2 size={14} /> {mobileT(lang, 'Fail', 'فشل')}</button>
          <button className="mt5-btn mt5-btn-secondary" style={{ flex: 1, fontSize: 12 }} onClick={() => playCompletion(s.volume || 0.5)}><Volume2 size={14} /> {mobileT(lang, 'Done', 'اكتمل')}</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <Volume2 size={15} style={{ color: '#F59E0B' }} />
          <input type="range" min="0" max="1" step="0.1" value={s.volume} onChange={(e) => commit({ volume: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: '#F59E0B' }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B', minWidth: 42, textAlign: 'right' }}>{Math.round((s.volume || 0.5) * 100)}%</span>
        </div>
      </Row>

      
      <Row icon={<Music size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Sound', 'الصوت')}>
        <select value={s.volume} onChange={(e) => commit({ volume: parseFloat(e.target.value) })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
          <option value={0.1}>{mobileT(lang, 'Muted (0.1)', 'كتم (0.1)')}</option>
          <option value={0.3}>{mobileT(lang, 'Quiet (0.3)', 'هادئ (0.3)')}</option>
          <option value={0.5}>{mobileT(lang, 'Normal (0.5)', 'عادي (0.5)')}</option>
          <option value={0.7}>{mobileT(lang, 'Loud (0.7)', 'عالي (0.7)')}</option>
          <option value={1.0}>{mobileT(lang, 'Full (1.0)', 'اقصى (1.0)')}</option>
        </select>
      </Row>

      <Row icon={<Volume2 size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Alerts', 'التنبيهات')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div data-x="AlertsRowX" style={{ display: 'none' }} />
          {[
            { id: '1', en: 'Alert 1', ar: 'تنبيه 1' },
            { id: '2', en: 'Alert 2', ar: 'تنبيه 2' },
            { id: '3', en: 'Alert 3', ar: 'تنبيه 3' },
          ].map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '9px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{isAr ? a.ar : a.en}</span>
              <button onClick={() => { if (a.id === '1') playSuccess(s.volume || 0.5); else if (a.id === '2') playCompletion(s.volume || 0.5); else playFail(s.volume || 0.5); }} style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                {mobileT(lang, 'Preview', 'تجربة')}
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '9px 12px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{isAr ? 'تنبيه البداية' : 'Start Alert'}</span>
            <button onClick={() => playStart(s.volume || 0.5)} style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              {mobileT(lang, 'Preview', 'تجربة')}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '9px 12px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0' }}>{isAr ? 'تنبيه الفئة' : 'Category Alert'}</span>
            <button onClick={() => playCategoryChange(s.volume || 0.6)} style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#F59E0B', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              {mobileT(lang, 'Preview', 'تجربة')}
            </button>
          </div>
        </div>
      </Row>
<Row icon={<Layers size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Market', 'السوق')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {CATS.map((c) => {
            const on = selectedList.includes(c.id);
            return (
              <button key={c.id} onClick={(e) => { e.stopPropagation(); toggleCat(c.id); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, border: '1px solid ' + (on ? '#10B981' : '#2a2a2a'), background: on ? 'rgba(16,185,129,0.12)' : '#0a0a0a', color: on ? '#00ff88' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer', minHeight: 52 }}>
                <span>{isAr ? c.ar : c.en}</span>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid ' + (on ? '#10B981' : '#444'), background: on ? '#10B981' : 'transparent', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </Row>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Row icon={<Zap size={15} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Scan Every', 'امسح كل')}>
          <select value={s.interval} onChange={(e) => commit({ interval: parseInt(e.target.value) })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
            {INTERVALS.map((v) => <option key={v} value={v}>{INTERVAL_LABEL[v]}</option>)}
          </select>
        </Row>
        <Row icon={<Sparkles size={15} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Strategy', 'الأسلوب')}>
          <select value={s.tradingStyle} onChange={(e) => commit({ tradingStyle: e.target.value })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
            {STYLES.map((st) => <option key={st.id} value={st.id}>{isAr ? st.ar : st.en}</option>)}
          </select>
        </Row>
      </div>

      <Row icon={<Clock size={16} />} label={mobileT(lang, 'Timeframe', 'الإطار الزمني')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {TIMEFRAMES.map((tf) => {
            const on = s.timeframe === tf;
            return (
              <button key={tf} onClick={() => commit({ timeframe: tf })}
                style={{ padding: '11px 0', borderRadius: 10, border: '1px solid ' + (on ? '#10B981' : '#2a2a2a'), background: on ? 'rgba(16,185,129,0.14)' : '#0a0a0a', color: on ? '#00ff88' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {tf}
              </button>
            );
          })}
        </div>
      </Row>

      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={16} style={{ color: '#F59E0B' }} /> {mobileT(lang, 'Show all signals', 'عرض كل الإشارات')}
          </div>
          <button className={`mt5-btn ${s.showAllSignals ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '7px 14px', fontSize: 12 }} onClick={() => commit({ showAllSignals: !s.showAllSignals })}>{s.showAllSignals ? 'ON' : 'OFF'}</button>
        </div>
        <div className="mt5-card-subtitle">{mobileT(lang, 'Include neutral / sideways results', 'تضمين النتائج المحايدة والعرضية')}</div>
      </div>
    </div>
  );
}
