import React from 'react';
import { Zap } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { useMobileMode, mobileT } from '../../lib/mobileMode';
import { MobileSignalCard } from './MobileSignalCard';

interface MobileHomeProps {
  fullSignals: AnalysisResult[];
  balance: number;
  equity: number;
  openCount: number;
  autoTradeEnabled: boolean;
  lang: Language;
  onDetail: (r: AnalysisResult) => void;
  onTrade: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onAutoTradeToggle: (enabled: boolean) => void;
  radarOn: boolean;
  radarLabel: string | null;
}

export function MobileHome({
  fullSignals, balance, equity, openCount, autoTradeEnabled, lang,
  onDetail, onTrade, onRemove, onAutoTradeToggle, radarOn, radarLabel,
}: MobileHomeProps) {
  const { isDev, isClient, hasPlan } = useMobileMode();
  const pnl = equity - balance;
  const isAr = lang === 'ar';
  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">{mobileT(lang, 'Account Overview', 'نظرة الحساب')}</div>

      <div className="mt5-status-bar">
        <div className="mt5-status-item">
          <div className="mt5-status-label">{mobileT(lang, 'Balance', 'الرصيد')}</div>
          <div className="mt5-status-value">{balance.toFixed(2)}</div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">Equity</div>
          <div className="mt5-status-value">{equity.toFixed(2)}</div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">P/L</div>
          <div className={`mt5-status-value ${pnl >= 0 ? 'positive' : 'negative'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">{mobileT(lang, 'Open', 'مفتوح')}</div>
          <div className="mt5-status-value">{openCount}</div>
        </div>
      </div>

      {radarOn && radarLabel && (
        <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#00ff88', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={14} /> {radarLabel}
        </div>
      )}

      {isClient && (
        <div className="mt5-card">
          <div className="mt5-card-header">
            <div className="mt5-card-title">{mobileT(lang, 'Auto Mirror', 'النسخ التلقائي')}</div>
            <button
              className={`mt5-btn ${autoTradeEnabled ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              onClick={() => onAutoTradeToggle(!autoTradeEnabled)}
              style={{ padding: '8px 16px', fontSize: 12 }}
            >
              {autoTradeEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="mt5-card-subtitle">
            {autoTradeEnabled
              ? mobileT(lang, 'Developer trades open instantly on your account', 'صفقات المطور تفتح فوراً على حسابك')
              : mobileT(lang, 'Tap ON to mirror developer signals automatically', 'فعّل لنسخ إشارات المطور تلقائياً')}
          </div>
        </div>
      )}
      {isClient && !hasPlan && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '9px 14px', fontSize: 12, color: '#F59E0B', fontWeight: 700 }}>
          {mobileT(lang, 'Free plan — limited signals. Upgrade for full access.', 'خطة مجانية — إشارات محدودة. رقِّ للوصول الكامل.')}
        </div>
      )}

      <div className="mt5-section-title">
        <Zap size={16} /> {mobileT(lang, 'Live Signals', 'الإشارات الحية')} ({fullSignals.length})
      </div>

      {fullSignals.length === 0 && (
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">📊</div>
          <div className="mt5-empty-title">{mobileT(lang, 'No active signals', 'لا توجد إشارات')}</div>
          <div className="mt5-empty-subtitle">{mobileT(lang, 'New opportunities will appear here', 'ستظهر الفرص الجديدة هنا')}</div>
        </div>
      )}

      {fullSignals.map((r) => (
        <MobileSignalCard key={r.symbol + (r.timestamp || '')} res={r} lang={lang}
          isDev={isDev} onDetail={onDetail} onTrade={onTrade} onRemove={onRemove} />
      ))}
    </div>
  );
}