import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AnalysisResult, SignalType, MarketType } from '../types';
import { Activity, Zap, BarChart2, Info, Lock, Crown, Settings, Trash2, X } from 'lucide-react';
import TradingViewEmbed from './TradingViewEmbed';
import { Language, translations } from '../lib/i18n';
import { playClick, initAudio } from '../lib/audioEngine';
import { SYMBOL_CATEGORIES, ALL_SYMBOLS_DB } from '../constants';
import MarketHoursIndicator from './MarketHoursIndicator';
import { cn } from '../lib/utils';

interface ClientDashboardProps {
  results: AnalysisResult[];
  lang: Language;
  hasActivePlan?: boolean;
  onDetail?: (result: AnalysisResult) => void;
  onTrade?: (symbol: string) => void;
  /** Paid-plan client only: show the plan action icons under the market pills. */
  showPlanActions?: boolean;
  /** True when the client pressed "Return to Free Plan" — drives the free-mode banner. */
  freeModeChosen?: boolean;
  onActivatePaidPlan?: () => void;
  autoAnalysisOn?: boolean;
  onOpenMyPlan?: () => void;
  onNavigateManual?: () => void;
  onNavigateRadar?: () => void;
  onToggleAutoAnalysis?: () => void;
  onRemove?: (symbol: string) => void;
  onClearAll?: () => void;
}

const SIGNAL_META: Record<string, { color: string; bg: string; border: string; labelAr: string; labelEn: string; symbolColor: string }> = {
  [SignalType.STRONG_BUY]: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', labelAr: 'إشارة شراء قوي', labelEn: 'Strong Buy Signal', symbolColor: '#00ff88' },
  [SignalType.STRONG_SELL]: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/40', labelAr: 'إشارة بيع قوي', labelEn: 'Strong Sell Signal', symbolColor: '#ff4444' },
  [SignalType.BUY]: { color: 'text-emerald-400/80', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', labelAr: 'إشارة شراء', labelEn: 'Buy Signal', symbolColor: '#66ffaa' },
  [SignalType.SELL]: { color: 'text-red-400/80', bg: 'bg-red-500/10', border: 'border-red-500/20', labelAr: 'إشارة بيع', labelEn: 'Sell Signal', symbolColor: '#ff5555' },
};

const CATEGORY_CONFIG: Record<string, { emoji: string; labelAr: string; labelEn: string; color: string; borderColor: string }> = {
  forex: { emoji: '💱', labelAr: 'الفوركس', labelEn: 'Forex', color: 'text-blue-400', borderColor: 'border-blue-500/30' },
  crypto: { emoji: '🪙', labelAr: 'الكريبتو', labelEn: 'Crypto', color: 'text-purple-400', borderColor: 'border-purple-500/30' },
  stocks: { emoji: '📈', labelAr: 'الأسهم', labelEn: 'Stocks', color: 'text-yellow-400', borderColor: 'border-yellow-500/30' },
  metals: { emoji: '💎', labelAr: 'المعادن', labelEn: 'Metals', color: 'text-orange-400', borderColor: 'border-orange-500/30' },
};

function getSymbolCategory(symbol: string): string {
  const sym = symbol.toUpperCase().replace(/[-_=]/g, '');
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  for (const [cat, syms] of Object.entries(ALL_SYMBOLS_DB)) {
    if ((syms as string[]).includes(sym)) return cat.startsWith('stocks') ? 'stocks' : cat;
  }
  if (sym.endsWith('USD') && !sym.startsWith('USD') && sym.length > 6) return 'crypto';
  if (/\.(T|AS|PA|DE|L|SW|CO)$/.test(symbol)) return 'stocks';
  return 'forex';
}

const formatPublishDate = (timestamp: string, lang: string) => {
  try {
    const date = new Date(timestamp);
    const isAr = lang === 'ar';
    const daysAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = isAr ? daysAr[date.getUTCDay()] : daysEn[date.getUTCDay()];
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${dayName} ${hours}:${minutes}`;
  } catch {
    return timestamp;
  }
};

// Plan row shown directly UNDER the market-status pills, separated by a divider.
// Paid-plan clients only. Only "My Plan" lives here — it is the entry point for
// changing the analysis key. The Auto / Manual / Settings navigation icons were
// removed as duplicates of the existing header and sidebar controls.
function PlanActionRow({ isAr, autoAnalysisOn, onOpenMyPlan, onNavigateManual, onNavigateRadar, onToggleAutoAnalysis }: {
  isAr: boolean;
  autoAnalysisOn: boolean;
  onOpenMyPlan?: () => void;
  onNavigateManual?: () => void;
  onNavigateRadar?: () => void;
  onToggleAutoAnalysis?: () => void;
}) {
  const pill = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/30 active:scale-95 transition-all border border-black/10';
  const label = 'text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none';
  return (
    <div className="space-y-2">
      <div className="w-full h-px bg-black/10 dark:bg-white/20" />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => { initAudio(); onOpenMyPlan?.(); }}
          className={pill}
          title={isAr ? 'خطتي' : 'My Plan'}
        >
          <Crown size={24} className="flex-shrink-0" />
          <span className={label}>{isAr ? 'خطتي' : 'My Plan'}</span>
        </button>
        <button
          onClick={() => { initAudio(); onToggleAutoAnalysis?.(); }}
          className={pill}
          title={isAr ? 'التحليل التلقائي' : 'Auto Analysis'}
        >
          <Zap size={24} fill="currentColor" className="flex-shrink-0" />
          <span className={label}>{isAr ? 'تلقائي' : 'Auto'}</span>
          <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/20', autoAnalysisOn ? 'bg-emerald-400' : 'bg-slate-300')} />
        </button>
        <button
          onClick={() => onNavigateManual?.()}
          className={pill}
          title={isAr ? 'التحليل اليدوي' : 'Manual Analysis'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className={label}>{isAr ? 'يدوي' : 'Manual'}</span>
        </button>
        <button
          onClick={() => onNavigateRadar?.()}
          className={pill}
          title={isAr ? 'إعدادات التحليل التلقائي' : 'Auto Analysis Settings'}
        >
          <Settings size={24} className="flex-shrink-0" />
          <span className={label}>{isAr ? 'إعدادات' : 'Settings'}</span>
        </button>
      </div>
    </div>
  );
}

export default function ClientDashboard({ results, lang, hasActivePlan = false, onDetail, onTrade, showPlanActions = false, freeModeChosen = false, onActivatePaidPlan, autoAnalysisOn = false, onOpenMyPlan, onNavigateManual, onNavigateRadar, onToggleAutoAnalysis, onRemove, onClearAll }: ClientDashboardProps) {
  const isAr = lang === 'ar';
  const t = translations[lang];
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [symbolExplicitlySelected, setSymbolExplicitlySelected] = useState(false);
  const audioInitRef = useRef(false);

  const handleClick = useCallback(() => {
    if (!audioInitRef.current) { initAudio(); audioInitRef.current = true; }
    playClick();
  }, []);

  const now = Date.now();
  const getHoldPeriods = (tf: string) => {
    switch (tf) {
      case '1d': return { maxAge: 72 * 3600 * 1000 };
      case '4h': return { maxAge: 12 * 3600 * 1000 };
      case '1h': return { maxAge: 3 * 3600 * 1000 };
      case '15m': return { maxAge: 60 * 60 * 1000 };
      case '5m': return { maxAge: 30 * 60 * 1000 };
      default: return { maxAge: 12 * 3600 * 1000 };
    }
  };
  const activeResults = results.filter(r => {
    if (r.signal === 'neutral' || r.signal === 'no_entry') return false;
    if (r.isSideways) return false;
    const { maxAge } = getHoldPeriods(r.timeframe);
    return (now - new Date(r.timestamp).getTime()) < maxAge;
  });

  const grouped: Record<string, AnalysisResult[]> = { forex: [], crypto: [], stocks: [], metals: [] };
  for (const s of activeResults) {
    const cat = getSymbolCategory(s.symbol);
    if (grouped[cat]) grouped[cat].push(s);
    else grouped.forex.push(s);
  }
  const catOrder = ['forex', 'crypto', 'stocks', 'metals'] as const;
  const activeCategories = catOrder.filter(cat => grouped[cat].length > 0);

  const allFiltered = activeCategories.flatMap(cat => grouped[cat]);
  const activeResult = selectedSymbol ? allFiltered.find(r => r.symbol === selectedSymbol) : null;
  const activeSymbol = symbolExplicitlySelected && activeResult ? activeResult.symbol : null;

  if (allFiltered.length === 0) {
    return (
      <div className="space-y-6" style={{ direction: isAr ? 'rtl' : 'ltr' }}>
        {!freeModeChosen && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-5 py-3 flex items-center gap-3">
            <div className="relative">
              <Activity size={20} className="text-emerald-400" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            </div>
            <span className="text-sm font-black text-emerald-400">{isAr ? 'التحليل التلقائي نشط' : 'Auto Analysis Active'}</span>
            <span className="text-xs text-emerald-400/60 font-bold">{isAr ? (showPlanActions ? 'تحليل الفرص وفق إعدادات خطتك' : 'يتم تحليل الفرص في الوقت الفعلي') : (showPlanActions ? 'Auto opportunity analysis based on your plan' : 'Opportunities synchronized in real-time')}</span>
          </div>
        )}
        <MarketHoursIndicator lang={lang} />
        {showPlanActions && <PlanActionRow isAr={isAr} autoAnalysisOn={autoAnalysisOn} onOpenMyPlan={onOpenMyPlan} onNavigateManual={onNavigateManual} onNavigateRadar={onNavigateRadar} onToggleAutoAnalysis={onToggleAutoAnalysis} />}
        {!showPlanActions && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative w-16 h-16 mb-4">
              <div className="absolute inset-0 border-b-2 border-emerald-400 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center"><Activity size={24} className="text-emerald-400" /></div>
            </div>
            <h3 className="text-xl font-black text-white/70">{isAr ? 'في انتظار ظهور أفضل إشارات حالية' : 'Waiting for current best signals...'}</h3>
            <p className="text-sm text-white/40 mt-2">{isAr ? 'ستظهر أفضل الفرص والإشارات القوية والعادية هنا فور توفرها' : 'Top trading opportunities and strong signals will appear here as soon as they are available'}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ direction: isAr ? 'rtl' : 'ltr' }}>
      <style>{`.signal-card .text-emerald-400{color:#059669!important}.signal-card .text-red-400{color:#dc2626!important}`}</style>
      {!freeModeChosen && (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-5 py-3 flex items-center gap-3">
        <div className="relative">
          <Activity size={20} className="text-emerald-400" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        </div>
        <span className="text-sm font-black text-emerald-400">{isAr ? 'التحليل التلقائي نشط' : 'Auto Analysis Active'}</span>
        <span className="text-xs text-emerald-400/60 font-bold">{isAr ? (showPlanActions ? 'تحليل الفرص وفق إعدادات خطتك' : 'يتم مزامنة الفرص تلقائياً') : (showPlanActions ? 'Auto opportunity analysis based on your plan' : 'Opportunities synchronized in real-time')}</span>
      </div>
      )}
      <MarketHoursIndicator lang={lang} />
      {showPlanActions && <PlanActionRow isAr={isAr} autoAnalysisOn={autoAnalysisOn} onOpenMyPlan={onOpenMyPlan} onNavigateManual={onNavigateManual} onNavigateRadar={onNavigateRadar} onToggleAutoAnalysis={onToggleAutoAnalysis} />}

      {/* Opportunities Header with Clear All Button */}
      <div className={cn("flex items-center justify-between px-2 pt-2", isAr ? "flex-row-reverse" : "flex-row")}>
        <span className="text-xs font-black text-yellow-400 flex items-center gap-2 uppercase tracking-[0.15em]">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          {isAr ? 'أفضل فرص التداول' : 'Top Trading Opportunities'}
          <span className="text-[10px] text-white/40 font-mono">({allFiltered.length})</span>
        </span>
        {onClearAll && hasActivePlan && (
          <button 
            onClick={onClearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-400 hover:text-red-300 text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
            title={isAr ? 'مسح جميع الإشارات المعروضة' : 'Clear All Displayed Signals'}
          >
            <Trash2 size={13} />
            <span>{isAr ? 'مسح الإشارات' : 'Clear Signals'}</span>
          </button>
        )}
      </div>

      {/* Signal Cards grouped by category */}
      <div className="space-y-4">
        {activeCategories.map(cat => {
          const catSignals = grouped[cat];
          const cfg = CATEGORY_CONFIG[cat];
          const strong = catSignals.filter(s => s.signal === SignalType.STRONG_BUY || s.signal === SignalType.STRONG_SELL);
          const regular = catSignals.filter(s => s.signal === SignalType.BUY || s.signal === SignalType.SELL);
          const top3 = regular.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
          const displaySignals = [...strong, ...top3];
          return (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <span className="text-base">{cfg.emoji}</span>
                <span className={`text-sm font-black ${cfg.color}`}>{isAr ? cfg.labelAr : cfg.labelEn}</span>
                <span className="text-xs text-white/40 font-bold">({displaySignals.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {displaySignals.map((res, idx) => (
                  <ClientSignalCard
                    key={`all_${res.symbol}_${idx}`}
                    res={res}
                    isAr={isAr}
                    lang={lang}
                    selectedSymbol={selectedSymbol}
                    onSelect={(sym) => {
                      if (selectedSymbol === sym) {
                        setSelectedSymbol(null);
                        setSymbolExplicitlySelected(false);
                      } else {
                        setSelectedSymbol(sym);
                        setSymbolExplicitlySelected(true);
                      }
                      handleClick();
                    }}
                    onDetail={onDetail}
                    hasActivePlan={hasActivePlan}
                    formatPublishDate={formatPublishDate}
                    cardKey={`all_${res.symbol}_${idx}`}
                    onClick={handleClick}
                    onTrade={onTrade}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Chart - only shown when symbol is selected */}
      {activeSymbol && (
        <div className="bg-brand-alt rounded-3xl border border-white/10 overflow-hidden shadow-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 size={18} className="text-primary" />
            <span className="text-base font-black text-white italic tracking-wider chart-symbol-name">{activeSymbol}</span>
            {activeResult && SIGNAL_META[activeResult.signal] && (
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${SIGNAL_META[activeResult.signal].bg} ${SIGNAL_META[activeResult.signal].color} border ${SIGNAL_META[activeResult.signal].border}`}>
                {isAr ? SIGNAL_META[activeResult.signal].labelAr : SIGNAL_META[activeResult.signal].labelEn}
              </span>
            )}
          </div>
          <div className="h-[350px] md:h-[500px] rounded-2xl overflow-hidden relative">
            <TradingViewEmbed symbol={activeSymbol} interval="60" />
          </div>
        </div>
      )}
    </div>
  );
}

function ClientSignalCard({ res, isAr, lang, selectedSymbol, onSelect, onDetail, hasActivePlan, formatPublishDate, cardKey, onClick, onTrade, onRemove }: {
  res: AnalysisResult; isAr: boolean; lang: Language; selectedSymbol: string | null;
  onSelect: (sym: string) => void; onDetail?: (r: AnalysisResult) => void; hasActivePlan: boolean;
  formatPublishDate: (ts: string, lang: string) => string; cardKey: string;
  onClick?: () => void; onTrade?: (symbol: string) => void; onRemove?: (symbol: string) => void;
}) {
  const meta = SIGNAL_META[res.signal] || SIGNAL_META[SignalType.BUY];
  const isSelected = selectedSymbol === res.symbol;
  const isJPY = res.symbol.includes('JPY');
  const decimals = isJPY ? 3 : 5;
  const tp = res.takeProfit || 0;
  const sl = res.stopLoss || 0;

  return (
    <div data-card={cardKey} style={{ alignSelf: 'start', backgroundColor: 'rgba(var(--card-bg),0.88)' }} className="signal-card rounded-xl border-2 border-amber-600/40 transition-all overflow-hidden relative">
      {/* Very strong signal star */}
      {(res.signal === SignalType.STRONG_BUY || res.signal === SignalType.STRONG_SELL) && (
        <div className="absolute top-1 right-1 z-20" title={isAr ? 'فرصة قوية جداً' : 'Very Strong Opportunity'}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="white" className="drop-shadow-[0_0_8px_rgba(255,255,255,1)] animate-[pulse_1.5s_ease-in-out_infinite]">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
      )}

      {/* Remove button (X) */}
      {onRemove && hasActivePlan && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(res.symbol); }}
          className="absolute top-1 left-1 p-1 hover:bg-red-500/20 rounded-md text-white/30 hover:text-red-400 transition-colors z-20"
          title={isAr ? `حذف إشارة ${res.symbol}` : `Delete ${res.symbol} Signal`}
        >
          <X size={14} />
        </button>
      )}

      {/* MOBILE: horizontal card - symbol on left, key info on right */}
      <button onClick={() => { onSelect(res.symbol); onClick?.(); }} className="md:hidden w-full px-3 py-2.5 flex items-center gap-3">
        <div className="flex flex-col items-start min-w-0 flex-1">
          <span className="text-lg font-black italic leading-none truncate max-w-full" style={{ color: meta.symbolColor }}>{res.symbol}</span>
          <span className="text-[10px] font-black leading-tight mt-1 truncate max-w-full" style={{ color: meta.symbolColor }}>{isAr ? meta.labelAr : meta.labelEn}</span>
          <span className="text-[9px] font-bold leading-tight mt-1 text-white/50">{formatPublishDate(res.timestamp, lang)}</span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xl font-black font-mono leading-none text-white">{res.confidence}%</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black font-mono leading-none text-[#00ff88]">{tp ? tp.toFixed(decimals) : '—'}</span>
            <span className="text-xs font-black font-mono leading-none text-[#ff4444]">{sl ? sl.toFixed(decimals) : '—'}</span>
          </div>
          {res.isSideways !== undefined && (
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border leading-none ${
              res.isSideways ? 'text-white bg-white/20 border-white/30' :
              res.sidewaysDirection === 'uptrend' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30' :
              res.sidewaysDirection === 'downtrend' ? 'text-red-300 bg-red-500/20 border-red-500/30' : ''
            }`}>
              {res.isSideways ? (isAr ? 'عرضي' : 'Side') : res.sidewaysDirection === 'uptrend' ? (isAr ? 'صاعد' : 'Up') : res.sidewaysDirection === 'downtrend' ? (isAr ? 'هابط' : 'Down') : ''}
            </span>
          )}
        </div>
      </button>

      {/* DESKTOP: original vertical card (unchanged) */}
      <button onClick={() => { onSelect(res.symbol); onClick?.(); }} className="hidden md:flex w-full px-3 py-1.5 flex-col items-center gap-1">
        <div className="flex items-center justify-center w-full gap-2 overflow-hidden">
          <span className="text-sm sm:text-base font-black font-mono" style={{color:'#00ff88'}}>{tp ? tp.toFixed(decimals) : '—'}</span>
          <span className="text-lg sm:text-xl font-black italic flex-shrink-0 text-center" style={{ color: meta.symbolColor }}>{res.symbol}</span>
          <span className="text-sm sm:text-base font-black font-mono" style={{color:'#ff4444'}}>{sl ? sl.toFixed(decimals) : '—'}</span>
        </div>
        <span className="text-base sm:text-lg font-black" style={{color: meta.symbolColor}}>{isAr ? meta.labelAr : meta.labelEn}</span>
        <div className="flex items-center gap-2">
          <span className="text-xl sm:text-3xl font-black font-mono" style={{color:'#ffffff'}}>{res.confidence}%</span>
          {res.isSideways !== undefined && (
            <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${
              res.isSideways ? 'text-white bg-white/20 border-white/30' :
              res.sidewaysDirection === 'uptrend' ? 'text-emerald-300 bg-emerald-500/20 border-emerald-500/30' :
              res.sidewaysDirection === 'downtrend' ? 'text-red-300 bg-red-500/20 border-red-500/30' : ''
            }`}>
              {res.isSideways ? (isAr ? 'عرضي' : 'Side') : res.sidewaysDirection === 'uptrend' ? (isAr ? 'صاعد' : 'Up') : res.sidewaysDirection === 'downtrend' ? (isAr ? 'هابط' : 'Down') : ''}
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] sm:text-xs font-bold" style={{color:'rgba(255,255,255,0.85)'}}>{formatPublishDate(res.timestamp, lang)}</span>
          </div>
        </div>
      </button>

      {/* Buttons row | MOBILE: side-by-side, DESKTOP: full-width stacked */}
      <div className="flex gap-1.5 p-1.5 md:p-0 md:gap-0 md:block">
        {res.detailedReasons && res.detailedReasons.length > 0 && (
          <button onClick={(e) => { e.stopPropagation(); onDetail?.(res); }} className="flex-1 md:flex-none md:w-full py-1.5 md:py-2.5 bg-[#F59E0B] hover:bg-[#d97706] transition-all text-black font-black text-[10px] md:text-xs uppercase tracking-wider flex items-center justify-center gap-2 rounded-md md:rounded-none">
            <span>{isAr ? 'اسباب التحليل' : 'Analysis Reasons'}</span>
            <span className="bg-black/20 px-1.5 py-0.5 rounded-full text-[9px] md:text-[10px]">{res.detailedReasons.length}</span>
          </button>
        )}
        {onTrade && hasActivePlan && (
          <button onClick={(e) => { e.stopPropagation(); onTrade(res.symbol); }} className="flex-1 md:flex-none md:w-full py-1.5 md:py-2 bg-[#F59E0B]/20 hover:bg-[#F59E0B]/40 transition-all text-[#F59E0B] text-[10px] md:text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 rounded-md md:rounded-none border-t-0 md:border-t md:border-[#F59E0B]/30" title={isAr ? `تداول ${res.symbol}` : `Trade ${res.symbol}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M17 7h4v4" />
            </svg>
            <span>{isAr ? 'تداول' : 'Trade'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
