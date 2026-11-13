import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, CheckCircle, Loader2, AlertTriangle, Zap, Lock } from 'lucide-react';
import { Language } from '../lib/i18n';
import {
  TRADING_CATEGORIES,
  TRADING_VALUES_STORAGE_KEY,
  type CategoryTradingValues,
  type TradingCategory,
  type TradingValuesConfig,
  defaultCategoryTradingValues,
  defaultTradingValues,
  loadSharedTradingValues,
  normalizeTradingValues,
  readCachedTradingValues,
  saveSharedTradingValues,
} from '../services/tradingValues';

interface Props {
  lang: Language;
}

type FieldKey = keyof CategoryTradingValues;

const CATEGORY_LABEL: Record<TradingCategory, { ar: string; en: string }> = {
  forex: { ar: 'فوركس', en: 'Forex' },
  crypto: { ar: 'كريبتو', en: 'Crypto' },
  stocks: { ar: 'أسهم', en: 'Stocks' },
  metals: { ar: 'معادن', en: 'Metals' },
};

const FIELDS: Array<{ key: FieldKey; ar: string; en: string; hintAr: string; hintEn: string; step: string }> = [
  { key: 'lotSize', ar: 'حجم اللوت', en: 'Lot Size', hintAr: 'يُفرض بدل اللوت المتغيّر مع الرصيد', hintEn: 'Forced instead of the balance-scaled lot', step: 'any' },
  { key: 'stopLossUSD', ar: 'وقف الخسارة ($)', en: 'Stop Loss ($)', hintAr: 'مسافة الوقف بالدولار', hintEn: 'Stop distance in USD', step: 'any' },
  { key: 'takeProfitUSD', ar: 'أخذ الربح ($)', en: 'Take Profit ($)', hintAr: 'مسافة الهدف بالدولار', hintEn: 'Target distance in USD', step: 'any' },
  { key: 'trailingActivationUSD', ar: 'تفعيل الترينلغ ($)', en: 'Trailing Activation ($)', hintAr: 'ربح التفعيل الثابت', hintEn: 'Fixed activation profit', step: 'any' },
  { key: 'trailingStepUSD', ar: 'خطوة الترينلغ ($)', en: 'Trailing Step ($)', hintAr: 'خطوة تثبيت الربح الثابتة', hintEn: 'Fixed profit-lock step', step: 'any' },
];

// Always show/accept Western (Latin) digits 0-9, even if the browser/keyboard
// produces Eastern Arabic (٠١٢…) or Persian (۰۱۲…) numerals.
function toWesternDigits(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

export default function TradingValuesPanel({ lang }: Props) {
  const isAr = lang === 'ar';
  const [config, setConfig] = useState<TradingValuesConfig>(() => readCachedTradingValues());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef<TradingValuesConfig>(config);

  useEffect(() => { latestRef.current = config; }, [config]);

  // Load the shared document (developer may have edited on another device).
  useEffect(() => {
    let alive = true;
    loadSharedTradingValues().then((shared) => {
      if (!alive) return;
      setConfig(shared);
      setDrafts({});
      // The system is ON by default, but clients cannot create the shared
      // document (write = developer only). Seeding it here — once, when it does
      // not exist yet — makes the default reach every desktop and mobile device
      // instead of relying on each device's local cache.
      if (!(shared.updatedAt > 0)) {
        saveSharedTradingValues(shared).catch(() => {});
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Flush a pending save when the panel is closed, so a fast close never loses
  // the last edit.
  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        saveSharedTradingValues(latestRef.current).catch(() => {});
      }
    };
  }, []);

  const persist = (next: TradingValuesConfig) => {
    const normalized = normalizeTradingValues(next);
    setConfig(normalized);
    latestRef.current = normalized;
    // Instant local cache so the next trade (even before Firestore answers)
    // already uses the new values on this device.
    try { localStorage.setItem(TRADING_VALUES_STORAGE_KEY, JSON.stringify(normalized)); } catch {}
    setStatus('saving');
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      saveSharedTradingValues(latestRef.current)
        .then(() => setStatus('saved'))
        .catch(() => setStatus('error'));
    }, 600);
  };

  const patchField = (cat: TradingCategory, field: FieldKey, value: number) => {
    const next: TradingValuesConfig = {
      ...config,
      categories: {
        ...config.categories,
        [cat]: { ...config.categories[cat], [field]: value },
      },
    };
    persist(next);
  };

  const handleInput = (cat: TradingCategory, field: FieldKey, raw: string) => {
    const key = `${cat}.${field}`;
    const western = toWesternDigits(raw);
    setDrafts((d) => ({ ...d, [key]: western }));
    const n = parseFloat(western);
    if (Number.isFinite(n) && n > 0) patchField(cat, field, n);
  };

  const clearDraft = (cat: TradingCategory, field: FieldKey) => {
    const key = `${cat}.${field}`;
    setDrafts((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const resetField = (cat: TradingCategory, field: FieldKey) => {
    const def = defaultCategoryTradingValues(cat);
    clearDraft(cat, field);
    patchField(cat, field, def[field]);
  };

  const resetCategory = (cat: TradingCategory) => {
    const def = defaultCategoryTradingValues(cat);
    setDrafts((d) => {
      const next = { ...d };
      for (const f of FIELDS) delete next[`${cat}.${f.key}`];
      return next;
    });
    persist({
      ...config,
      categories: { ...config.categories, [cat]: def },
    });
  };

  const resetAll = () => {
    setDrafts({});
    persist({ ...defaultTradingValues(), enabled: config.enabled, updatedAt: config.updatedAt });
  };

  const statusNode = status === 'saving'
    ? <span className="inline-flex items-center gap-2 text-amber-400 text-lg md:text-[22px] font-black"><Loader2 size={22} className="animate-spin" />{isAr ? 'جارٍ الحفظ...' : 'Saving...'}</span>
    : status === 'saved'
      ? <span className="inline-flex items-center gap-2 text-emerald-400 text-lg md:text-[22px] font-black"><CheckCircle size={22} />{isAr ? 'تم الحفظ والمزامنة ✓' : 'Saved & synced ✓'}</span>
      : status === 'error'
        ? <span className="inline-flex items-center gap-2 text-red-400 text-lg md:text-[22px] font-black"><AlertTriangle size={22} />{isAr ? 'فشل الحفظ — تحقق من الاتصال' : 'Save failed — check connection'}</span>
        : <span className="text-slate-500 text-lg md:text-[22px] font-bold">{isAr ? 'التغييرات تُحفظ تلقائياً' : 'Changes save automatically'}</span>;

  return (
    <div className="space-y-4 pt-6 border-t border-amber-500/25">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-2xl md:text-[30px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-3 leading-tight">
          <SlidersHorizontal size={28} /> {isAr ? '🎛️ نظام القيم الثابتة للتداول (للمطور فقط)' : '🎛️ Fixed Trading Values (Developer only)'}
        </h3>
        <span className="text-[11px] font-bold">{statusNode}</span>
      </div>

      <div className={`rounded-2xl border p-5 space-y-4 ${config.enabled ? 'bg-amber-500/10 border-amber-500/40' : 'bg-white/[0.02] border-white/10'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xl md:text-[26px] font-black text-brand-text">
              {config.enabled ? <Zap size={26} className="text-amber-400" /> : <Lock size={26} className="text-slate-400" />}
              {isAr ? 'تفعيل / تعطيل النظام' : 'Enable / Disable System'}
            </div>
            <p className={`text-lg md:text-[22px] leading-relaxed font-semibold ${config.enabled ? 'text-amber-300' : 'text-slate-400'}`}>
              {config.enabled
                ? (isAr
                  ? '⚠️ النظام مفعّل: القيم الثابتة أدناه تُفرض على كل صفقة تُفتح تلقائياً أو يدوياً، على الموقع والموبايل، ويتجاهل النظام قيم الإشارة واللوت المتغيّر مع الرصيد.'
                  : '⚠️ System ON: the fixed values below are imposed on every auto and manual trade on desktop and mobile. Signal values and balance-scaled lots are ignored.')
                : (isAr
                  ? 'النظام معطّل: المنصة تعمل كما هي الآن (لوت متغيّر مع الرصيد، وقف/هدف حسب الإشارة أو الإعدادات، ترينلغ ديناميكي).'
                  : 'System OFF: the platform keeps its current behaviour (balance-scaled lot, signal/settings SL/TP, dynamic trailing).')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => persist({ ...config, enabled: !config.enabled })}
            className={`w-20 h-11 rounded-full transition-all shrink-0 flex items-center px-1 ${config.enabled ? 'bg-[#F59E0B]' : 'bg-white/15'}`}
            aria-pressed={config.enabled}
          >
            <div className={`w-9 h-9 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-9' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-lg md:text-[22px] font-black text-brand-text/80 transition-all"
          >
            <RotateCcw size={20} /> {isAr ? 'إعادة كل القيم للافتراضي الحالي' : 'Reset all to current defaults'}
          </button>
          <span className="text-base md:text-[20px] text-slate-500 self-center font-bold">
            {isAr ? 'الافتراضي: لوت الفئة الأساسي · وقف $60 · هدف $120 · ترينلغ $5/$2' : 'Defaults: category base lot · SL $60 · TP $120 · trailing $5/$2'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {TRADING_CATEGORIES.map((cat) => {
          const values = config.categories[cat];
          return (
            <div key={cat} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xl md:text-[26px] font-black text-brand-text">{isAr ? CATEGORY_LABEL[cat].ar : CATEGORY_LABEL[cat].en}</div>
                <button
                  type="button"
                  onClick={() => resetCategory(cat)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-base md:text-[19px] font-black text-brand-text/70 transition-all"
                >
                  <RotateCcw size={16} /> {isAr ? 'افتراضي الفئة' : 'Category default'}
                </button>
              </div>

              <div className="space-y-2.5">
                {FIELDS.map((f) => {
                  const key = `${cat}.${f.key}`;
                  const display = drafts[key] ?? String(values[f.key]);
                  return (
                    <div key={f.key} className="grid grid-cols-[1fr_150px_46px] items-center gap-3">
                      <div className="min-w-0">
                        <div className="text-lg md:text-[22px] font-black text-brand-text/90 truncate">{isAr ? f.ar : f.en}</div>
                        <div className="text-base md:text-[19px] text-slate-500 truncate">{isAr ? f.hintAr : f.hintEn}</div>
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        step={f.step}
                        min="0"
                        dir="ltr"
                        lang="en"
                        value={display}
                        onChange={(e) => handleInput(cat, f.key, e.target.value)}
                        onBlur={() => clearDraft(cat, f.key)}
                        className="w-full bg-brand-bg border border-white/15 rounded-xl px-3 py-3 text-lg md:text-[22px] font-black text-white text-left focus:outline-none focus:border-amber-500/60"
                        style={{ fontVariantNumeric: 'tabular-nums lining-nums' }}
                      />
                      <button
                        type="button"
                        onClick={() => resetField(cat, f.key)}
                        title={isAr ? 'إعادة هذه القيمة للافتراضي' : 'Reset this value to default'}
                        className="w-11 h-11 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-brand-text/60 hover:text-amber-400 flex items-center justify-center transition-all"
                      >
                        <RotateCcw size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-lg md:text-[21px] text-slate-500 leading-relaxed font-semibold">
        {isAr
          ? 'ملاحظة: عند التفعيل تُطبَّق القيم على فتح الصفقات وعلى إدارة الترينلغ للصفقات المفتوحة. تغيير أي قيمة يُزامَن فوراً مع كل أجهزة الموقع والموبايل. عند التعطيل تعود المنصة لقيمها الديناميكية السابقة.'
          : 'Note: when enabled, values apply to new trades and to trailing management of open positions. Any change syncs instantly to every desktop and mobile device. Disabling restores the previous dynamic behaviour.'}
      </p>
    </div>
  );
}
