import React, { useState, useMemo } from 'react';
import { Zap, Layers, Sparkles, Clock, Music } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { getMobileSymbolGroups } from '../../services/mobileAnalysisEngine';

interface AutoSettings {
  isEnabled: boolean; interval: number; timeframe: string; category: string;
  tradingStyle: string; volume: number; showAllSignals?: boolean;
}
function readAuto(): AutoSettings {
  try {
    const raw = localStorage.getItem('auto_settings');
    // Desktop parity: showAllSignals is always ON (neutral/sideways results always included)
    if (raw) return { volume: 0.8, timeframe: '1d', category: 'all', tradingStyle: 'day_trading', interval: 15, isEnabled: false, successSound: '1', failSound: '3', completionSound: '2', ...JSON.parse(raw), showAllSignals: true };
  } catch {}
  return { isEnabled: false, interval: 15, timeframe: '1d', category: 'all', tradingStyle: 'day_trading', volume: 0.8, successSound: '1', failSound: '3', completionSound: '2', showAllSignals: true };
}
function writeAuto(s: AutoSettings) { try { localStorage.setItem('auto_settings', JSON.stringify(s)); } catch {} }

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
  const [groups, setGroups] = useState(getMobileSymbolGroups);
  const commit = (patch: Partial<AutoSettings>) => {
    const next = { ...s, ...patch }; setS(next); writeAuto(next);
    try { window.dispatchEvent(new CustomEvent('mobile-radar-settings')); } catch {}
  };
  const selectedList = useMemo(() => s.category === 'all' ? groups.map((g) => g.id) : s.category.split(',').filter(Boolean), [s.category, groups]);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowAnchor: 'none' }}>
      <div className="mt5-card" style={s.isEnabled ? { borderColor: 'rgba(0,255,136,0.4)' } : undefined}>
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={18} style={{ color: s.isEnabled ? '#00ff88' : '#888' }} fill={s.isEnabled ? 'currentColor' : 'none'} />
            {mobileT(lang, 'Radar System', 'نظام الرادار')}
          </div>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className={`mt5-btn ${s.isEnabled ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 18px', fontSize: 13, minWidth: 72 }} onClick={() => commit({ isEnabled: !s.isEnabled })}>{s.isEnabled ? 'ON' : 'OFF'}</button>
        </div>
        <div className="mt5-card-subtitle">{s.isEnabled ? mobileT(lang, 'Radar Active', 'الرادار نشط') : mobileT(lang, 'Radar Off', 'الرادار متوقف')}</div>
      </div>


      
      <Row icon={<Music size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Sound', 'الصوت')}>
        <select value={s.volume} onChange={(e) => commit({ volume: parseFloat(e.target.value) })} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
          <option value={0.1}>{mobileT(lang, 'Muted (0.1)', 'كتم (0.1)')}</option>
          <option value={0.3}>{mobileT(lang, 'Quiet (0.3)', 'هادئ (0.3)')}</option>
          <option value={0.5}>{mobileT(lang, 'Normal (0.5)', 'عادي (0.5)')}</option>
          <option value={0.7}>{mobileT(lang, 'Loud (0.7)', 'عالي (0.7)')}</option>
          <option value={1.0}>{mobileT(lang, 'Full (1.0)', 'اقصى (1.0)')}</option>
        </select>
      </Row>

<Row icon={<Layers size={16} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Market', 'السوق')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {groups.map((c) => {
            const on = selectedList.includes(c.id);
            return (
              <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); toggleCat(c.id); }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, border: '1px solid ' + (on ? '#10B981' : '#2a2a2a'), background: on ? 'rgba(16,185,129,0.12)' : '#0a0a0a', color: on ? '#00ff88' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer', minHeight: 52 }}>
                <span>{isAr ? c.label : c.label}</span>
                <span style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid ' + (on ? '#10B981' : '#444'), background: on ? '#10B981' : 'transparent', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </Row>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Row icon={<Zap size={15} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Scan Every', 'امسح كل')}>
          <select value={s.interval} onChange={(e) => { e.stopPropagation(); commit({ interval: parseInt(e.target.value) }); }} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
            {INTERVALS.map((v) => <option key={v} value={v}>{INTERVAL_LABEL[v]}</option>)}
          </select>
        </Row>
        <Row icon={<Sparkles size={15} style={{ color: '#F59E0B' }} />} label={mobileT(lang, 'Strategy', 'الأسلوب')}>
          <select value={s.tradingStyle} onChange={(e) => { e.stopPropagation(); commit({ tradingStyle: e.target.value }); }} style={{ width: '100%', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}>
            {STYLES.map((st) => <option key={st.id} value={st.id}>{isAr ? st.ar : st.en}</option>)}
          </select>
        </Row>
      </div>

      <Row icon={<Clock size={16} />} label={mobileT(lang, 'Timeframe', 'الإطار الزمني')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {TIMEFRAMES.map((tf) => {
            const on = s.timeframe === tf;
            return (
              <button key={tf} type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); commit({ timeframe: tf }); }}
                style={{ padding: '11px 0', borderRadius: 10, border: '1px solid ' + (on ? '#10B981' : '#2a2a2a'), background: on ? 'rgba(16,185,129,0.14)' : '#0a0a0a', color: on ? '#00ff88' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {tf}
              </button>
            );
          })}
        </div>
      </Row>

    </div>
  );
}
