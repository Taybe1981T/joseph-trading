import React, { useState } from 'react';
import { X, Play, Search } from 'lucide-react';

interface MobileManualSheetProps {
  lang: 'en' | 'ar';
  onClose: () => void;
  onAnalyze: (symbol: string) => void;
}

const POPULAR = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];

export function MobileManualSheet({ lang, onClose, onAnalyze }: MobileManualSheetProps) {
  const isAr = lang === 'ar';
  const [q, setQ] = useState('');
  const list = POPULAR.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="mt5-trade-title" style={{ margin: 0, textAlign: 'left' }}>
            {isAr ? 'تحليل يدوي' : 'Manual Analysis'}
          </div>
          <button className="mt5-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#888' }} />
            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder={isAr ? 'ابحث عن رمز...' : 'Search symbol...'}
              style={{ width: '100%', padding: '9px 10px 9px 32px', borderRadius: 10, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#e0e0e0', fontSize: 14, outline: 'none' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
          {list.map((s) => (
            <button key={s} onClick={() => onAnalyze(s)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#e0e0e0', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              <span>{s}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F59E0B', fontSize: 13 }}>
                <Play size={14} /> {isAr ? 'حلّل' : 'Analyze'}
              </span>
            </button>
          ))}
          {q && !list.includes(q) && (
            <button onClick={() => onAnalyze(q)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, border: '1px solid #F59E0B', background: 'rgba(245,158,11,0.1)', color: '#e0e0e0', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              <span>{q}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F59E0B', fontSize: 13 }}>
                <Play size={14} /> {isAr ? 'حلّل' : 'Analyze'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}