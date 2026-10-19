import React from 'react';
import { Zap } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { useMobileMode, mobileT } from '../../lib/mobileMode';
import { MobileSignalCard } from './MobileSignalCard';

interface MobileHomeProps {
  fullSignals: AnalysisResult[];
  lang: Language;
  onDetail: (r: AnalysisResult) => void;
  onTrade: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  autoTradeEnabled: boolean;
  onAutoTradeToggle: (enabled: boolean) => void;
  radarOn: boolean;
  radarLabel: string | null;
}

const AR_CATS: Record<string, string> = {
  crypto: 'عملات مشفرة', forex: 'فوركس', stocks: 'أسهم', metals: 'معادن',
  energy: 'طاقة', indices: 'مؤشرات', custom: 'رموز مخصصة', other: 'أخرى',
};

const CAT_ORDER = ['crypto', 'forex', 'stocks', 'metals', 'energy', 'indices', 'custom', 'other'];

export function MobileHome({
  fullSignals, lang, onDetail, onTrade, onRemove,
  autoTradeEnabled, onAutoTradeToggle, radarOn, radarLabel,
}: MobileHomeProps) {
  const { isDev, isClient, hasPlan } = useMobileMode();
  const isAr = lang === 'ar';

  // Group by category → Top 3 by confidence (same rule as desktop finalyze:top_signals)
  const grouped = React.useMemo(() => {
    const map: Record<string, AnalysisResult[]> = {};
    for (const s of fullSignals) {
      const cat = String((s as Record<string, unknown>).category || 'other');
      (map[cat] = map[cat] || []).push(s);
    }
    const out: { cat: string; list: AnalysisResult[] }[] = [];
    const cats = Object.keys(map).sort((a, b) => CAT_ORDER.indexOf(a) - CAT_ORDER.indexOf(b));
    for (const cat of cats) {
      const list = map[cat]
        .slice()
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 3);
      if (list.length) out.push({ cat, list });
    }
    return out;
  }, [fullSignals]);
  return (
    <div className="mt5-page-container">
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
        <Zap size={16} /> {mobileT(lang, 'Top Signals (Top 3 per Category)', 'أفضل الإشارات (أفضل ٣ لكل فئة)')} ({fullSignals.length})
      </div>

      {fullSignals.length === 0 && (
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">📊</div>
          <div className="mt5-empty-title">{mobileT(lang, 'No active signals', 'لا توجد إشارات')}</div>
          <div className="mt5-empty-subtitle">{mobileT(lang, 'Run auto or manual analysis to get signals', 'شغّل التحليل التلقائي أو اليدوي للحصول على إشارات')}</div>
        </div>
      )}

      {grouped.map(({ cat, list }) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div className="mt5-section-title" style={{ fontSize: 13, padding: '4px 0', opacity: 0.9 }}>
            📁 {isAr ? (AR_CATS[cat] || cat) : cat}
            <span style={{ marginRight: 6, opacity: 0.6 }}>— {mobileT(lang, 'Top 3', 'أفضل ٣')} ({list.length})</span>
          </div>
          {list.map((r) => (
            <MobileSignalCard
              key={r.symbol + '_' + (r.timeframe || '') + '_' + ((r as Record<string, unknown>).source || 'auto')}
              res={r}
              lang={lang}
              isDev={isDev}
              onDetail={onDetail}
              onTrade={onTrade}
              onRemove={onRemove}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
