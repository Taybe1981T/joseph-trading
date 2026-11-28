import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, RotateCcw, CheckCircle, Loader2, AlertTriangle, Zap, Lock, Layers } from 'lucide-react';
import { Language } from '../lib/i18n';
import {
  CRYPTO_TIER_VALUES_KEYS,
  TRADING_CATEGORIES,
  TRADING_VALUES_STORAGE_KEY,
  type CryptoTierKey,
  type TierTradingValues,
  type TradingCategory,
  type TradingValuesConfig,
  defaultCategoryTradingValues,
  defaultCryptoTierValues,
  defaultTradingValues,
  loadSharedTradingValues,
  normalizeTradingValues,
  readCachedTradingValues,
  saveSharedTradingValues,
} from '../services/tradingValues';

interface Props {
  lang: Language;
}

type FieldKey = keyof TierTradingValues;

const CATEGORY_LABEL: Record<TradingCategory, { ar: string; en: string }> = {
  forex: { ar: 'فوركس', en: 'Forex' },
  crypto: { ar: 'كريبتو', en: 'Crypto' },
  stocks: { ar: 'أسهم', en: 'Stocks' },
  metals: { ar: 'معادن', en: 'Metals' },
};

const TIER_LABEL: Record<CryptoTierKey, { ar: string; en: string }> = {
  high: { ar: 'الأعلى سيولة (قوي)', en: 'Highest liquidity (strong)' },
  medium: { ar: 'متوسط السيولة', en: 'Medium liquidity' },
  low: { ar: 'الأضعف سيولة (ضعيف)', en: 'Lowest liquidity (weak)' },
};

const FIELDS: Array<{ key: FieldKey; ar: string; en: string; hintAr: string; hintEn: string }> = [
  { key: 'lotSize', ar: 'حجم اللوت', en: 'Lot Size', hintAr: 'يُفرض بدل اللوت المتغيّر مع الرصيد', hintEn: 'Forced instead of the balance-scaled lot' },
  { key: 'stopLossUSD', ar: 'وقف الخسارة ($)', en: 'Stop Loss ($)', hintAr: 'القيمة عند رصيد 10000$ — تتضاعف مع الرصيد', hintEn: 'Value at a $10,000 balance — scales with balance' },
  { key: 'takeProfitUSD', ar: 'أخذ الربح ($)', en: 'Take Profit ($)', hintAr: 'القيمة عند رصيد 10000$ — تتضاعف مع الرصيد', hintEn: 'Value at a $10,000 balance — scales with balance' },
];

function fieldLabel(f: { ar: string; en: string }, isAr: boolean): string {
  return isAr ? f.ar : f.en;
}

/** Crypto hints describe THIS tier's editable base; other categories keep the old hint. */
function fieldHint(f: { key: FieldKey; hintAr: string; hintEn: string }, cat: TradingCategory, tier: CryptoTierKey | undefined, isAr: boolean): string {
  if (cat !== 'crypto') return isAr ? f.hintAr : f.hintEn;
  const d = defaultCryptoTierValues()[tier || 'high'];
  switch (f.key) {
    case 'lotSize':
      return isAr
        ? `لوت هذه الفئة لكل 1000$ (الافتراضي ${formatNumericValue(d.lotSize)}) — يتضاعف مع الرصيد`
        : `Lot per $1,000 for this tier (default ${formatNumericValue(d.lotSize)}) — scales with balance`;
    case 'stopLossUSD':
      return isAr
        ? `ميزانية وقف بالدولار لكل 1000$ (الافتراضي ${d.stopLossUSD}$) — تتضاعف مع الرصيد`
        : `Stop budget per $1,000 (default $${d.stopLossUSD}) — doubles with balance`;
    case 'takeProfitUSD':
      return isAr
        ? `ميزانية هدف بالدولار لكل 1000$ (الافتراضي ${d.takeProfitUSD}$) — تتضاعف مع الرصيد`
        : `Target budget per $1,000 (default $${d.takeProfitUSD}) — doubles with balance`;
    case 'trailingActivationUSD':
      return isAr
        ? `ربح التفعيل بالدولار لهذه الفئة (الافتراضي ${d.trailingActivationUSD}$)`
        : `Activation profit in USD for this tier (default $${d.trailingActivationUSD})`;
    case 'trailingStepUSD':
      return isAr
        ? `خطوة تثبيت الربح بالدولار لهذه الفئة (الافتراضي ${d.trailingStepUSD}$)`
        : `Profit-lock step in USD for this tier (default $${d.trailingStepUSD})`;
  }
}

// Numbers are always written AND displayed as Western (Latin) digits — e.g.
// 1.2 , 0.01 , 60 — never ٠٫٠١ / ۱٫۲ / ٦٠. Arabic-Indic and Persian numerals
// (typed by an Arabic keyboard) plus Arabic decimal/thousands separators are
// converted to plain ASCII digits and a dot.
function normalizeNumericInput(raw: string): string {
  let s = String(raw ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u066B\u060C,]/g, '.')   // ٫ / ، / , → .
    .replace(/[\u066C\s]/g, '');        // ٬ / spaces → nothing
  s = s.replace(/[^\d.]/g, '');         // digits + dot only
  const firstDot = s.indexOf('.');
  if (firstDot >= 0) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  return s;
}

// Display helper: 0.01 → "0.01", 1.2 → "1.2", 60 → "60" (no floats junk).
function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(6)));
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

  // A tier is supplied only for crypto; other categories keep their flat field.
  const draftKey = (cat: TradingCategory, field: FieldKey, tier?: CryptoTierKey) =>
    tier ? `${cat}.${tier}.${field}` : `${cat}.${field}`;

  const readValue = (cat: TradingCategory, field: FieldKey, tier?: CryptoTierKey): number => {
    const cv = config.categories[cat];
    if (cat === 'crypto' && tier) return cv.cryptoTiers?.[tier]?.[field] ?? defaultCryptoTierValues()[tier][field];
    return cv[field];
  };

  const writeValue = (cat: TradingCategory, field: FieldKey, value: number, tier?: CryptoTierKey) => {
    const next: TradingValuesConfig = { ...config, categories: { ...config.categories } };
    if (cat === 'crypto' && tier) {
      const base = next.categories.crypto.cryptoTiers || defaultCryptoTierValues();
      next.categories.crypto = {
        ...next.categories.crypto,
        cryptoTiers: { ...base, [tier]: { ...base[tier], [field]: value } },
      };
    } else {
      next.categories[cat] = { ...next.categories[cat], [field]: value };
    }
    persist(next);
  };

  const handleInput = (cat: TradingCategory, field: FieldKey, raw: string, tier?: CryptoTierKey) => {
    const key = draftKey(cat, field, tier);
    const western = normalizeNumericInput(raw);
    setDrafts((d) => ({ ...d, [key]: western }));
    const n = parseFloat(western);
    if (Number.isFinite(n) && n > 0) writeValue(cat, field, n, tier);
  };

  const clearDraft = (cat: TradingCategory, field: FieldKey, tier?: CryptoTierKey) => {
    const key = draftKey(cat, field, tier);
    setDrafts((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const resetField = (cat: TradingCategory, field: FieldKey, tier?: CryptoTierKey) => {
    const def = tier ? defaultCryptoTierValues()[tier] : defaultCategoryTradingValues(cat);
    clearDraft(cat, field, tier);
    writeValue(cat, field, (def as TierTradingValues)[field], tier);
  };

  const resetTier = (tier: CryptoTierKey) => {
    setDrafts((d) => {
      const next = { ...d };
      for (const f of FIELDS) delete next[`crypto.${tier}.${f.key}`];
      return next;
    });
    const base = config.categories.crypto.cryptoTiers || defaultCryptoTierValues();
    persist({
      ...config,
      categories: {
        ...config.categories,
        crypto: { ...config.categories.crypto, cryptoTiers: { ...base, [tier]: defaultCryptoTierValues()[tier] } },
      },
    });
  };

  const resetCategory = (cat: TradingCategory) => {
    setDrafts((d) => {
      const next = { ...d };
      if (cat === 'crypto') {
        for (const t of CRYPTO_TIER_VALUES_KEYS) {
          for (const f of FIELDS) delete next[`crypto.${t}.${f.key}`];
        }
      } else {
        for (const f of FIELDS) delete next[`${cat}.${f.key}`];
      }
      return next;
    });
    persist({
      ...config,
      categories: { ...config.categories, [cat]: defaultCategoryTradingValues(cat) },
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

  const renderFieldRow = (cat: TradingCategory, field: (typeof FIELDS)[number], tier?: CryptoTierKey) => {
    const fieldKey = field.key;
    const key = draftKey(cat, fieldKey, tier);
    const display = drafts[key] ?? formatNumericValue(readValue(cat, fieldKey, tier));
    return (
      <div key={key} className="grid grid-cols-[1fr_150px_46px] md:grid-cols-[1fr_180px_46px] items-center gap-3">
        <div className="min-w-0">
          <div className="text-lg md:text-[22px] font-black text-brand-text/90 truncate">{fieldLabel(field, isAr)}</div>
          <div className="text-base md:text-[19px] text-slate-500 truncate" title={fieldHint(field, cat, tier, isAr)}>{fieldHint(field, cat, tier, isAr)}</div>
        </div>
        {/* text + inputMode=decimal instead of type=number: a native
            number input may render Arabic-Indic digits depending on
            the device locale, while a plain ASCII string always
            shows Western digits: 1.2 , 0.01 , 60 */}
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          lang="en-US"
          value={display}
          onChange={(e) => handleInput(cat, fieldKey, e.target.value, tier)}
          onBlur={() => clearDraft(cat, fieldKey, tier)}
          className="w-full bg-brand-bg border border-white/15 rounded-xl px-3 py-3 text-lg md:text-[22px] font-black text-white text-left focus:outline-none focus:border-amber-500/60 tabular-nums"
          style={{ fontFamily: "'Inter', 'Segoe UI', ui-sans-serif, system-ui, sans-serif", fontVariantNumeric: 'lining-nums tabular-nums', letterSpacing: '0.01em' }}
        />
        <button
          type="button"
          onClick={() => resetField(cat, fieldKey, tier)}
          title={isAr ? 'إعادة هذه القيمة للافتراضي' : 'Reset this value to default'}
          className="w-11 h-11 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-brand-text/60 hover:text-amber-400 flex items-center justify-center transition-all"
        >
          <RotateCcw size={18} />
        </button>
      </div>
    );
  };

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
            {isAr
              ? 'الافتراضي: لوت الفئة الأساسي · وقف/هدف 60$/120$ · كريبتو: قوي 0.01 و50$/100$ · متوسط 10 و30$/60$ · ضعيف 10 و10$/20$ لكل 1000$ · ترينلغ 5$/2$'
              : 'Defaults: category base lot · SL/TP $60/$120 · crypto: high 0.01 & $50/$100 · medium 10 & $30/$60 · weak 10 & $10/$20 per $1,000 · trailing $5/$2'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {TRADING_CATEGORIES.map((cat) => {
          if (cat === 'crypto') {
            return (
              <div key="crypto" className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xl md:text-[26px] font-black text-brand-text">
                    <Layers size={22} className="text-amber-400" />
                    {isAr ? CATEGORY_LABEL.crypto.ar : CATEGORY_LABEL.crypto.en}
                    <span className="text-base md:text-[19px] font-bold text-amber-300/80">
                      ({isAr ? 'ثلاث فئات سيولة مستقلة' : '3 independent liquidity tiers'})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetCategory('crypto')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-base md:text-[19px] font-black text-brand-text/70 transition-all"
                  >
                    <RotateCcw size={16} /> {isAr ? 'افتراضي الكريبتو' : 'Crypto defaults'}
                  </button>
                </div>
                <p className="text-base md:text-[18px] leading-relaxed text-slate-500 font-semibold">
                  {isAr
                    ? 'كل فئة سيولة تُعدَّل بشكل مستقل. استثناءات اللوت: لايتكوين وما شابهه ×100 · AXS/SEI ×1000 من أساس الفئة القوية.'
                    : 'Each liquidity tier is edited independently. Lot overrides: LTC-style ×100 · AXS/SEI ×1000 of the high-tier base.'}
                </p>
                {CRYPTO_TIER_VALUES_KEYS.map((tier) => (
                  <div key={tier} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                      <div className="text-lg md:text-[21px] font-black text-amber-300">{isAr ? TIER_LABEL[tier].ar : TIER_LABEL[tier].en}</div>
                      <button
                        type="button"
                        onClick={() => resetTier(tier)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm md:text-[16px] font-black text-brand-text/70 transition-all"
                      >
                        <RotateCcw size={14} /> {isAr ? 'افتراضي الفئة' : 'Tier default'}
                      </button>
                    </div>
                    {FIELDS.map((f) => renderFieldRow('crypto', f, tier))}
                  </div>
                ))}
              </div>
            );
          }
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
                {FIELDS.map((f) => renderFieldRow(cat, f))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-lg md:text-[21px] text-slate-500 leading-relaxed font-semibold">
        {isAr
          ? 'ملاحظة: عند التفعيل تُطبَّق القيم على فتح الصفقات وعلى إدارة الترينلغ للصفقات المفتوحة. كل قيمة تُزامَن فوراً مع كل أجهزة الموقع والموبايل. عند التعطيل تعود المنصة لقيمها الديناميكية السابقة.'
          : 'Note: when enabled, values apply to new trades and to trailing management of open positions. Any change syncs instantly to every desktop and mobile device. Disabling restores the previous dynamic behaviour.'}
      </p>
    </div>
  );
}
