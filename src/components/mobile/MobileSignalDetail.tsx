import React from 'react';
import { X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { sigColor, sigLabel, fmtDate } from './MobileSignalCard';

interface Props {
  res: AnalysisResult;
  lang: Language;
  onClose: () => void;
}

export function MobileSignalDetail({ res, lang, onClose }: Props) {
  const isAr = lang === 'ar';
  const color = sigColor(String(res.signal));
  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color }}>{res.symbol}</div>
          <button className="mt5-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color }}>{sigLabel(String(res.signal), lang)}</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{res.confidence}%</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>{fmtDate(res.timestamp, lang)}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13, fontWeight: 700, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' }}>
          {res.entryPrice ? <span style={{ color: '#aaa' }}>Entry <b style={{ color: '#fff' }}>{res.entryPrice}</b></span> : null}
          {res.stopLoss ? <span style={{ color: '#ff5555' }}>SL <b>{res.stopLoss}</b></span> : null}
          {res.takeProfit ? <span style={{ color: '#00ff88' }}>TP <b>{res.takeProfit}</b></span> : null}
        </div>
        {res.summary && (
          <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.6, marginBottom: 12 }}>{res.summary}</div>
        )}
        {(res.detailedReasons || []).map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 12, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 10px' }}>
            {String(d.status || '').toLowerCase().includes('fail') || String(d.status || '').toLowerCase().includes('bad')
              ? <AlertTriangle size={14} style={{ color: '#ff5555', flexShrink: 0, marginTop: 1 }} />
              : <CheckCircle2 size={14} style={{ color: '#00ff88', flexShrink: 0, marginTop: 1 }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: '#fff' }}>{d.check}</div>
              <div style={{ color: '#aaa', marginTop: 2 }}>{d.value}</div>
              {d.impact && <div style={{ color: '#888', marginTop: 2, fontSize: 11 }}>{d.impact}</div>}
            </div>
          </div>
        ))}
        {(res.newsSources || []).length > 0 && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
            {(isAr ? 'المصادر: ' : 'Sources: ') + (res.newsSources || []).slice(0, 3).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}