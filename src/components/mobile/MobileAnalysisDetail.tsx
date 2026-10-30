import React, { useState, useEffect } from 'react';
import { User, Shield, Check, X, AlertTriangle, Clock, BarChart3 } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

interface Props {
  symbol: string;
  lang: Language;
  onClose: () => void;
}

export function MobileAnalysisDetail({ symbol, lang, onClose }: Props) {
  const isAr = lang === 'ar';
  const [signal, setSignal] = useState<AnalysisResult | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('top_signals_persistent');
      if (raw) {
        const all: any[] = JSON.parse(raw);
        const s = all.find((r: any) => r.symbol === symbol);
        if (s) setSignal(s as AnalysisResult);
      }
    } catch {}
  }, [symbol]);

  const reasons = signal?.detailedReasons || [];
  const reasonText = isAr
    ? signal?.summary || 'لا يوجد تحليل مفصل لهذا الرمز حالياً'
    : signal?.summary || 'No detailed analysis available for this symbol currently';

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{isAr ? 'تفاصيل التحليل' : 'Analysis Details'}</span>
        <button className="mt5-btn mt5-btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={onClose}>
          {isAr ? 'إغلاق' : 'Close'}
        </button>
      </div>

      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 900, fontStyle: 'italic' }}>{symbol}</span>
            {signal && signal.signal === 'strong_buy' && <span style={{ color: '#00ff88', fontWeight: 900 }}>{isAr ? 'شراء قوي' : 'STRONG BUY'}</span>}
            {signal && signal.signal === 'strong_sell' && <span style={{ color: '#ff4444', fontWeight: 900 }}>{isAr ? 'بيع قوي' : 'STRONG SELL'}</span>}
            {signal && signal.signal === 'buy' && <span style={{ color: '#66ffaa', fontWeight: 900 }}>{isAr ? 'شراء' : 'BUY'}</span>}
            {signal && signal.signal === 'sell' && <span style={{ color: '#ff5555', fontWeight: 900 }}>{isAr ? 'بيع' : 'SELL'}</span>}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{signal?.confidence || 0}%</div>
        </div>

        <div className="mt5-card-subtitle">{reasonText}</div>
      </div>
      {reasons.length > 0 && (
        <div className="mt5-signal-card" style={{ marginTop: 12 }}>
          <div className="mt5-card-title">{isAr ? 'الأسباب المفصلة' : 'Detailed Reasons'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            {reasons.map((r: any, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12 }}>
                  {r.status === 'positive' ? <Check size={12} style={{ color: '#00ff88' }} /> : r.status === 'negative' ? <X size={12} style={{ color: '#ff5555' }} /> : <AlertTriangle size={12} style={{ color: '#F59E0B' }} />}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e0e0e0' }}>{r.check}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{r.value}</div>
                </div>
                <span style={{ fontSize: 10, color: r.status === 'positive' ? '#00ff88' : r.status === 'negative' ? '#ff5555' : '#F59E0B', fontWeight: 700 }}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!reasons.length && (
        <div className="mt5-signal-card" style={{ marginTop: 12, textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 12, color: '#888' }}>{isAr ? 'لا توجد أسباب مفصلة لهذا الرمز' : 'No detailed reasons available for this symbol'}</div>
        </div>
      )}
      <div className="mt5-card" style={{ marginTop: 12 }}>
        <div className="mt5-card-header">
          <div className="mt5-card-title">{isAr ? 'معلومات الرمز' : 'Symbol Info'}</div>
        </div>
        <div style={{ display: 'flex', gap: 16, padding: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888' }}>{isAr ? 'سعر الدخول' : 'Entry Price'}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{signal?.entryPrice ? signal.entryPrice.toFixed(signal.entryPrice < 10 ? 4 : 2) : 'N/A'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="mt5-status-label">{isAr ? 'سعر جني الأرباح' : 'Take Profit'}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#00ff88' }}>{signal?.takeProfit ? signal.takeProfit.toFixed(signal.takeProfit < 10 ? 4 : 2) : 'N/A'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="mt5-status-label">{isAr ? 'سعر إيقاف الخسارة' : 'Stop Loss'}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#ff5555' }}>{signal?.stopLoss ? signal.stopLoss.toFixed(signal.stopLoss < 10 ? 4 : 2) : 'N/A'}</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <button className="mt5-btn mt5-btn-primary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={onClose}>
          {isAr ? 'إغلاق' : 'Close'}
        </button>
      </div>
    </div>
  );
}
