import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { User } from 'firebase/auth';
import { ChevronDown, Search, ArrowRight, TrendingUp, Bitcoin, DollarSign, Gem, Briefcase, Play, ListFilter, Plus, Zap, X, Clock, Sparkles, Star, Crown, Activity, Ban } from 'lucide-react';
import { MarketType, AnalysisResult, TradingStyle, StrategySettings } from '../types';
import { MARKET_CATEGORIES, TIMEFRAMES, SYMBOL_GROUPS, TRADING_STYLES, ALL_SYMBOLS_DB, FREE_SYMBOLS } from '../constants';
import { analyzeMarket, analyzeMarketBatch, getApiKey } from '../services/geminiService';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Language, translations } from '../lib/i18n';
import { getStatus, subscribe } from '../services/rateLimitTracker';
import { getOpenStockExchanges } from '../lib/marketHours';
import { isDeveloperEmail } from '../lib/clientIds';
import { consumeSymbolAnalyses } from '../services/manualQuota';

interface AnalysisFormProps {
  user: User | null;
  onBegin: () => void;
  onProgress: (current: string, total: number, index: number, failed?: number) => void;
  onResult: (res: AnalysisResult[]) => void;
  onError: (msg?: string, allFailed?: boolean) => void;
  lang: Language;
  settings: StrategySettings;
  hasActivePlan: boolean;
  onUpgrade: () => void;
  autoStartToken?: number;
  onAutoStartConsumed?: () => void;
}

interface FormValues {
  symbol: string;
  type: MarketType;
  timeframe: string;
  tradingStyle: TradingStyle;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  DollarSign: <DollarSign size={20} />,
  Bitcoin: <Bitcoin size={20} />,
  TrendingUp: <TrendingUp size={20} />,
  Gem: <Gem size={20} />,
  Zap: <Zap size={18} />,
  Play: <Play size={18} />,
  Clock: <Clock size={18} />,
};

export default function AnalysisForm({ user, onBegin, onProgress, onResult, onError, lang, settings, hasActivePlan, onUpgrade, autoStartToken = 0, onAutoStartConsumed }: AnalysisFormProps) {
  const t = translations[lang];
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [analyzingIndex, setAnalyzingIndex] = useState<number | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownSearch, setDropdownSearch] = useState("");
  const [showAllSymbols, setShowAllSymbols] = useState(false);
  const [showUpgradeOverlay, setShowUpgradeOverlay] = useState(false);
  const [hiddenSymbols, setHiddenSymbols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('finalyze_hidden_symbols');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [customSymbols, setCustomSymbols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('finalyze_custom_symbols');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('finalyze_hidden_symbols', JSON.stringify(hiddenSymbols));
  }, [hiddenSymbols]);

  useEffect(() => {
    localStorage.setItem('finalyze_custom_symbols', JSON.stringify(customSymbols));
  }, [customSymbols]);

  const [rateLimitActive, setRateLimitActive] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  useEffect(() => {
    const u = subscribe(() => {
      const s = getStatus();
      setRateLimitActive(s.active);
      setRateLimitCountdown(s.remainingSec);
    });
    return u;
  }, []);
  useEffect(() => {
    if (!rateLimitActive) return;
    const interval = setInterval(() => {
      const s = getStatus();
      setRateLimitActive(s.active);
      setRateLimitCountdown(s.remainingSec);
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitActive]);

  const [activeDropdown, setActiveDropdown] = useState<MarketType | null>(null);
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      type: MarketType.FOREX,
      timeframe: "1d",
      tradingStyle: TradingStyle.DAY_TRADING,
      symbol: ""
    }
  });

  const selectedType = watch("type");
  const selectedTimeframe = watch("timeframe");
  const selectedStyle = watch("tradingStyle");
  const isRTL = lang === 'ar';

  // Update hidden symbol input when selections change
  useEffect(() => {
    setValue("symbol", selectedSymbols.join(", "));
  }, [selectedSymbols, setValue]);

  const toggleSymbol = (sym: string) => {
    if (!hasActivePlan && !FREE_SYMBOLS[selectedType]?.includes(sym)) {
      setShowUpgradeOverlay(true);
      return;
    }
    setSelectedSymbols(prev => 
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  };

  const selectAllInCategory = () => {
    if (!hasActivePlan) {
      setShowUpgradeOverlay(true);
      return;
    }
    const allGroupsSymbols = SYMBOL_GROUPS[selectedType]?.flatMap(g => g.symbols) || [];
    const customForType = customSymbols.filter(s => 
      (ALL_SYMBOLS_DB[selectedType] || []).includes(s) &&
      !allGroupsSymbols.includes(s)
    );
    const all = [...allGroupsSymbols, ...customForType].filter(s => !hiddenSymbols.includes(s));
    
    const areAllSelected = all.length > 0 && all.every(s => selectedSymbols.includes(s));
    
    if (areAllSelected) {
      setSelectedSymbols(prev => prev.filter(s => !all.includes(s)));
    } else {
      setSelectedSymbols(prev => [...new Set([...prev, ...all])]);
    }
  };

  const removeSymbol = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasActivePlan && FREE_SYMBOLS[selectedType]?.includes(sym)) return;
    if (customSymbols.includes(sym)) {
      setCustomSymbols(prev => prev.filter(s => s !== sym));
    } else {
      setHiddenSymbols(prev => [...prev, sym]);
    }
    setSelectedSymbols(prev => prev.filter(s => s !== sym));
  };

  const isMarketOpen = (category: string) => {
    if (category === 'crypto') return true;
    if (category === 'stocks') return getOpenStockExchanges().length > 0;
    const day = new Date().getUTCDay();
    if (day === 0 || day === 6) return false;
    return true;
  };

  const clearAll = () => {
    if (!hasActivePlan) { setShowUpgradeOverlay(true); return; }
    setSelectedSymbols([]);
  };

  const onSubmit = async (data: FormValues) => {
    setFormErrors([]);
    
    if (!hasActivePlan) {
      data.timeframe = '1d';
      data.tradingStyle = TradingStyle.DAY_TRADING;
    }

    if (!isMarketOpen(data.type)) {
      setFormErrors([lang === 'ar' ? 'عفواً.. هذه الأسواق مغلقة حالياً ولا يمكن تحليلها' : 'Sorry.. These markets are currently closed and cannot be analyzed']);
      return;
    }

    console.log("[Form] Submit clicked. Symbols:", selectedSymbols, "Manual:", data.symbol);

    if (!user && !hasActivePlan) {
      setFormErrors([t.loginRequired]);
      return;
    }

    const manualSymbols = data.symbol.split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s !== "");
    
    const allSymbolsToAnalyze = [...new Set([...selectedSymbols, ...manualSymbols])]
      .filter(s => s && s.length > 1);

    if (allSymbolsToAnalyze.length === 0) {
      setFormErrors([t.selectAtLeastOne]);
      return;
    }

    // Paid-client analysis quota: 5 analyses per symbol per UTC day, shared
    // between manual and automatic analysis. A batch consumes one unit of every
    // symbol it contains. Developers are never limited.
    let targets = allSymbolsToAnalyze;
    if (hasActivePlan && !isDeveloperEmail(user?.email)) {
      const quota = consumeSymbolAnalyses(user?.email || null, allSymbolsToAnalyze, lang);
      if (quota.blocked.length > 0 && quota.message) setFormErrors([quota.message]);
      if (quota.allowed.length === 0) return;
      targets = quota.allowed;
    }

    console.log("[Form] Beginning analysis for:", targets);
    onBegin();
    const results: AnalysisResult[] = [];
    const failedSymbols: { symbol: string; error: string }[] = [];
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // Batch analysis: ONE AI call for ALL symbols — eliminates rate limiting
      onProgress(targets[0], targets.length, 0);
      const batchResult = await analyzeMarketBatch(
        targets.map(sym => ({
          symbol: sym,
          type: data.type,
          timeframe: data.timeframe,
          tradingStyle: data.tradingStyle
        })),
        settings,
        lang,
        (current, total, index, failed) => onProgress(current, total, index, failed)
      );

      for (const r of batchResult.results) {
        r.userId = user?.uid || 'anonymous';
        results.push(r);
        if (user?.uid) {
          try {
            await addDoc(collection(db, "analysisResults"), {
              symbol: String(r.symbol || ''),
              type: String(r.type || ''),
              timeframe: String(r.timeframe || ''),
              signal: String(r.signal || 'neutral'),
              confidence: Number(r.confidence) || 0,
              summary: String(r.summary || ''),
              technicalScore: Number(r.technicalScore) || 0,
              sentimentScore: Number(r.sentimentScore) || 0,
              trendAge: Number(r.trendAge) || 0,
              trendMaturity: String(r.trendMaturity || 'unknown'),
              microTF: String(r.microTF || ''),
              microSignal: String(r.microSignal || 'unknown'),
              microTrend: String(r.microTrend || ''),
              entryPrice: Number(r.entryPrice) || 0,
              stopLoss: Number(r.stopLoss) || 0,
              takeProfit: Number(r.takeProfit) || 0,
              primaryMetCount: Number(r.primaryMetCount) || 0,
              direction: String(r.direction || ''),
              historicalMatch: String(r.historicalMatch || ''),
              timestamp: serverTimestamp(),
              userId: r.userId,
            });
          } catch (e: any) {
            console.warn('[Form] Firestore save skipped:', e.message);
          }
        }
      }
      for (const e of batchResult.errors) {
        failedSymbols.push(e);
      }

      if (results.length > 0) {
        onResult(results);
      }

      if (failedSymbols.length > 0) {
        const failedList = failedSymbols.map(f => `${f.symbol}`).join(', ');
        const sampleErrors = [...new Set(failedSymbols.map(f => f.error))].slice(0, 3).join('; ');
        const summary = lang === 'ar'
          ? `نجح ${results.length} من ${targets.length}. فشل ${failedSymbols.length}: ${failedList}. (${sampleErrors})`
          : `${results.length}/${targets.length} succeeded. ${failedSymbols.length} failed: ${failedList}. (${sampleErrors})`;
        setFormErrors(failedSymbols.map(f => `${f.symbol}: ${f.error}`));
        onError(summary, results.length === 0);
      } else if (results.length === 0) {
        onError(lang === 'ar' ? 'فشل التحليل لجميع الرموز' : 'Analysis failed for all symbols', true);
      }
    } catch (error: any) {
      console.error("[Global Form Error]:", error);
      onError(error.message || "Unknown error occurred.", true);
      setFormErrors([error.message || "Unknown error occurred."]);
    }
    abortRef.current = null;
    setAnalyzingIndex(null);
  };

  // Auto-start analysis when "Auto Analysis" icon is pressed (client paid plan):
  // runs immediately on the symbols chosen in the manual analysis page.
  const prevAutoStartTokenRef = useRef(0);
  useEffect(() => {
    if (autoStartToken <= 0 || autoStartToken === prevAutoStartTokenRef.current) return;
    prevAutoStartTokenRef.current = autoStartToken;
    const type = selectedType;
    let syms = selectedSymbols;
    if (syms.length === 0) {
      const allGroupsSymbols = SYMBOL_GROUPS[type]?.flatMap(g => g.symbols) || [];
      const customForType = customSymbols.filter(s =>
        (ALL_SYMBOLS_DB[type] || []).includes(s) &&
        !allGroupsSymbols.includes(s)
      );
      syms = [...new Set([...allGroupsSymbols, ...customForType])].filter(s => !hiddenSymbols.includes(s));
      setSelectedSymbols(syms);
    }
    const data: FormValues = {
      symbol: syms.join(', '),
      type,
      timeframe: selectedTimeframe,
      tradingStyle: selectedStyle,
    };
    setTimeout(() => { onSubmit(data); }, 50);
    onAutoStartConsumed?.();
  }, [autoStartToken]);

  return (
    <div className="max-w-4xl mx-auto">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        
        <AnimatePresence>
          {formErrors.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-500/10 border border-red-500/50 p-4 rounded-2xl text-red-500 text-base font-black text-center mb-4"
            >
              {formErrors.map((err, idx) => (
                <div key={idx}>{err}</div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        
        <div className="space-y-4">
          {rateLimitActive && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2 text-red-400 text-xs font-bold">
              <Ban size={14} />
              <span>{lang === 'ar' ? `معدل الطلبات ممتلئ — يعود بعد ${rateLimitCountdown} ثانية` : `Rate limit exceeded — resets in ${rateLimitCountdown}s`}</span>
            </div>
          )}
          {!rateLimitActive && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2 text-emerald-400 text-xs font-bold">
              <Activity size={14} />
              <span>{lang === 'ar' ? 'الطلبات نشطة' : 'Requests active'}</span>
            </div>
          )}
          <label className="text-base font-black text-brand-text opacity-100 uppercase tracking-widest pl-2">{t.selectMarket}</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {MARKET_CATEGORIES.map((cat) => (
              <div key={cat.id} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setValue("type", cat.id);
                    setActiveDropdown(activeDropdown === cat.id ? null : cat.id);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-4 md:p-5 rounded-[1.5rem] md:rounded-[2rem] border-2 transition-all group relative overflow-hidden min-h-[88px] md:min-h-0",
                    selectedType === cat.id 
                      ? "border-emerald-400 bg-emerald-100 text-black shadow-[0_0_30px_rgba(16,185,129,0.15)] scale-[1.02]" 
                      : "border-black/10 bg-[#F59E0B] text-black hover:bg-[#d97706]"
                  )}
                >
                  {selectedType === cat.id && (
                    <motion.div 
                      layoutId="activeMarket"
                      className="absolute inset-0 bg-primary/5 -z-10"
                    />
                  )}
                  <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                    <div className={cn(
                      "p-2.5 md:p-2.5 rounded-xl transition-all flex-shrink-0", 
                      selectedType === cat.id ? "bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]" : "bg-black/10 text-black"
                    )}>
                      {ICON_MAP[cat.icon]}
                    </div>
                    <div className="flex flex-col items-start min-w-0 flex-1">
                      <span className="text-[13px] md:text-base font-black uppercase tracking-widest text-black leading-tight whitespace-normal break-words">{t[cat.id as keyof typeof t]}</span>
                      <span className="text-[10px] md:text-xs font-bold text-black/60 uppercase leading-tight whitespace-normal">{t.popularSymbols}</span>
                    </div>
                  </div>
                  
                  <div className={cn(
                    "p-1.5 rounded-lg transition-all",
                    activeDropdown === cat.id ? "rotate-180 bg-black/10 text-black" : "text-black/60"
                  )}>
                    <ChevronDown size={14} />
                  </div>
                </button>

                <AnimatePresence>
                  {activeDropdown === cat.id && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setActiveDropdown(null)} 
                      />
                      <motion.div
                        initial={{ opacity: 0, y: 15, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full left-0 right-0 mt-4 p-6 bg-brand-bg border border-brand-text/10 rounded-[2.5rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] z-50 min-w-[300px] md:min-w-[400px] max-h-[450px] overflow-y-auto custom-scrollbar"
                      >
                        <div className="flex items-center justify-between mb-4">
                           <div className="flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                             <span className="text-sm font-black text-brand-text uppercase tracking-[0.2em]">{t.popularSymbols}</span>
                           </div>
                           <span className="text-xs font-bold text-brand-muted uppercase">{t[cat.id as keyof typeof t]}</span>
                        </div>

                        {/* Dropdown Search */}
                        <div className="relative mb-6">
                           <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-muted" size={14} />
                           <input 
                             type="text"
                             placeholder={lang === 'ar' ? 'بحث عن أي رمز عالمي...' : 'Search global symbols...'}
                             value={dropdownSearch}
                             onChange={(e) => setDropdownSearch(e.target.value)}
                             className="w-full bg-brand-text/5 border border-brand-text/10 rounded-2xl py-3 pl-10 pr-4 text-sm font-bold text-brand-text placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                           />
                           {dropdownSearch && (
                             <button 
                               onClick={() => setDropdownSearch("")}
                               className="absolute right-4 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-text"
                             >
                               <X size={12} />
                             </button>
                           )}
                        </div>

                        <div className="space-y-6">
                          <div className="space-y-3">
                            {dropdownSearch ? (
                              <>
                                <h6 className="text-xs font-black text-primary uppercase tracking-widest px-1">
                                  {lang === 'ar' ? 'نتائج البحث' : 'Search Results'}
                                </h6>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {(() => {
                                    const dropdownDisplayed = [
                                      ...(SYMBOL_GROUPS[cat.id]?.flatMap(g => g.symbols) || []),
                                      ...customSymbols
                                    ].filter(sym => !hiddenSymbols.includes(sym));

                                    const results = ALL_SYMBOLS_DB[cat.id]
                                      ?.filter(s => s.toLowerCase().includes(dropdownSearch.toLowerCase())) || [];

                                    return (
                                      <>
                                        {results.slice(0, 24).map((sym) => (
                                          <button
                                            key={sym}
                                            type="button"
                                            onClick={() => {
                                              if (!hasActivePlan) { setShowUpgradeOverlay(true); return; }
                                              setHiddenSymbols(prev => prev.filter(s => s !== sym));
                                              if (!customSymbols.includes(sym)) {
                                                setCustomSymbols(prev => [...prev, sym]);
                                              }
                                              setDropdownSearch("");
                                              setActiveDropdown(null);
                                              setValue("type", cat.id);
                                            }}
                                            className={cn(
                                              "flex items-center justify-between p-3 rounded-xl text-sm font-black transition-all border bg-brand-text/5 border-brand-text/10 text-brand-text hover:text-brand-text hover:bg-brand-text/10",
                                              !hasActivePlan && "opacity-50 cursor-not-allowed"
                                            )}
                                          >
                                            <span>{sym}</span>
                                            {hasActivePlan ? <Plus size={10} className="opacity-100" /> : <Zap size={10} className="text-amber-400" />}
                                          </button>
                                        ))}
                                        {results.length === 0 && (
                                          <p className="text-xs text-brand-muted w-full text-center py-4 italic col-span-full">
                                            {lang === 'ar' ? 'لا توجد رموز إضافية مطابقة للبحث' : 'No additional matching symbols found'}
                                          </p>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              </>
                            ) : (
                              <div className="py-6 text-center text-sm text-brand-muted font-bold italic">
                                {lang === 'ar' ? 'اكتب للبحث عن رموز إضافية...' : 'Type to search for additional symbols...'}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="mt-8 pt-6 border-t border-white/5">
                           <button 
                             type="button"
                             onClick={() => setActiveDropdown(null)}
                             className="w-full py-3 bg-brand-text/5 hover:bg-brand-text/10 rounded-xl text-sm font-black text-brand-text transition-all uppercase tracking-widest"
                           >
                             {lang === 'ar' ? 'إغلاق القائمة' : 'Close Menu'}
                           </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 bg-brand-alt p-8 rounded-[3rem] border border-brand-text/10 shadow-2xl transition-all">
          <div className={cn("flex items-center justify-between border-b border-brand-text/10 pb-6", isRTL ? "flex-row-reverse" : "flex-row")}>
             <label className="text-base font-black text-brand-text opacity-100 uppercase tracking-[0.2em]">{t.selectSymbols}</label>
             {hasActivePlan ? (
             <div className="flex gap-3">
               <button 
                  type="button" 
                  onClick={selectAllInCategory}
                  className={cn(
                    "text-sm font-black px-4 py-2 rounded-full transition-all",
                    SYMBOL_GROUPS[selectedType]?.flatMap(g => g.symbols).every(s => selectedSymbols.includes(s))
                      ? "bg-emerald-400 text-black" 
                      : "bg-[#F59E0B] text-black hover:bg-[#d97706]"
                  )}
                >
                 {SYMBOL_GROUPS[selectedType]?.flatMap(g => g.symbols).every(s => selectedSymbols.includes(s))
                    ? t.unselectAll 
                    : t.selectAll}
               </button>
               <button 
                  type="button" 
                  onClick={clearAll}
                  className="text-sm font-black text-brand-text px-4 py-2 bg-brand-text/10 rounded-full hover:bg-brand-text/20 transition-colors"
                >
                 {t.clear}
               </button>
             </div>
             ) : (
               <span className="text-xs font-black text-amber-400 uppercase tracking-widest">
                 {lang === 'ar' ? `5/${FREE_SYMBOLS[selectedType]?.length || 5}` : `${selectedSymbols.filter(s => FREE_SYMBOLS[selectedType]?.includes(s)).length}/${FREE_SYMBOLS[selectedType]?.length || 5}`}
               </span>
             )}
          </div>

          <div className="space-y-6 pt-6 h-[400px] overflow-y-auto px-2 custom-scrollbar">
            {/* Symbol Groups & Browse */}
            <div className="space-y-8">
              {(!hasActivePlan ? (() => {
                const freeSyms = FREE_SYMBOLS[selectedType] || [];
                return [{ label: lang === 'ar' ? 'أشهر الرموز' : 'Popular Free', symbols: freeSyms }];
              })() : SYMBOL_GROUPS[selectedType])?.map((group, index, arr) => {
                let groupSymbols = hasActivePlan ? group.symbols.filter(sym => !hiddenSymbols.includes(sym)) : [...group.symbols];
                
                // Append custom symbols to the last group of the category (only for active plan)
                if (index === arr.length - 1 && hasActivePlan) {
                  const allGroupsSymbols = SYMBOL_GROUPS[selectedType]?.flatMap(g => g.symbols) || [];
                  const customForType = customSymbols.filter(s => 
                    (ALL_SYMBOLS_DB[selectedType] || []).includes(s) &&
                    !hiddenSymbols.includes(s) &&
                    !allGroupsSymbols.includes(s)
                  );
                  groupSymbols = [...groupSymbols, ...customForType];
                }

                if (groupSymbols.length === 0) return null;
                
                return (
                  <div key={group.label} className="space-y-3">
                    <h6 className="text-sm font-black text-brand-muted uppercase tracking-widest px-2">
                      {t[group.label as keyof typeof t] || group.label}
                    </h6>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                      {groupSymbols.map((sym) => (
                        <div key={sym} className="relative group">
                          <button
                            type="button"
                            onClick={() => toggleSymbol(sym)}
                              className={cn(
                                "w-full flex items-center justify-center p-3 rounded-xl text-sm font-black transition-all border",
                                selectedSymbols.includes(sym)
                                  ? "bg-emerald-400 border-emerald-500 text-black shadow-[0_5px_15px_rgba(16,185,129,0.2)]"
                                  : "bg-[#F59E0B] border-black/10 text-black hover:bg-[#d97706]"
                              )}
                          >
                            {sym}
                          </button>
                          {hasActivePlan && (
                          <button
                            type="button"
                            onClick={(e) => removeSymbol(sym, e)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-brand-text rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-600 shadow-md"
                          >
                            <X size={8} />
                          </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Global Symbol Search */}
            <div className="space-y-4 pt-8 border-t border-brand-text/10">
               <div className="relative">
                  <Search className={cn("absolute top-1/2 -translate-y-1/2 text-brand-muted", isRTL ? "right-4" : "left-4")} size={16} />
                  <input 
                    type="text"
                    placeholder={t.searchSymbol}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={cn(
                      "w-full bg-brand-text/5 border border-brand-text/10 rounded-2xl py-4 text-sm font-bold text-brand-text placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all",
                      isRTL ? "pr-12 pl-4" : "pl-12 pr-4"
                    )}
                  />
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm("")}
                      className={cn("absolute top-1/2 -translate-y-1/2 text-brand-text hover:text-brand-text", isRTL ? "left-4" : "right-4")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {searchTerm && (
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-black/20 rounded-2xl border border-white/5">
                    {(() => {
                      const results = ALL_SYMBOLS_DB[selectedType]
                        ?.filter(s => s.toLowerCase().includes(searchTerm.toLowerCase())) || [];

                      return (
                        <>
                          {results.slice(0, 50).map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              onClick={() => {
                                if (!hasActivePlan) { setShowUpgradeOverlay(true); return; }
                                setHiddenSymbols(prev => prev.filter(s => s !== sym));
                                if (!customSymbols.includes(sym)) {
                                  setCustomSymbols(prev => [...prev, sym]);
                                }
                                setSearchTerm("");
                              }}
                              className={cn(
                                "px-4 py-2 rounded-xl text-sm font-black border transition-all",
                                !hasActivePlan && "opacity-50 cursor-not-allowed",
                                selectedSymbols.includes(sym)
                                  ? "bg-emerald-400 border-emerald-500 text-black"
                                  : "bg-[#F59E0B] border-black/10 text-black hover:bg-[#d97706]"
                              )}
                            >
                              {sym}
                            </button>
                          ))}
                          {results.length === 0 && (
                            <p className="text-sm text-brand-muted w-full text-center py-2 italic">No matching symbols found</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                 )}
             </div>


            <div className="pt-8 border-t border-brand-text/10">
               <label className="text-sm font-black text-brand-text opacity-100 uppercase mb-3 block pl-2">{t.manualInput}</label>
               <input
                 {...register("symbol")}
                 dir="ltr"
                 placeholder="BTCUSD, SOLUSD, ETHUSD..."
                 disabled={!hasActivePlan}
                 className="w-full p-5 bg-black/40 border border-brand-text/10 rounded-2xl text-base font-mono focus:ring-4 ring-primary/20 focus:outline-none text-brand-text placeholder:text-brand-muted disabled:opacity-40 disabled:cursor-not-allowed"
               />
               {!hasActivePlan && (
                 <p className="text-[10px] text-amber-400 mt-2 font-bold">
                   {lang === 'ar' ? 'متاح فقط للمشتركين. اشترك لتحليل رموز إضافية.' : 'Available only for subscribers. Subscribe to analyze more symbols.'}
                 </p>
               )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <div className="space-y-4">
            <label className="text-base font-black text-brand-text opacity-100 uppercase tracking-widest pl-2">{t.tradingStyle}</label>
            <div className="grid grid-cols-1 gap-3">
              {(isDeveloperEmail(user?.email) ? TRADING_STYLES : TRADING_STYLES.filter(s => s.id === 'day_trading')).map((style) => {
                const isLocked = false;
                return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => {
                    if (isLocked) { setShowUpgradeOverlay(true); return; }
                    setValue("tradingStyle", style.id as TradingStyle);
                  }}
                  className={cn(
                    "flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-left",
                    selectedStyle === style.id 
                      ? "border-emerald-400 bg-emerald-100 text-black shadow-lg" 
                      : "border-black/10 bg-[#F59E0B] text-black hover:bg-[#d97706]",
                    isLocked && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <div className={cn("p-2 rounded-lg", selectedStyle === style.id ? "bg-emerald-500 text-white" : "bg-black/10 text-black")}>
                    {ICON_MAP[style.icon]}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base font-black uppercase text-black">{t[style.label as keyof typeof t]}</span>
                    <span className="text-sm text-black/70">
                      {style.id === 'swing_trading' ? (lang === 'ar' ? 'تركيز على الاتجاهات الكبرى (4س/يومي) - الأكثر أماناً' : 'Focus on major trends (H4/D1) - Safest') : ''}
                      {style.id === 'day_trading' ? (lang === 'ar' ? 'تحركات اليوم الحالي فقط' : 'Current day moves only') : ''}
                      {style.id === 'scalping' ? (lang === 'ar' ? 'تحركات لحظية سريعة جداً' : 'Very fast intraday moves') : ''}
                    </span>
                    {isLocked && (
                      <span className="text-[10px] text-amber-400 font-black uppercase tracking-widest">
                        {lang === 'ar' ? '🔒 مميز • اشترك' : '🔒 Premium • Subscribe'}
                      </span>
                    )}
                  </div>
                </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-base font-black text-brand-text opacity-100 uppercase tracking-widest pl-2">{t.timeframe}</label>
            <div className="grid grid-cols-3 gap-3">
              {TIMEFRAMES.map((tf) => {
                const isLocked = !hasActivePlan && tf.id !== '1d';
                return (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => {
                    if (isLocked) { setShowUpgradeOverlay(true); return; }
                    setValue("timeframe", tf.id);
                  }}
                  className={cn(
                    "p-5 rounded-2xl border-2 transition-all text-base font-black uppercase",
                    selectedTimeframe === tf.id 
                      ? "border-emerald-400 bg-emerald-100 text-black shadow-lg" 
                      : "border-black/10 bg-[#F59E0B] text-black hover:bg-[#d97706]",
                    isLocked && "opacity-30 cursor-not-allowed"
                  )}
                >
                  {tf.label}
                </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pt-4">
          <motion.button
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={analyzingIndex !== null}
            className="w-full h-20 bg-brand-text text-brand-bg rounded-[2rem] font-display font-black text-2xl flex items-center justify-center gap-4 shadow-2xl hover:bg-primary hover:text-brand-text transition-all group disabled:opacity-100"
          >
            {analyzingIndex !== null ? (
              <div className="flex items-center justify-center gap-4 w-full">
                <div className="w-6 h-6 border-4 border-brand-bg border-t-transparent rounded-full animate-spin" />
                <span>{t.analyzing}</span>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="px-5 py-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-black uppercase tracking-widest transition-all ml-4"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                <Zap size={28} className="fill-secondary text-secondary group-hover:fill-white group-hover:text-brand-text transition-colors" />
                <span>{t.startManualNow}</span>
              </>
            )}
          </motion.button>
        </div>

        {/* Upgrade Overlay */}
        <AnimatePresence>
          {showUpgradeOverlay && (() => {
            const subPrices = (() => { try { return JSON.parse(localStorage.getItem('subscription_prices') || '{}'); } catch { return {}; } })();
            const prices = { weekly: subPrices.weekly ?? 2, monthly: subPrices.monthly ?? 6, yearly: subPrices.yearly ?? 60 };
            const plans = [
              { key: 'weekly', label: lang === 'ar' ? 'أسبوعي' : 'Weekly', price: prices.weekly, desc: lang === 'ar' ? 'تحليل مؤسسي لمدة 7 أيام' : '7 days analysis', icon: 'Weekly', color: 'from-sky-500 to-sky-600', border: 'border-sky-500/30' },
              { key: 'monthly', label: lang === 'ar' ? 'شهري' : 'Monthly', price: prices.monthly, desc: lang === 'ar' ? 'وصول كامل للسوق' : 'Full market access', color: 'from-emerald-500 to-emerald-600', border: 'border-emerald-500/30', popular: true },
              { key: 'yearly', label: lang === 'ar' ? 'سنوي' : 'Yearly', price: prices.yearly, desc: lang === 'ar' ? 'أفضل قيمة + دعم VIP' : 'Best value + VIP', color: 'from-amber-500 to-orange-600', border: 'border-amber-500/30', best: true },
            ];
            return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowUpgradeOverlay(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                className="bg-brand-alt border border-white/10 rounded-[32px] p-6 md:p-8 max-w-lg w-full text-center space-y-6 shadow-[0_32px_128px_-12px_rgba(0,0,0,0.85)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shrink-0">
                      <Zap size={22} className="text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-lg font-black text-white">{lang === 'ar' ? 'ميزة مميزة' : 'Premium Feature'}</h3>
                      <p className="text-xs text-slate-400">{lang === 'ar' ? 'هذه الميزة متاحة فقط للمشتركين' : 'Available for subscribers only'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowUpgradeOverlay(false)}
                    className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {plans.map((plan) => (
                    <div
                      key={plan.key}
                      className={`relative bg-white/5 border ${plan.border} rounded-2xl p-4 flex flex-col items-center text-center transition-all hover:-translate-y-0.5 ${plan.popular ? 'ring-1 ring-emerald-500/40' : ''} ${plan.best ? 'ring-1 ring-amber-500/40' : ''}`}
                    >
                      {plan.popular && (
                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[8px] font-black uppercase tracking-widest px-3 py-0.5 rounded-full shadow-lg">Popular</div>
                      )}
                      {plan.best && (
                        <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[8px] font-black uppercase tracking-widest px-3 py-0.5 rounded-full shadow-lg">Best</div>
                      )}
                      <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-2 shadow-md`}>
                        {plan.key === 'weekly' ? <Sparkles size={14} className="text-white" /> : plan.key === 'monthly' ? <Star size={14} className="text-white" /> : <Crown size={14} className="text-white" />}
                      </div>
                      <h4 className="text-sm font-black text-white uppercase tracking-wider">{plan.label}</h4>
                      <p className="text-[9px] text-slate-500 mt-1 leading-tight">{plan.desc}</p>
                      <div className="mt-2">
                        <span className="text-xl font-black text-white">${Number(plan.price).toFixed(2)}</span>
                        <span className="text-[9px] text-slate-500 ml-0.5">/{plan.key === 'yearly' ? 'yr' : plan.key === 'monthly' ? 'mo' : 'wk'}</span>
                      </div>
                      {plan.popular && (
                        <span className="mt-2 text-[9px] text-emerald-400 font-black uppercase tracking-widest flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {lang === 'ar' ? 'للوصول الكامل' : 'Full Access'}
                        </span>
                      )}
                      {plan.best && (
                        <span className="mt-2 text-[9px] text-amber-400 font-black uppercase tracking-widest flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          {lang === 'ar' ? 'الوصول الكامل' : 'Full Access'}
                        </span>
                      )}
                      {plan.key === 'weekly' && (
                        <span className="mt-2 text-[9px] text-sky-400 font-black uppercase tracking-widest flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                          {lang === 'ar' ? 'جرب لمدة أسبوع' : 'Try for a week'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => { setShowUpgradeOverlay(false); onUpgrade(); }}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-black text-sm uppercase tracking-widest shadow-lg hover:opacity-90 transition-all active:scale-95"
                >
                  {lang === 'ar' ? 'اشترك الآن وتمتع بكامل الصلاحية' : 'Subscribe Now & Unlock All Features'}
                </button>
                <button
                  onClick={() => setShowUpgradeOverlay(false)}
                  className="text-xs text-slate-500 hover:text-white underline transition-colors"
                >
                  {lang === 'ar' ? 'لا شكراً، استمر مع الخطة المجانية' : 'No thanks, continue with free plan'}
                </button>
              </motion.div>
            </motion.div>
            );
          })()}
        </AnimatePresence>
      </form>
    </div>
  );
}

