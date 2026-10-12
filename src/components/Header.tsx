import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { TrendingUp, LogIn, LogOut, Moon, Sun, Globe, ArrowLeft, Menu, Zap, AlertTriangle, MessageCircle, Upload, Download, FileAudio, Bell, ExternalLink, Smartphone, Tablet, X, Settings, Key, DollarSign, Users, User as UserIcon, Crown, Info, Lightbulb, Monitor, CalendarDays, Store, BarChart3 } from 'lucide-react';
import { Language, translations } from '../lib/i18n';
import { AutoAnalysisSettings } from '../types';
import { initAudio } from '../lib/audioEngine';
import { BASE_URL } from '../lib/firebase';
import { SYMBOL_CATEGORIES, ALL_SYMBOLS_DB } from '../constants';
import { fetchUrgentNews } from '../services/urgentNews';

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

const PROGRESS_CATEGORY_CONFIG: Record<string, { emoji: string; labelAr: string; labelEn: string }> = {
  forex: { emoji: '\uD83D\uDCB1', labelAr: 'فوركس', labelEn: 'Forex' },
  crypto: { emoji: '\uD83E\uDDF1', labelAr: 'كريبتو', labelEn: 'Crypto' },
  stocks_us: { emoji: '\uD83C\uDDFA\uD83C\uDDF8', labelAr: 'أسهم أمريكا', labelEn: 'US Stocks' },
  stocks_eu: { emoji: '\uD83C\uDDEA\uD83C\uDDFA', labelAr: 'أسهم أوروبا', labelEn: 'EU Stocks' },
  stocks_jp: { emoji: '\uD83C\uDDEF\uD83C\uDDF5', labelAr: 'أسهم اليابان', labelEn: 'JP Stocks' },
  metals: { emoji: '\uD83D\uDC8E', labelAr: 'معادن', labelEn: 'Metals' },
};

function detectProgressCategory(symbol: string): { key: string; cfg?: typeof PROGRESS_CATEGORY_CONFIG[string] } {
  const sym = (symbol || '').toUpperCase().replace(/[-_=]/g, '');
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(sym)) return { key: cat, cfg: PROGRESS_CATEGORY_CONFIG[cat] };
  }
  for (const [cat, syms] of Object.entries(ALL_SYMBOLS_DB)) {
    if ((syms as string[]).includes(sym)) return { key: cat, cfg: PROGRESS_CATEGORY_CONFIG[cat] };
  }
  const s = symbol.toUpperCase();
  if (/XAU|XAG|GOLD|SILVER/.test(s)) return { key: 'metals', cfg: PROGRESS_CATEGORY_CONFIG.metals };
  if (/BTC|ETH|BNB|SOL|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|UNI|SHIB|LTC|ATOM/.test(s)) return { key: 'crypto', cfg: PROGRESS_CATEGORY_CONFIG.crypto };
  if (/EUR|GBP|JPY|CHF|CAD|AUD|NZD|USD/.test(s)) return { key: 'forex', cfg: PROGRESS_CATEGORY_CONFIG.forex };
  if (/\.(T)$/.test(symbol)) return { key: 'stocks_jp', cfg: PROGRESS_CATEGORY_CONFIG.stocks_jp };
  if (/\.(AS|PA|DE|L|SW|CO)$/.test(symbol)) return { key: 'stocks_eu', cfg: PROGRESS_CATEGORY_CONFIG.stocks_eu };
  return { key: 'stocks_us', cfg: PROGRESS_CATEGORY_CONFIG.stocks_us };
}

interface HeaderProps {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  isDark: boolean;
  toggleTheme: () => void;
  lang: Language;
  onLangChange: (l: Language) => void;
  showBack?: boolean;
  onBack?: () => void;
  autoSettings: AutoAnalysisSettings;
  onAutoSettingsChange: (s: AutoAnalysisSettings) => void;
  isWaiting?: boolean;
  hasApiKey: boolean;
  onToggleSidebar: () => void;
  isSidebarOpen?: boolean;
  isDeveloper?: boolean;
  lastSyncStatus?: { ok: boolean; count?: number; error?: string; time: number } | null;
  analysisProgress?: { current: string; total: number; index: number; failed?: number; exchange?: string } | null;
  isAnalyzing?: boolean;
  newSuggestionsCount?: number;
  onNavigateSuggestions?: () => void;
  paymentRequestsCount?: number;
  onNavigatePaymentRequests?: () => void;
  clientRadarRunning?: boolean;
  showRadarComplete?: boolean;
  onPreview?: (device: 'phone' | 'tablet') => void;
  isPWA?: boolean;
  onNavigatePage?: (page: 'settings' | 'apiKey' | 'plans' | 'radar' | 'paymentSettings' | 'clientMonitor' | 'profile' | 'about' | 'suggestions' | 'ads' | 'siteStats' | 'trade' | 'manualAnalysis' | 'store' | 'storeSettings' | 'prices' | 'transactions') => void;
  freemiumDisabled?: boolean;
  storeVisited?: boolean;
  compact?: boolean;
  planClient?: boolean;
  hasActivePlan?: boolean;
  isPaidMode?: boolean;
  onActivatePaidPlan?: () => void;
  onReturnToFreePlan?: () => void;
  onOpenMyPlan?: () => void;
  onStartClientAutoAnalysis?: () => void;
}

const LANGUAGES: { code: Language, label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export default function Header({ 
  user, 
  onLogin, 
  onLogout, 
  isDark, 
  toggleTheme, 
  lang, 
  onLangChange, 
  showBack, 
  onBack,
  autoSettings,
  onAutoSettingsChange,
  isWaiting,
  hasApiKey,
  onToggleSidebar,
  isDeveloper = false,
  lastSyncStatus = null,
  analysisProgress = null,
  isAnalyzing = false,
  newSuggestionsCount = 0,
  onNavigateSuggestions,
  paymentRequestsCount = 0,
  onNavigatePaymentRequests,
  clientRadarRunning = false,
  showRadarComplete = false,
  onPreview,
  isPWA: isPWAMode = false,
  onNavigatePage,
  freemiumDisabled = false,
  storeVisited = false,
  compact = false,
  planClient = false,
  hasActivePlan = false,
  isPaidMode = false,
  onActivatePaidPlan,
  onReturnToFreePlan,
  onOpenMyPlan,
  onStartClientAutoAnalysis,
}: HeaderProps) {
  const t = translations[lang];
  const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

  // Reflect the Automatic-Trading (paper auto-open) state on the Trade button.
  // The toggle lives in TradeNowPage and persists to localStorage under
  // 'paper_trading_auto_trade'. We read it here and keep it in sync via the
  // cross-tab `storage` event plus a light poll, so the header flips the instant
  // the user toggles auto-trading on the Trade page (or in another tab).
  const [autoTradeActive, setAutoTradeActive] = useState<boolean>(() => {
    // Default ON: auto-trading is enabled unless the user explicitly turned it off
    // ('0'). A brand-new user (no stored key) therefore starts with auto-trade ON.
    try { return localStorage.getItem('paper_trading_auto_trade') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    const read = () => { try { setAutoTradeActive(localStorage.getItem('paper_trading_auto_trade') !== '0'); } catch { setAutoTradeActive(true); } };
    read();
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key === 'paper_trading_auto_trade') read(); };
    window.addEventListener('storage', onStorage);
    // Light poll as a safety net for same-tab updates that don't fire `storage`.
    const iv = window.setInterval(read, 1000);
    return () => { window.removeEventListener('storage', onStorage); window.clearInterval(iv); };
  }, []);

  // Live scanning only counts when auto-analysis is actually enabled. This makes
  // the top button flip to OFF the instant the developer toggles it, instead of
  // staying frozen on the last SYNCED/progress state until a scan finishes.
  const liveAnalysisActive = !!(analysisProgress && autoSettings.isEnabled);

  const TIMEFRAME_LABELS: Record<string, { ar: string; en: string }> = {
    '15m': { ar: '15 دقيقة', en: '15min' },
    '1h':  { ar: 'ساعة',     en: '1hr' },
    '4h':  { ar: '4 ساعات',  en: '4hr' },
    '1d':  { ar: 'يومي',     en: 'Daily' },
    '1w':  { ar: 'أسبوعي',   en: 'Weekly' },
    '1M':  { ar: 'شهري',     en: 'Monthly' },
    '1Y':  { ar: 'سنوي',     en: 'Yearly' },
  };
  const tfLabel = TIMEFRAME_LABELS[autoSettings.timeframe] || { ar: autoSettings.timeframe, en: autoSettings.timeframe };

  const ANALYSIS_LABELS: Record<string, { ar: string; en: string }> = {
    '15m': { ar: 'التحليل الربع ساعي', en: '15-Min Analysis' },
    '1h':  { ar: 'التحليل الساعي',     en: 'Hourly Analysis' },
    '4h':  { ar: 'التحليل الربعاوي',   en: '4-Hour Analysis' },
    '1d':  { ar: 'التحليل اليومي',     en: 'Daily Analysis' },
    '1w':  { ar: 'التحليل الأسبوعي',   en: 'Weekly Analysis' },
    '1M':  { ar: 'التحليل الشهري',     en: 'Monthly Analysis' },
    '1Y':  { ar: 'التحليل السنوي',     en: 'Yearly Analysis' },
  };
  const analysisLabel = ANALYSIS_LABELS[autoSettings.timeframe] || tfLabel;

  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [newsFlash, setNewsFlash] = useState(false);

  useEffect(() => {
    if (isDeveloper) return;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const seen = new Set<string>();
    let initialized = false;
    const check = async () => {
      const items = await fetchUrgentNews();
      if (!initialized) { items.forEach((i) => seen.add(i.title)); initialized = true; return; }
      const fresh = items.filter((i) => !seen.has(i.title));
      fresh.forEach((i) => seen.add(i.title));
      if (fresh.length > 0) {
        setNewsFlash(true);
        if (stopTimer) clearTimeout(stopTimer);
        stopTimer = setTimeout(() => setNewsFlash(false), 60000);
      }
    };
    check();
    const id = setInterval(check, 60000);
    return () => { clearInterval(id); if (stopTimer) clearTimeout(stopTimer); };
  }, [lang, isDeveloper]);
  const isPWA = isPWAMode;
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mobileLangOpen, setMobileLangOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const langButtonRef = useRef<HTMLButtonElement>(null);
  const [langMenuPos, setLangMenuPos] = useState<{top: number; left: number} | null>(null);

  useEffect(() => {
    setCustomAvatar(localStorage.getItem('finalyze_custom_avatar'));
    setCustomLogo(localStorage.getItem('finalyze_custom_logo'));
    const handleStorage = () => {
      setCustomAvatar(localStorage.getItem('finalyze_custom_avatar'));
      setCustomLogo(localStorage.getItem('finalyze_custom_logo'));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      setTimeout(() => {
        if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node) && !profileButtonRef.current?.contains(e.target as Node)) {
          setShowProfileMenu(false);
        }
        if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node) && !langButtonRef.current?.contains(e.target as Node)) {
          setShowLangMenu(false);
        }
      }, 0);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isMarketClosedToday = () => {
    const day = new Date().getUTCDay();
    return day === 0 || day === 6;
  };

  return (
    <div className="flex flex-col">
      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100]" onClick={() => setShowLogoutConfirm(false)}>
          <div className={`absolute top-[60px] w-64 bg-brand-alt border border-brand-text/10 rounded-xl shadow-2xl overflow-hidden z-[100] ${lang === 'ar' ? 'left-4' : 'right-4'}`} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-sm font-black text-white">{lang === 'ar' ? 'تسجيل الخروج' : 'Logout'}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-white/60 mb-3">{lang === 'ar' ? 'هل أنت متأكد؟' : 'Are you sure?'}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-white/20 text-white/60 text-xs font-bold hover:bg-white/10 transition-colors"
                >
                  {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  onClick={() => { setShowLogoutConfirm(false); onLogout(); }}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors"
                >
                  {lang === 'ar' ? 'خروج' : 'Logout'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Overlay - phones (both PWA standalone and normal browser) */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-[80]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileMenu(false)} />
          <div className="absolute top-0 left-0 bottom-0 w-[85%] max-w-[340px] bg-[#D1FAE5] shadow-2xl overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between px-4 py-4 border-b border-black/10">
              <span className="text-sm font-black text-black uppercase tracking-wider">
                {lang === 'ar' ? 'القائمة' : 'Menu'}
              </span>
              <button
                onClick={() => setShowMobileMenu(false)}
                className="p-2 rounded-lg bg-black/5 hover:bg-black/10 transition-colors"
              >
                <X size={18} className="text-black" />
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              {/* Radar Status - Client */}
              {!isDeveloper && (<>
                <div className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl border-2 shadow-lg transition-all",
                  clientRadarRunning
                    ? 'bg-red-600 border-red-700 text-white shadow-red-500/50 animate-pulse'
                    : showRadarComplete
                      ? 'bg-emerald-600 border-emerald-700 text-white shadow-emerald-500/50'
                      : 'bg-emerald-500/20 border-emerald-500/40'
                )}>
                  <div className="relative">
                    <Zap size={24} className={clientRadarRunning || showRadarComplete ? 'text-white' : 'text-emerald-400'} fill="currentColor" />
                    {clientRadarRunning && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full animate-ping shadow-[0_0_16px_white]" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] leading-none">
                      {lang === 'ar' ? 'التحليل التلقائي' : 'Auto Analysis'}
                    </span>
                    <span className={cn(
                      "text-[12px] font-black uppercase tracking-wider leading-tight",
                      clientRadarRunning || showRadarComplete ? 'text-white' : 'text-emerald-400'
                    )}>
                      {clientRadarRunning
                        ? (lang === 'ar' ? '⏳ انتظار...' : '⏳ Waiting...')
                        : showRadarComplete
                          ? (lang === 'ar' ? '✅ تم' : '✅ Done')
                          : (lang === 'ar' ? 'نشط' : 'Active')
                      }
                    </span>
                  </div>
                </div>
              </>)}

              {/* Auto Analysis Toggle - Developer */}
              {isDeveloper && (<>
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/20 bg-white/10 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Zap size={18} className={autoSettings.isEnabled ? 'text-emerald-400' : 'text-black/50'} fill={autoSettings.isEnabled ? "currentColor" : "none"} />
                    <span className="text-xs font-black text-black uppercase">
                      {lang === 'ar' ? 'التحليل التلقائي' : 'Auto Analysis'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      initAudio();
                      onAutoSettingsChange({ ...autoSettings, isEnabled: !autoSettings.isEnabled });
                    }}
                    className={cn(
                      "relative w-12 h-6 rounded-full transition-all",
                      autoSettings.isEnabled
                        ? (isWaiting ? 'bg-yellow-500' : 'bg-emerald-500')
                        : 'bg-black/20'
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all",
                      autoSettings.isEnabled ? 'left-6' : 'left-0.5'
                    )} />
                  </button>
                </div>
              </>)}

              {/* Analysis Progress - Developer */}
              {isDeveloper && analysisProgress && (
                <div className="px-4 py-3 rounded-xl border border-blue-500/50 bg-blue-500/15 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-black text-black uppercase">
                      {lang === 'ar' ? 'جاري التحليل' : 'Analyzing'} {analysisProgress.index + 1}/{analysisProgress.total}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-black/70 mt-1 block truncate">{analysisProgress.current}</span>
                </div>
              )}

              {/* Divider: Navigation */}
              <div className="border-t border-black/10 pt-2">
                <span className="text-[9px] font-black uppercase text-black/40 tracking-[0.2em] px-2">
                  {lang === 'ar' ? 'التنقل' : 'Navigation'}
                </span>
              </div>

              {/* Sidebar Navigation Items */}
              {/* Trade - always accessible on mobile */}
              <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('trade'); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                <TrendingUp size={20} className="text-black" strokeWidth={2.75} />
                <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'التداول' : 'Trade'}</span>
              </button>
              <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('prices'); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all shadow-md">
                <BarChart3 size={20} className="text-black" strokeWidth={2.75} />
                <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'الأسعار الحية' : 'Live Prices'}</span>
              </button>
              {isDeveloper ? (
                <>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('radar'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <Zap size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'إعدادات التحليل التلقائي' : 'Auto Analysis Settings'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('manualAnalysis'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-400 active:scale-[0.98] transition-all shadow-md">
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'التحليل اليدوي' : 'Manual Analysis'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('apiKey'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <Key size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'مفتاح API' : 'API Key'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('profile'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <UserIcon size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'الملف الشخصي' : 'Profile'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('settings'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <Settings size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'الإعدادات' : 'Settings'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('storeSettings'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] transition-all shadow-md">
                    <Store size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'إعدادات المتجر' : 'Store Settings'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('store'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] transition-all shadow-md">
                    <Store size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'عرض المتجر (اختبار)' : 'View Store (test)'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('clientMonitor'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <Users size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'مراقبة العملاء' : 'Client Monitor'}</span>
                  </button>
                  {/* Suggestions - Developer */}
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('suggestions'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <div className="relative">
                      <Bell size={20} className="text-black" strokeWidth={2.75} />
                      {newSuggestionsCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-lg">
                          {newSuggestionsCount}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'المقترحات' : 'Suggestions'}</span>
                    {newSuggestionsCount > 0 && (
                      <span className="mr-auto text-[10px] font-black text-black bg-black/15 px-2 py-0.5 rounded-full">
                        {newSuggestionsCount} {lang === 'ar' ? 'جديد' : 'new'}
                      </span>
                    )}
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('ads'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 active:scale-[0.98] transition-all shadow-md">
                    <Monitor size={20} className="text-white" strokeWidth={2.75} />
                    <span className="text-xs font-black text-white uppercase">{lang === 'ar' ? 'إعلاناتي' : 'My Ads'}</span>
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('profile'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                    <UserIcon size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'الملف الشخصي' : 'Profile'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('about'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] transition-all shadow-md">
                    <Info size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'نبذة عنا' : 'About Us'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('suggestions'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 active:scale-[0.98] transition-all shadow-md">
                    <Lightbulb size={20} className="text-white" strokeWidth={2.75} />
                    <span className="text-xs font-black text-white uppercase">{lang === 'ar' ? 'اقتراحاتكم' : 'Your Suggestions'}</span>
                  </button>
                  <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('store'); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.98] transition-all shadow-md">
                    <Store size={20} className="text-black" strokeWidth={2.75} />
                    <span className="text-xs font-black text-black uppercase">{lang === 'ar' ? 'متجر البوتات' : 'Bots Store'}</span>
                  </button>
                  {hasActivePlan && (
                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        if (isPaidMode) onReturnToFreePlan?.();
                        else onActivatePaidPlan?.();
                      }}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl border border-black/10 transition-all shadow-sm",
                        isPaidMode
                          ? "bg-white text-black hover:bg-slate-100"
                          : "bg-[#22c55e] hover:bg-[#16a34a] text-black font-black shadow-emerald-500/30"
                      )}
                    >
                      {isPaidMode ? (
                        <>
                          <Store size={18} className="text-black" />
                          <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">
                            {lang === 'ar' ? 'الخطة المجانية' : 'Free Plan'}
                          </span>
                        </>
                      ) : (
                        <>
                          <Crown size={18} className="text-black" />
                          <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">
                            {lang === 'ar' ? 'خطتي' : 'My Plan'}
                          </span>
                        </>
                      )}
                    </button>
                  )}
{planClient && (
                    <>
                      <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('radar'); }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] transition-all shadow-md">
                        <Zap size={20} className="text-black" strokeWidth={2.75} />
                        <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'إعدادات التحليل التلقائي' : 'Auto Analysis Settings'}</span>
                      </button>
                      <button onClick={() => { setShowMobileMenu(false); onNavigatePage?.('manualAnalysis'); }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-400 active:scale-[0.98] transition-all shadow-md">
                        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        <span className="text-xs font-black text-black uppercase min-w-0 leading-snug">{lang === 'ar' ? 'التحليل اليدوي' : 'Manual Analysis'}</span>
                      </button>
                    </>
                  )}
                </>
              )}

              {/* Divider: Tools */}
              <div className="border-t border-black/10 pt-2">
                <span className="text-[9px] font-black uppercase text-black/40 tracking-[0.2em] px-2">
                  {lang === 'ar' ? 'الأدوات' : 'Tools'}
                </span>
              </div>

              {/* Contact */}
              <a
                href="https://www.facebook.com/messages/e2ee/t/7630276620403742/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0084FF] hover:bg-[#3399FF] active:scale-[0.98] transition-all shadow-md"
              >
                <MessageCircle size={20} className="text-white" strokeWidth={2.75} />
                <span className="text-xs font-black text-white uppercase">
                  {lang === 'ar' ? 'تواصل معنا' : 'Contact Us'}
                </span>
              </a>

              {/* Theme */}
              <button
                onClick={toggleTheme}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 transition-all shadow-sm"
              >
                <div className="w-8 h-8 rounded-lg bg-[#F59E0B] flex items-center justify-center shadow-md">
                  {isDark ? <Sun size={16} className="text-black" /> : <Moon size={16} className="text-black" />}
                </div>
                <span className="text-xs font-black text-black uppercase">
                  {lang === 'ar' ? 'المظهر' : 'Theme'}
                </span>
                <span className="mr-auto text-[10px] font-bold text-black/50">
                  {isDark ? '☀️' : '🌙'}
                </span>
              </button>

              {/* Language */}
              <div className="rounded-xl border border-white/20 bg-white/10 overflow-hidden">
                <button
                  onClick={() => setMobileLangOpen(!mobileLangOpen)}
                  className="flex items-center gap-3 px-4 py-3 w-full hover:bg-white/10 transition-all"
                >
                  <Globe size={18} className="text-black" />
                  <span className="text-xs font-black text-black uppercase">
                    {lang === 'ar' ? 'اللغة' : 'Language'}
                  </span>
                  <span className="mr-auto text-[10px] font-bold text-[#F59E0B] uppercase bg-[#F59E0B]/20 px-2 py-0.5 rounded-full">
                    {lang.toUpperCase()}
                  </span>
                </button>
                {mobileLangOpen && (
                  <div className="border-t border-white/10">
                    {LANGUAGES.map((l) => (
                      <button
                        key={l.code}
                        onClick={() => { onLangChange(l.code); setMobileLangOpen(false); }}
                        className={cn(
                          "w-full px-4 py-2.5 text-left text-xs font-bold transition-colors hover:bg-white/10",
                          lang === l.code ? "text-[#F59E0B] bg-[#F59E0B]/10" : "text-black/60"
                        )}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview - Developer */}
              {isDeveloper && onPreview && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/20 bg-white/10">
                  <span className="text-xs font-black text-black uppercase">
                    {lang === 'ar' ? 'معاينة' : 'Preview'}
                  </span>
                  <div className="flex gap-1 ml-auto">
                    <button
                      onClick={() => { onPreview('phone'); setShowMobileMenu(false); }}
                      className="p-2 rounded-lg bg-[#F59E0B] border border-black/10 text-black hover:bg-[#d97706] transition-all shadow-md"
                    >
                      <Smartphone size={16} />
                    </button>
                    <button
                      onClick={() => { onPreview('tablet'); setShowMobileMenu(false); }}
                      className="p-2 rounded-lg bg-[#F59E0B] border border-black/10 text-black hover:bg-[#d97706] transition-all shadow-md"
                    >
                      <Tablet size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Divider: Account */}
              <div className="border-t border-black/10 pt-2">
                <span className="text-[9px] font-black uppercase text-black/40 tracking-[0.2em] px-2">
                  {lang === 'ar' ? 'الحساب' : 'Account'}
                </span>
              </div>

              {/* Profile / Login */}
              {user ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/20 bg-white/10">
                  <div className="w-10 h-10 rounded-full bg-[#F59E0B] border-2 border-black/20 flex items-center justify-center overflow-hidden shadow-lg">
                    {customAvatar ? (
                      <img src={customAvatar} alt="profile" className="w-full h-full object-cover" />
                    ) : user.photoURL ? (
                      <img src={user.photoURL} alt="profile" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-black/10 flex items-center justify-center text-black">
                        <span className="text-sm font-black">{user.email?.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-xs font-black text-black truncate">{user.displayName || user.email?.split('@')[0]}</span>
                    <span className="text-[10px] font-bold text-black/60 truncate">{user.email}</span>
                  </div>
                  <button
                    onClick={() => { setShowMobileMenu(false); setShowLogoutConfirm(true); }}
                    className="p-2 rounded-lg bg-red-500/20 text-red-600 hover:bg-red-500/40 transition-all"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowMobileMenu(false); onLogin(); }}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#F59E0B] text-black font-black text-sm uppercase tracking-wider shadow-lg hover:bg-[#d97706] active:scale-95 transition-all"
                >
                  <LogIn size={18} />
                  {t.login}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Market Status Banner */}
      {isMarketClosedToday() && (
        <div className="bg-red-600 text-white text-[10px] font-black uppercase tracking-[0.3em] py-1.5 flex items-center justify-center gap-2 px-4 text-center">
          <AlertTriangle size={12} className="animate-pulse" />
          {lang === 'ar' ? '⚠️ تنبيه: الأسواق العالمية (فوركس/أسهم) مغلقة اليوم - الرادار يعمل على العملات الرقمية فقط' : '⚠️ ALERT: GLOBAL MARKETS (FOREX/STOCKS) ARE CLOSED TODAY - RADAR ACTIVE ON CRYPTO ONLY'}
          <AlertTriangle size={12} className="animate-pulse" />
        </div>
      )}

      <header className={cn(
        "fixed top-0 left-0 right-0 z-50 shadow-2xl shadow-emerald-500/20 transition-all duration-300",
        compact ? 'h-[104px] md:h-[132px]' : 'h-[104px] md:h-[300px]'
      )}>
        {/* Trading Banner Background */}
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="/trading-banner.png"
            alt="Joseph.Trading"
            className={cn(
              "w-full h-full object-cover transition-all duration-300",
              compact ? 'object-[center_30%] opacity-60' : 'object-[center_50%]'
            )}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).parentElement!.classList.add('bg-gradient-to-r', 'from-emerald-600', 'via-emerald-500', 'to-emerald-600');
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-black/60" />
        </div>

        {/* Content Overlay - top row: logo left, icons right | MOBILE: icons wrap below logo via flex-wrap, desktop unchanged via md: */}
        <div className={cn(
          "relative w-full h-full flex flex-wrap items-start transition-all duration-300",
          compact ? 'pt-2' : 'pt-3'
        )}>
          <div className="flex flex-wrap md:flex-nowrap items-center gap-3 w-full">
            {/* Logo + Name - far left | MOBILE: full-width header row with hamburger top-right */}
            <div className="flex items-center gap-3 flex-shrink-0 w-full md:w-auto justify-between md:justify-start">
              <div className={cn(
                "bg-black rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl border-2 border-white/30 transition-all duration-300",
                compact ? 'w-[56px] h-[56px]' : 'w-[80px] h-[80px]'
              )}>
                <img src={customLogo || `${BASE_URL}logo.png`} alt="JT" className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col">
                <span className={cn(
                  "font-display font-black tracking-tight text-white drop-shadow-2xl leading-none transition-all duration-300",
                  compact ? 'text-lg' : 'text-3xl'
                )}>
                  Joseph.<span className="text-sky-300 italic">Trading</span>
                </span>
                {!compact && (
                  <span className="text-[14px] font-black uppercase tracking-[0.15em] text-white/70 leading-tight mt-1 block">For Financial<br/>Market Analysis</span>
                )}
              </div>
              {/* Mobile hamburger — stays top-right on phones, hidden on desktop (desktop uses icon-row menu) */}
              <button
                onClick={() => setShowMobileMenu(true)}
                className="flex md:hidden p-3 rounded-xl bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md flex-shrink-0"
                title={lang === 'ar' ? 'القائمة' : 'Menu'}
              >
                <Menu size={22} />
              </button>
            </div>

            {/* Icons - desktop only | MOBILE: all icons moved into sidebar menu */}
            {!isPWA && (
            <div className="hidden md:flex items-center gap-3 flex-1 min-w-0 justify-end">
              {/* Live Prices | client only, sits right before the store icon with the same gap as every other top-bar icon. Flashes for one minute when urgent market news appears. */}
              {!isDeveloper && (
                <button
                  onClick={() => onNavigatePage?.('prices')}
                  className={cn(
                    "tog-btn hidden md:flex items-center gap-2 px-5 py-3 rounded-2xl bg-[#3E2723] hover:bg-[#4E342E] shadow-lg shadow-black/30 active:scale-95 transition-all border border-black/10 flex-shrink-0",
                    newsFlash && "animate-flash-fast"
                  )}
                  title={lang === 'ar' ? 'الأسعار الحية' : 'Live Prices'}
                >
                  <BarChart3 size={24} className="flex-shrink-0" />
                  <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                    {lang === 'ar' ? 'الأسعار الحية' : 'Live Prices'}
                  </span>
                </button>
              )}
              {/* Store + My Plan | client — Store back in its previous spot (directly left of the Trade icon). When a paid plan is active, the My Plan icon sits DIRECTLY BENEATH the Store icon (vertical stack). */}
              {!isDeveloper && (
                <div className="hidden md:flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => onNavigatePage?.('store')}
                    className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white shadow-lg shadow-sky-500/30 active:scale-95 transition-all border border-black/10 flex-shrink-0"
                    title={lang === 'ar' ? 'متجر البوتات' : 'Bots Store'}
                  >
                    <Store size={24} className="flex-shrink-0" />
                    <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                      {lang === 'ar' ? 'المتجر' : 'Store'}
                    </span>
                    <span className={cn("px-2 py-0.5 rounded-lg bg-white text-sky-600 text-xs font-black uppercase tracking-wider whitespace-nowrap leading-none", !storeVisited && 'animate-flash-fast')}>
                      {lang === 'ar' ? 'مجاني' : 'Free'}
                    </span>
                  </button>
                  {hasActivePlan && (
                    <button
                      onClick={isPaidMode ? onReturnToFreePlan : onActivatePaidPlan}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider shadow-md active:scale-95 transition-all border border-black/10 flex-shrink-0",
                        isPaidMode
                          ? "bg-white text-black hover:bg-slate-100 shadow-white/20"
                          : "bg-[#22c55e] hover:bg-[#16a34a] text-black shadow-emerald-500/30 font-black"
                      )}
                      title={
                        isPaidMode
                          ? (lang === 'ar' ? 'الرجوع إلى الخطة المجانية' : 'Switch to Free Plan')
                          : (lang === 'ar' ? 'فتح خطتي المدفوعة' : 'Open My Paid Plan')
                      }
                    >
                      {isPaidMode ? (
                        <>
                          <Store size={15} className="text-black flex-shrink-0" />
                          <span className="leading-none">{lang === 'ar' ? 'الخطة المجانية' : 'Free Plan'}</span>
                        </>
                      ) : (
                        <>
                          <Crown size={15} className="text-black flex-shrink-0" />
                          <span className="leading-none">{lang === 'ar' ? 'خطتي' : 'My Plan'}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Trade Now | MOBILE: moved to sidebar (hidden md:flex) */}
              <button
                onClick={() => onNavigatePage?.('trade')}
                className={cn(
                  "hidden md:flex items-center gap-2 px-5 py-3 rounded-2xl active:scale-95 transition-all border flex-shrink-0",
                  autoTradeActive
                    ? "bg-[#065f46] hover:bg-[#047857] text-[#ECFDF5] border-[#34D399]/60 shadow-lg shadow-[#10B981]/40"
                    : "bg-[#F59E0B] hover:bg-[#d97706] text-black border-black/10 shadow-lg shadow-[#F59E0B]/30"
                )}
              >
                {autoTradeActive ? (
                  <Zap size={24} className="flex-shrink-0 animate-pulse" />
                ) : (
                  <TrendingUp size={24} className="flex-shrink-0" />
                )}
                <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                  {autoTradeActive
                    ? (lang === 'ar' ? 'تداول تلقائي' : 'Auto Trade')
                    : (lang === 'ar' ? 'تداول' : 'Trade')}
                </span>
              </button>

              {/* Suggestions - developer only | MOBILE: moved to sidebar */}
              {isDeveloper && (
                <button
                  onClick={onNavigateSuggestions}
                  className="hidden md:flex relative p-3 rounded-xl bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md flex-shrink-0"
                >
                  <Bell size={22} />
                  {newSuggestionsCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                      {newSuggestionsCount}
                    </span>
                  )}
                </button>
              )}

              {/* Payment notifications - developer only → opens Transactions page */}
              {isDeveloper && (
                <button
                  onClick={() => onNavigatePage?.('transactions')}
                  title={lang === 'ar' ? 'الطلبات والمعاملات' : 'Requests & transactions'}
                  className="hidden md:flex relative p-3 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 transition-all shadow-md flex-shrink-0"
                >
                  <Bell size={22} />
                  {paymentRequestsCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
                      {paymentRequestsCount}
                    </span>
                  )}
                </button>
              )}

              {/* Contact | MOBILE: moved to sidebar (hidden md:flex) */}
              <a
                href="https://www.facebook.com/messages/e2ee/t/7630276620403742/"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex p-3 rounded-xl bg-[#0084FF] text-white hover:bg-[#006ADB] transition-all shadow-md flex-shrink-0"
              >
                <MessageCircle size={22} />
              </a>

              {/* Auto Analysis + Sync Status + Timeframe Indicator — same rich radar toggle for the developer AND any client with an active paid plan. Plan clients also get the plan action row under the market pills in ClientDashboard. */}
              {isDeveloper || planClient ? (
            <div className="flex-shrink-0">
            <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                initAudio();
                onAutoSettingsChange({ ...autoSettings, isEnabled: !autoSettings.isEnabled });
              }}
              className={cn(
                "flex items-center gap-2.5 px-5 py-3 rounded-2xl border shadow-md transition-all backdrop-blur-sm flex-shrink-0 active:scale-95",
                liveAnalysisActive
                  ? 'bg-emerald-600 border-emerald-700 text-white animate-pulse'
                  : autoSettings.isEnabled
                    ? 'bg-emerald-600 border-emerald-700 text-white'
                    : 'bg-red-700 border-red-800 text-white'
              )}
            >
                  <div className="relative flex-shrink-0">
                    {liveAnalysisActive ? (
                      <div className="w-[28px] h-[28px] rounded-full bg-white animate-bounce" />
                    ) : autoSettings.isEnabled && lastSyncStatus ? (
                      <span className="text-[24px] font-black leading-none">{lastSyncStatus.ok ? '✓' : '✗'}</span>
                    ) : (
                      <Zap size={24} fill={autoSettings.isEnabled ? "currentColor" : "none"} className="text-white" />
                    )}
                  </div>
                  <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                    {liveAnalysisActive
                      ? `${analysisProgress.index + 1}/${analysisProgress.total}`
                      : autoSettings.isEnabled && lastSyncStatus
                        ? (lastSyncStatus.ok ? 'SYNCED' : 'FAIL')
                        : autoSettings.isEnabled ? (isWaiting ? 'WAIT' : 'ON') : 'OFF'
                    }
                  </span>
                  {autoSettings.isEnabled && lastSyncStatus?.count !== undefined && (
                    <span className="text-[16px] font-black text-yellow-300 leading-none">{lastSyncStatus.count}</span>
                  )}
                  {liveAnalysisActive && (() => {
                    if (analysisProgress.exchange) {
                      return (
                        <span className="text-[16px] font-black text-yellow-300 whitespace-nowrap leading-none">
                          {analysisProgress.exchange}
                        </span>
                      );
                    }
                    const { cfg } = detectProgressCategory(analysisProgress.current);
                    return (
                      <span className="text-[16px] font-black text-yellow-300 whitespace-nowrap leading-none">
                        {cfg ? (lang === 'ar' ? `${cfg.emoji} ${cfg.labelAr}` : `${cfg.emoji} ${cfg.labelEn}`) : analysisProgress.current}
                      </span>
                    );
                  })()}
                </button>
                {!isPWA && isDeveloper && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50">
                    <div className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-[#002395] border border-[#001A6B] text-white shadow-md flex-shrink-0 whitespace-nowrap">
                      <CalendarDays size={24} className="flex-shrink-0" />
                      <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                        {lang === 'ar' ? analysisLabel.ar : analysisLabel.en}
                      </span>
                    </div>
                  </div>
                )}
                </div>
              </div>
              ) : (
            <div className="relative flex-shrink-0">
                <div className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-xl border shadow-md backdrop-blur-sm flex-shrink-0",
                  clientRadarRunning
                    ? 'bg-red-600 border-red-700 text-white animate-pulse'
                    : showRadarComplete
                      ? 'bg-emerald-600 border-emerald-700 text-white'
                      : 'bg-emerald-500/30 border-emerald-500/50 text-white'
                )}>
                  <Zap size={20} className="text-white" fill="currentColor" />
                  <span className="text-[16px] font-black uppercase tracking-wider">
                    {clientRadarRunning ? 'SCANNING' : showRadarComplete ? 'DONE' : 'ACTIVE'}
                  </span>
                </div>
                {!isPWA && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50">
                    <div className="flex items-center gap-2.5 px-5 py-3 rounded-2xl bg-[#002395] border border-[#001A6B] text-white shadow-md flex-shrink-0 whitespace-nowrap">
                      <CalendarDays size={24} className="flex-shrink-0" />
                      <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                        {lang === 'ar' ? analysisLabel.ar : analysisLabel.en}
                      </span>
                    </div>
                  </div>
                )}
            </div>
              )}

              {/* Manual Analysis - developer only | MOBILE: moved to sidebar */}
              {isDeveloper && (
                <button
                  onClick={() => onNavigatePage?.('manualAnalysis')}
                  className="hidden md:flex items-center gap-2 px-5 py-3 rounded-2xl border shadow-md transition-all backdrop-blur-sm bg-red-700 border-red-800 text-white hover:bg-red-600 active:scale-95 flex-shrink-0"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span className="text-[18px] font-black uppercase tracking-wider whitespace-nowrap leading-none">
                    {lang === 'ar' ? 'يدوي' : 'MANUAL'}
                  </span>
                </button>
              )}

              {/* Theme */}
              <button 
                onClick={toggleTheme}
                className="p-3 rounded-xl bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md flex-shrink-0"
              >
                {isDark ? <Sun size={22} /> : <Moon size={22} />}
              </button>

              {/* Language */}
              <div className="relative flex-shrink-0">
                <button 
                  ref={langButtonRef}
                  onClick={() => {
                    if (showLangMenu) { setShowLangMenu(false); return; }
                    const rect = langButtonRef.current?.getBoundingClientRect();
                    if (rect) {
                      setLangMenuPos({ top: rect.bottom + 8, left: lang === 'ar' ? rect.left : rect.right - 160 });
                    }
                    setShowLangMenu(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md"
                >
                  <Globe size={22} />
                  <span className="text-[14px] font-black uppercase">{lang}</span>
                </button>
                {showLangMenu && langMenuPos && (
                  <div ref={langMenuRef} className="fixed w-40 bg-brand-alt border border-brand-text/10 rounded-xl shadow-2xl z-[60] overflow-hidden" style={{ top: langMenuPos.top, left: langMenuPos.left }}>
                    {LANGUAGES.map((l) => (
                      <button
                        key={l.code}
                        onClick={() => { onLangChange(l.code); setShowLangMenu(false); }}
                        className={cn(
                          "w-full px-4 py-3 text-left text-sm font-bold transition-colors hover:bg-primary/10",
                          lang === l.code ? "text-primary bg-primary/5" : "text-brand-text/60"
                        )}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Profile / Logout | MOBILE: moved to sidebar (hidden md:flex) */}
              {user ? (
                <div className="relative flex-shrink-0 hidden md:flex" ref={profileMenuRef}>
                  <button 
                    ref={profileButtonRef}
                    onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                    className="w-[48px] h-[48px] rounded-full bg-[#F59E0B] border-2 border-white/30 flex items-center justify-center overflow-hidden shadow-lg hover:scale-105 transition-all"
                  >
                    {customAvatar ? (
                      <img src={customAvatar} alt="profile" className="w-full h-full object-cover" />
                    ) : user.photoURL ? (
                      <img src={user.photoURL} alt="profile" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-sm font-black text-black">{user.email?.charAt(0).toUpperCase()}</span>
                    )}
                  </button>
                </div>
              ) : (
                <button 
                  onClick={onLogin}
                  className="hidden md:flex items-center gap-1.5 bg-[#F59E0B] text-black px-4 py-2.5 rounded-xl font-black text-sm uppercase shadow-md hover:bg-[#d97706] active:scale-95 transition-all flex-shrink-0"
                >
                  <LogIn size={22} />
                </button>
              )}

              {/* Menu toggle — desktop only (mobile uses top-row hamburger) */}
              {!isPWA && (
                <button
                  onMouseDown={(e) => { e.stopPropagation(); onToggleSidebar(); }}
                  className="hidden md:flex p-3 rounded-xl bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md flex-shrink-0 items-center justify-center"
                  title={lang === 'ar' ? 'القائمة' : 'Menu'}
                >
                  <Menu size={24} />
                </button>
              )}
            </div>
            )}

            {/* PWA: hamburger only — desktop only (mobile uses top-row hamburger) */}
            {isPWA && (
              <button
                onClick={() => setShowMobileMenu(true)}
                className="hidden md:flex p-2 rounded-lg bg-[#F59E0B] text-black hover:bg-[#d97706] transition-all shadow-md flex-shrink-0 items-center justify-center"
              >
                <Menu size={22} />
              </button>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}
