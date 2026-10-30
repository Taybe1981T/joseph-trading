import React from 'react';
import { TrendingUp, TrendingDown, Star, Trash2, BarChart3 } from 'lucide-react';
import { AnalysisResult, SignalType } from '../../types';
import { Language } from '../../lib/i18n';

interface Props {
  res: AnalysisResult;
  lang: Language;
  isDev: boolean;
  isClient: boolean;
  onDetail: (r: AnalysisResult) => void;
  onTrade: (symbol: string) => void;
  onRemove?: (symbol: string) => void;
  onToggleFavorite?: (symbol: string) => void;
  isFavorite?: boolean;
}

export function sigColor(signal: string): string {
  if (signal === 'strong_buy') return '#00ff88';
  if (signal === 'strong_sell') return '#ff4444';
  if (signal === 'buy') return '#66ffaa';
  return '#ff5555';
}

export function sigLabel(signal: string, lang: Language): string {
  const ar = lang === 'ar';
  if (signal === 'strong_buy') return ar ? 'إشارة شراء قوي' : 'Strong Buy Signal';
  if (signal === 'strong_sell') return ar ? 'إشارة بيع قوي' : 'Strong Sell Signal';
  if (signal === 'buy') return ar ? 'إشارة شراء' : 'Buy Signal';
  return ar ? 'إشارة بيع' : 'Sell Signal';
}

export function fmtDate(ts: string, lang: Language): string {
  try {
    const d = new Date(ts);
    const days = lang === 'ar'
      ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${days[d.getUTCDay()]} ${hh}:${mm}`;
  } catch { return ''; }
}

export function MobileSignalCard({ res, lang, isDev, isClient, onDetail, onTrade, onRemove, onToggleFavorite, isFavorite }: Props) {
  const isAr = lang === 'ar';
  const color = sigColor(String(res.signal));
  const isJPY = res.symbol.includes('JPY');
  const dec = isJPY ? 3 : 5;
  const strong = res.signal === SignalType.STRONG_BUY || res.signal === SignalType.STRONG_SELL;
  return (
    <div className="mt5-signal-card" style={{ position: 'relative', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      {strong && (
        <div style={{ position: 'absolute', top: 4, right: 6 }} title={isAr ? 'فرصة قوية جداً' : 'Very Strong'}>
          <Star size={20} fill="#fff" color="#fff" />
        </div>
      )}
      {isDev && onRemove && (
        <button onClick={() => onRemove(res.symbol)}
          style={{ position: 'absolute', top: 4, left: 6, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }} aria-label="Delete">
          <Trash2 size={14} />
        </button>
      )}
      {onToggleFavorite && (
        <button onClick={() => onToggleFavorite(res.symbol)}
          style={{ position: 'absolute', top: 4, right: strong ? 30 : 6, background: 'transparent', border: 'none', color: isFavorite ? '#F59E0B' : 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }} aria-label="Favorite">
          <Star size={14} fill={isFavorite ? '#F59E0B' : 'none'} color={isFavorite ? '#F59E0B' : 'rgba(255,255,255,0.3)'} />
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', color }}>{res.symbol}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color, marginTop: 2 }}>{sigLabel(String(res.signal), lang)}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{fmtDate(res.timestamp, lang)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{res.confidence}%</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: 12, fontWeight: 800 }}>
            <span style={{ color: '#00ff88' }}>{res.takeProfit ? res.takeProfit.toFixed(dec) : '—'}</span>
            <span style={{ color: '#ff5555' }}>{res.stopLoss ? res.stopLoss.toFixed(dec) : '—'}</span>
          </div>
        </div>
        <div className={`mt5-signal-badge ${String(res.signal).includes('sell') ? 'sell' : 'buy'}`} style={{ alignSelf: 'center' }}>
          {String(res.signal).includes('sell') ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
        </div>
      </div>
      {isClient && (
        <div style={{ fontSize: 11, color: '#aaa', padding: '4px 0', fontStyle: 'italic' }}>
          {isAr ? `${res.symbol} — إشارة ${res.signal === 'strong_buy' || res.signal === 'buy' ? 'شراء' : 'بيع'} قوية (ثقة ${res.confidence}%) بناءً على تحليل فني متقدم` : `${res.symbol} — ${res.signal === 'strong_buy' || res.signal === 'buy' ? 'Buy' : 'Sell'} signal (confidence ${res.confidence}%) based on advanced technical analysis`}
        </div>
      )}
      {res.entryPrice ? (
        <div style={{ display: 'flex', gap: 10, fontSize: 12, color: '#aaa', fontWeight: 700 }}>
          <span>Entry <b style={{ color: '#fff' }}>{res.entryPrice}</b></span>
          {res.trendMaturity && res.trendMaturity !== 'unknown' && <span style={{ marginLeft: 'auto' }}>{res.trendMaturity}</span>}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        {res.detailedReasons && res.detailedReasons.length > 0 && (
          <button onClick={() => onDetail(res)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#F59E0B', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {isAr ? 'أسباب التحليل' : 'Reasons'} ({res.detailedReasons.length})
          </button>
        )}
        <button onClick={() => onTrade(res.symbol)}
          style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.12)', color: '#F59E0B', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <BarChart3 size={14} /> {isAr ? 'تداول' : 'Trade'}
        </button>
      </div>
    </div>
  );
}