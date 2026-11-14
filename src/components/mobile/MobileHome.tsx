import React, { useState } from 'react';
import { Zap, Lock } from 'lucide-react';
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
  onRemoveAll: () => void;
  autoTradeEnabled: boolean;
  onAutoTradeToggle: (enabled: boolean) => void;
  radarOn: boolean;
  radarLabel: string | null;
  radarProgress: { current: string; total: number; index: number; category?: string } | null;
  signalsAllowed: boolean;
}

const AR_CATS: Record<string, string> = {
  crypto: 'عملات مشفرة', forex: 'فوركس', stocks: 'أسهم', metals: 'معادن',
  energy: 'طاقة', indices: 'مؤشرات', custom: 'رموز مخصصة', other: 'أخرى',
};

const CAT_ORDER = ['forex', 'crypto', 'stocks', 'metals', 'energy', 'indices', 'custom', 'other'];

export function MobileHome({
  fullSignals, lang, onDetail, onTrade, onRemove, onRemoveAll,
  autoTradeEnabled, onAutoTradeToggle, radarOn, radarLabel, radarProgress,
  signalsAllowed,
}: MobileHomeProps) {
  const { isDev, isClient, hasPlan } = useMobileMode();
  const isAr = lang === 'ar';
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('mobile_favorites') || '[]'); } catch { return []; }
  });

  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
      try { localStorage.setItem('mobile_favorites', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Group by category → Top 3 by confidence (same rule as desktop finalyze:top_signals).
  // FIX: stable fixed order + stable inner order so categories never flicker
  // while the radar is still scanning (no re-ordering mid-analysis).
  const grouped = React.useMemo(() => {
    const map: Record<string, AnalysisResult[]> = {};
    for (const s of fullSignals) {
      const cat = String((s as unknown as Record<string, unknown>).category || 'other');
      (map[cat] = map[cat] || []).push(s);
    }
    const out: { cat: string; list: AnalysisResult[] }[] = [];
    const cats = Object.keys(map).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a);
      const ib = CAT_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const cat of cats) {
      const list = map[cat]
        .slice()
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || String(a.symbol).localeCompare(String(b.symbol)))
        .slice(0, 3);
      if (list.length) out.push({ cat, list });
    }
    return out;
  }, [fullSignals]);
  return (
    <div className="mt5-page-container">
      <style>{`@keyframes mt5-radar-stripes { from { background-position: 0 0; } to { background-position: 28px 0; } }`}</style>

      {/* Live auto-analysis progress — first thing under the four market boxes.
          Solid yellow like the auto-analysis settings card, thicker moving bar
          and larger inner text (category / symbol / counter). */}
      {(isDev || hasPlan) && radarProgress && (
        <div
          style={{
            background: '#FACC15',
            border: '1px solid #EAB308',
            borderRadius: 14,
            padding: '12px 14px',
            marginBottom: 10,
            color: '#111827',
            boxShadow: '0 3px 12px rgba(250,204,21,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Zap size={21} style={{ color: '#111827', fill: '#111827', flexShrink: 0 }} />
            <span style={{ fontSize: 15, fontWeight: 900, color: '#111827', lineHeight: 1.15 }}>
              {mobileT(lang, 'Auto analysis started', 'بدأ التحليل التلقائي')}
            </span>
            {radarProgress.category && (
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 900,
                  color: '#111827',
                  background: 'rgba(17,24,39,0.12)',
                  border: '1px solid rgba(17,24,39,0.28)',
                  borderRadius: 8,
                  padding: '2px 8px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 130,
                }}
              >
                {isAr ? (AR_CATS[radarProgress.category] || radarProgress.category) : radarProgress.category}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 900, color: '#111827', flexShrink: 0 }} dir="ltr">
              {radarProgress.index}/{radarProgress.total}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, fontSize: 14 }}>
            <span style={{ color: '#78350F', fontWeight: 800 }}>
              {mobileT(lang, 'Analyzing now', 'يُحلَّل الآن')}
            </span>
            <span style={{ color: '#111827', fontWeight: 900, fontSize: 17 }} dir="ltr">
              {radarProgress.current}
            </span>
          </div>

          {/* 2× thicker than before, with moving stripes so progress is obvious. */}
          <div style={{ height: 16, borderRadius: 8, background: 'rgba(17,24,39,0.22)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${radarProgress.total > 0 ? Math.round((radarProgress.index / radarProgress.total) * 100) : 0}%`,
                borderRadius: 8,
                background: 'repeating-linear-gradient(45deg, #111827 0 10px, #065F46 10px 20px)',
                backgroundSize: '28px 28px',
                animation: 'mt5-radar-stripes 0.8s linear infinite',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      {radarOn && radarLabel && (
        <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '9px 14px', fontSize: 12, fontWeight: 700, color: '#00ff88', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={15} style={{ color: '#FACC15', fill: '#FACC15' }} /> {radarLabel}
        </div>
      )}

      {/* PAID-ONLY: without an active paid plan (free plan, or paid paused) NO
          signal is rendered — the developer's main-site analysis is visible to
          paid clients in paid mode only. Solid yellow so the lock is obvious. */}
      {!signalsAllowed && (
        <div style={{ background: '#FACC15', border: '1px solid #EAB308', borderRadius: 14, padding: '16px 14px', marginBottom: 12, color: '#111827', boxShadow: '0 3px 12px rgba(250,204,21,0.35)', textAlign: 'center' }}>
          <Lock size={30} style={{ color: '#111827', marginBottom: 6 }} />
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
            {mobileT(lang, 'Signals are locked', 'الإشارات مقفلة')}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#78350F', lineHeight: 1.6 }}>
            {mobileT(lang,
              'Signals from the developer analysis appear only for paid-plan accounts inside paid mode. Activate your plan from the yellow bar above to view and trade them.',
              'إشارات تحليل المطوّر تظهر فقط لحسابات الخطة المدفوعة داخل وضع الخطة. فعّل خطتك من الشريط الأصفر بالأعلى لعرضها والتداول عليها.')}
          </div>
        </div>
      )}

      {signalsAllowed && (<>
      <div className="mt5-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span><Zap size={16} /> {mobileT(lang, 'Best current signal', 'أفضل إشارة حالية')}</span>
        {fullSignals.length > 0 && (
          <button className="mt5-btn mt5-btn-danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onRemoveAll}>
            {mobileT(lang, 'Clear all', 'حذف الكل')}
          </button>
        )}
      </div>

      {fullSignals.length === 0 && (
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">📊</div>
          <div className="mt5-empty-title">{mobileT(lang, 'No active signals', 'لا توجد إشارات')}</div>
          <div className="mt5-empty-subtitle">{mobileT(lang, 'Run auto or manual analysis to get signals', 'شغّل التحليل التلقائي أو اليدوي للحصول على إشارات')}</div>
        </div>
      )}

      {favorites.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="mt5-section-title" style={{ fontSize: 13, padding: '4px 0', opacity: 0.9 }}>
            ⭐ {isAr ? 'المفضلة' : 'Favorites'} ({favorites.length})
          </div>
          {fullSignals.filter((s) => favorites.includes(s.symbol)).map((r) => (
            <MobileSignalCard
              key={'fav_' + r.symbol + '_' + (r.timeframe || '')}
              res={r}
              lang={lang}
              isDev={isDev}
              isClient={isClient}
              onDetail={onDetail}
              onTrade={onTrade}
              onRemove={onRemove}
              onToggleFavorite={toggleFavorite}
              isFavorite={true}
            />
          ))}
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
              key={r.symbol + '_' + (r.timeframe || '') + '_' + ((r as unknown as Record<string, unknown>).source || 'auto')}
              res={r}
              lang={lang}
              isDev={isDev}
              isClient={isClient}
              onDetail={onDetail}
              onTrade={onTrade}
              onRemove={onRemove}
              onToggleFavorite={toggleFavorite}
              isFavorite={favorites.includes(r.symbol)}
            />
          ))}
        </div>
      ))}
      </>)}
    </div>
  );
}
