import React, { useState, useEffect } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, User, Camera, ChevronLeft } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { useMobileMode } from '../../lib/mobileMode';
import TradingValuesPanel from '../TradingValuesPanel';
import { StrategySettings } from '../../types';
import { DEFAULT_STRATEGY_SETTINGS, mergeStrategySettings, resolveGoldenWindow } from '../../constants';
import { RETRACE_TIMEFRAMES } from '../../services/retraceFilter';
import { applyRetraceAllCategoriesMigration } from '../../lib/retraceMigration';
import { DEV_SETTINGS_EVENT } from '../../services/devSettingsSync';

// Western digits only in numeric fields (Arabic-Indic digits → ASCII).
function toWesternDigits(raw: string): string {
  return String(raw || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

interface MobileSettingsProps {
  autoTradeEnabled: boolean;
  soundEnabled: boolean;
  language: Language;
  onAutoTradeToggle: (v: boolean) => void;
  onSoundToggle: (v: boolean) => void;
  onLanguageChange: (v: Language) => void;
  onClearCache: () => void;
  onDeveloperLogin?: () => void;
  devLoginBusy?: boolean;
  devLoginError?: string | null;
  version: string;
  savedAccounts?: any[];
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
  userEmail?: string | null;
  avatarUrl?: string | null;
  /** Lifted to MobileLayout so the ONE header back icon can leave a sub-page. */
  activeSystem?: MobileSystem | null;
  onActiveSystemChange?: (id: MobileSystem | null) => void;
  /** Incremented by the floating Save button; flushes focused drafts. */
  saveTick?: number;
}

// Mobile parity with desktop: Settings shows ONLY the system names (one per
// line). Tapping a name opens that system's own page with its controls.
export type MobileSystem = 'autoTrade' | 'thresholds' | 'retrace' | 'sound' | 'language' | 'devLogin' | 'tradingValues';

export function MobileSettings({
  autoTradeEnabled,
  soundEnabled,
  language,
  onAutoTradeToggle,
  onSoundToggle,
  onLanguageChange,
  onClearCache,
  onDeveloperLogin,
  devLoginBusy,
  devLoginError,
  version,
  savedAccounts,
  onLoginClick,
  onLogoutClick,
  userEmail,
  avatarUrl,
  activeSystem = null,
  onActiveSystemChange,
  saveTick = 0,
}: MobileSettingsProps) {
  const isAr = language === 'ar';
  const mode = useMobileMode();
  // The header owns the single back icon; this state lives in MobileLayout so
  // that icon knows whether it must leave a system page or the Settings tab.
  const setActiveSystem = (id: MobileSystem | null) => onActiveSystemChange?.(id);

  // Mobile reads/writes the SAME strategy settings store used by the shared
  // analysis engine, so this filter behaves exactly like the desktop one.
  const [strategy, setStrategy] = useState<StrategySettings>(() => {
    try {
      const raw = localStorage.getItem('strategy_settings');
      if (raw) {
        const merged: any = mergeStrategySettings(JSON.parse(raw));
        if (applyRetraceAllCategoriesMigration(merged)) {
          try { localStorage.setItem('strategy_settings', JSON.stringify(merged)); } catch {}
        }
        return merged;
      }
    } catch {}
    const fresh: any = { ...DEFAULT_STRATEGY_SETTINGS };
    applyRetraceAllCategoriesMigration(fresh);
    return fresh;
  });
  const updateStrategy = (key: keyof StrategySettings, value: any) => {
    setStrategy((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem('strategy_settings', JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Live developer-settings sync (desktop ↔ phone): when the other device
  // changes the analysis filters while this page is open, re-read them.
  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem('strategy_settings');
        if (raw) {
          const merged: any = mergeStrategySettings(JSON.parse(raw));
          if (applyRetraceAllCategoriesMigration(merged)) {
            try { localStorage.setItem('strategy_settings', JSON.stringify(merged)); } catch {}
          }
          setStrategy(merged);
        }
      } catch {}
    };
    window.addEventListener(DEV_SETTINGS_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(DEV_SETTINGS_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [retraceDrafts, setRetraceDrafts] = useState<Record<string, string>>({});
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});

  const retraceRows: Array<{ suffix: 'Forex' | 'Crypto' | 'Stocks' | 'Metals'; ar: string; en: string }> = [
    { suffix: 'Forex', ar: 'الفوركس', en: 'Forex' },
    { suffix: 'Crypto', ar: 'العملات الرقمية', en: 'Crypto' },
    { suffix: 'Stocks', ar: 'الأسهم', en: 'Stocks' },
    { suffix: 'Metals', ar: 'المعادن', en: 'Metals' },
  ];

  // The floating save button flushes text fields that are still focused. Normal
  // edits already persist on change/blur; this only makes the explicit Save
  // action deterministic and shows the user that nothing is left pending.
  useEffect(() => {
    if (saveTick <= 0) return;
    const next: any = { ...strategy };
    let dirty = false;
    const clamp = (raw: string | undefined, min: number, max: number) => {
      const n = parseInt(raw ?? '', 10);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
    };
    for (const row of retraceRows) {
      const count = clamp(retraceDrafts[row.suffix], 1, 10);
      if (count !== null) { next[`retraceCandles${row.suffix}`] = count; dirty = true; }
      for (const kind of ['min', 'max'] as const) {
        const value = clamp(thresholdDrafts[`${kind}${row.suffix}`], 0, 100);
        if (value !== null) {
          next[`${kind === 'min' ? 'goldenConfMin' : 'goldenConfMax'}${row.suffix}`] = value;
          dirty = true;
        }
      }
    }
    if (dirty) {
      setStrategy(next);
      try { localStorage.setItem('strategy_settings', JSON.stringify(next)); } catch {}
      try { window.dispatchEvent(new CustomEvent(DEV_SETTINGS_EVENT)); } catch {}
    }
    setRetraceDrafts({});
    setThresholdDrafts({});
    // Drafts are read at the moment the icon is tapped; re-running on every
    // keystroke would erase what the user is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTick]);

  const systems: Array<{ id: MobileSystem; ar: string; en: string; devOnly?: boolean; color: string }> = [
    { id: 'autoTrade', ar: 'التداول التلقائي', en: 'Auto Trade', color: '#3b82f6' },
    { id: 'thresholds', ar: 'عتبات الثقة والنطاق الذهبي', en: 'Confidence & Golden Window', color: '#8b5cf6' },
    { id: 'retrace', ar: 'فلتر التراجع (شموع الارتداد) — التأكيد الأخير', en: 'Retrace Filter (Pullback Candles)', color: '#ef4444' },
    { id: 'sound', ar: 'الصوت والتنبيهات', en: 'Sound & Alerts', color: '#10b981' },
    { id: 'language', ar: 'اللغة', en: 'Language', color: '#8b5cf6' },
    { id: 'devLogin', ar: 'تسجيل دخول المطور', en: 'Developer Login', devOnly: true, color: '#f59e0b' },
    { id: 'tradingValues', ar: 'نظام القيم الثابتة للتداول (مطور)', en: 'Fixed Trading Values (Dev)', devOnly: true, color: '#14b8a6' },
  ];
  // A client (free OR paid) may only change language and sound/alerts. Every
  // strategy/access control stays developer-only — there is no login-related
  // setting exposed to a client account.
  const isClient = !mode.isDev;
  const clientAllowed = new Set<MobileSystem>(['sound', 'language']);
  const visibleSystems = systems.filter((s) => {
    if (isClient) return clientAllowed.has(s.id);
    if (s.id === 'devLogin') return !!onDeveloperLogin;
    if (s.devOnly) return mode.isDev;
    return true;
  });
  // If the account changes while a strategy sub-page is open, never leave that
  // page reachable for a client.
  const shownSystem = isClient && activeSystem !== null && !clientAllowed.has(activeSystem) ? null : activeSystem;
  const activeInfo = shownSystem ? systems.find((s) => s.id === shownSystem) : null;

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Globe size={18} /> {isAr ? 'الإعدادات' : 'Settings'}
      </div>

      {/* ── Systems index: names only ── */}
      {shownSystem === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#888', fontWeight: 700, padding: '0 4px' }}>
            {isAr ? 'اختر النظام الذي تريد تعديله — كل نظام في صفحة مستقلة.' : 'Choose a system to edit — each one opens on its own page.'}
          </div>
          {visibleSystems.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className="mt5-signal-card"
              onClick={() => setActiveSystem(s.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '16px', cursor: 'pointer',
                background: idx % 2 === 0 ? '#1a1f2e' : '#0f131a',
                borderLeft: `4px solid ${idx % 2 === 0 ? '#3b82f6' : '#10b981'}`,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 900, color: s.color }}>{isAr ? s.ar : s.en}</span>
              <ChevronLeft size={20} style={{ opacity: 0.5, transform: 'rotate(180deg)', flexShrink: 0 }} />
            </button>
          ))}
          <div style={{ fontSize: 12, color: '#888', textAlign: 'center', paddingTop: 4 }}>v{version}</div>
        </div>
      )}

      {/* ── Dedicated system page ── */}
      {shownSystem !== null && activeInfo && (
        <>
          {/* Back and Save are the two floating controls owned by MobileLayout. */}
          <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>
              {isAr ? activeInfo.ar : activeInfo.en}
            </div>

            {shownSystem === 'autoTrade' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'التداول التلقائي' : 'Auto Trade'}</span>
                <button className="mt5-btn mt5-btn-secondary" onClick={() => onAutoTradeToggle(!autoTradeEnabled)}>
                  {autoTradeEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
                </button>
              </div>
            )}

            {shownSystem === 'thresholds' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.7 }}>
                  {isAr
                    ? 'لكل فئة نطاق ثقة مستقل. الإشارة تظهر داخل نطاقها فقط؛ أقل من الأدنى أو فوق الأقصى تُحوَّل لمحايد. التغيير يُحفظ ويُزامن بين الأجهزة تلقائياً.'
                    : 'Every market has its own confidence window. Signals are shown only inside that range; below the min or above the max becomes neutral. Changes are saved and synced across devices automatically.'}
                </div>

                <button
                  type="button"
                  onClick={() => updateStrategy('goldenRangeEnabled', strategy.goldenRangeEnabled === false)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, padding: '12px', borderRadius: 10, cursor: 'pointer', textAlign: 'right',
                    background: strategy.goldenRangeEnabled !== false ? 'rgba(245,158,11,0.12)' : '#151515',
                    border: `2px solid ${strategy.goldenRangeEnabled !== false ? 'rgba(245,158,11,0.5)' : '#2a2a2a'}`,
                    color: strategy.goldenRangeEnabled !== false ? '#fbbf24' : '#bbb',
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 900 }}>
                      {isAr ? 'تفعيل النطاق الذهبي' : 'Enable Golden Window'}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.75 }}>
                      {strategy.goldenRangeEnabled !== false
                        ? (isAr ? 'مفعّل — لكل فئة نطاقها' : 'On — per-category ranges')
                        : (isAr ? 'معطّل' : 'Off')}
                    </span>
                  </span>
                  <span style={{ width: 44, height: 24, borderRadius: 99, background: strategy.goldenRangeEnabled !== false ? '#f59e0b' : '#3a3a3a', display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0 }}>
                    <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: `translateX(${strategy.goldenRangeEnabled !== false ? 20 : 0}px)`, transition: 'transform .15s' }} />
                  </span>
                </button>

                {retraceRows.map((row) => {
                  const minKey = `goldenConfMin${row.suffix}` as keyof StrategySettings;
                  const maxKey = `goldenConfMax${row.suffix}` as keyof StrategySettings;
                  const [fallbackMin, fallbackMax] = resolveGoldenWindow(strategy, row.suffix.toLowerCase());
                  const [defaultMin, defaultMax] = resolveGoldenWindow(DEFAULT_STRATEGY_SETTINGS, row.suffix.toLowerCase());
                  const rawMin = (strategy as any)[minKey];
                  const rawMax = (strategy as any)[maxKey];
                  const minValue = typeof rawMin === 'number' && Number.isFinite(rawMin) ? rawMin : fallbackMin;
                  const maxValue = typeof rawMax === 'number' && Number.isFinite(rawMax) ? rawMax : fallbackMax;

                  const renderField = (
                    kind: 'min' | 'max',
                    key: keyof StrategySettings,
                    value: number,
                    labelAr: string,
                    labelEn: string,
                  ) => {
                    const draftKey = `${kind}${row.suffix}`;
                    const draft = thresholdDrafts[draftKey];
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{isAr ? labelAr : labelEn}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          value={draft !== undefined ? draft : String(value)}
                          onChange={(e) => {
                            const digits = toWesternDigits(e.target.value).replace(/[^0-9]/g, '').slice(0, 3);
                            setThresholdDrafts((prev) => ({ ...prev, [draftKey]: digits }));
                          }}
                          onBlur={() => {
                            const n = parseInt(thresholdDrafts[draftKey] ?? '', 10);
                            if (Number.isFinite(n)) updateStrategy(key, Math.max(0, Math.min(100, n)));
                            setThresholdDrafts((prev) => {
                              const next = { ...prev };
                              delete next[draftKey];
                              return next;
                            });
                          }}
                          style={{ width: 64, textAlign: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid #3a3a3a', background: '#111', color: '#fff', fontWeight: 900, fontSize: 15 }}
                        />
                      </div>
                    );
                  };

                  return (
                    <div key={row.suffix} style={{ border: '1px solid #333', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: '#0b0b0b' }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: '#fbbf24' }}>{isAr ? row.ar : row.en}</div>
                      {renderField('min', minKey, minValue, 'أدنى ثقة', 'Golden Min')}
                      {renderField('max', maxKey, maxValue, 'أقصى ثقة', 'Golden Max')}
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {isAr ? `الافتراضي لهذه الفئة: ${defaultMin} / ${defaultMax}` : `Category default: ${defaultMin} / ${defaultMax}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {shownSystem === 'retrace' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.7 }}>
                  {isAr
                    ? 'آخر بوابة بعد استيفاء كل الشروط: تعدّ الشموع المعاكسة للاتجاه على الفريم المحدد؛ عند تحقّق العدد تُسمح الإشارة، وتظهر «إشارة جيدة» عند أول إغلاق لشمعة مع اتجاه الصفقة بعد العدّاد مهما كان نوع الشمعة. اتجاه الشمعة الحالية والامتصاص ملاحظتان فقط لا تمنعان. غياب العدد المطلوب فقط ← إخفاء. الدوجي لا يُحتسب. لكل فئة سويتش بين النمط المتتالي (الافتراضي) والنافذة المرنة دون تغيير العدد أو الفريم.'
                    : 'Final gate: counts candles against the trade on the chosen timeframe; when the count is reached the signal is allowed, and a green "good signal" appears on the first subsequent candle that closes with the trade (any candle type). Current candle direction and absorption are diagnostic notes only. Only a missing count hides the signal. Doji is never counted. Each category has a switch between consecutive (default) and windowed mode; count and timeframe stay unchanged.'}
                </div>

                {retraceRows.map((row) => {
                  const enableKey = `retraceFilterEnabled${row.suffix}` as keyof StrategySettings;
                  const countKey = `retraceCandles${row.suffix}` as keyof StrategySettings;
                  const tfKey = `retraceTimeframe${row.suffix}` as keyof StrategySettings;
                  const enabled = (strategy as any)[enableKey] === true;
                  const count = Number((strategy as any)[countKey] ?? 3);
                  const tf = String((strategy as any)[tfKey] || '1d');
                  const draft = retraceDrafts[row.suffix];
                  return (
                    <div key={row.suffix} style={{ border: '1px solid #333', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: '#0b0b0b' }}>
                      <button
                        type="button"
                        onClick={() => updateStrategy(enableKey, !enabled)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                          background: enabled ? 'rgba(16,185,129,0.12)' : '#151515',
                          border: `2px solid ${enabled ? 'rgba(16,185,129,0.5)' : '#2a2a2a'}`,
                          color: enabled ? '#10b981' : '#bbb', textAlign: 'right',
                        }}
                      >
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 15, fontWeight: 900 }}>{isAr ? row.ar : row.en}</span>
                          <span style={{ fontSize: 11, opacity: 0.75 }}>
                            {enabled
                              ? (isAr ? 'مفعّل — تأكيد أخير' : 'Enabled — final gate')
                              : row.suffix === 'Forex'
                                ? (isAr ? 'معطّل' : 'Disabled')
                                : (isAr ? 'معطّل (افتراضي)' : 'Disabled (default)')}
                          </span>
                        </span>
                        <span style={{ width: 44, height: 24, borderRadius: 99, background: enabled ? '#10b981' : '#3a3a3a', display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0 }}>
                          <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: `translateX(${enabled ? 20 : 0}px)`, transition: 'transform .15s' }} />
                        </span>
                      </button>

                      {(() => {
                        const modeKey = `retraceMode${row.suffix}` as keyof StrategySettings;
                        const windowed = (strategy as any)[modeKey] === 'windowed';
                        return (
                          <button
                            type="button"
                            onClick={() => updateStrategy(modeKey, windowed ? 'consecutive' : 'windowed')}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                              background: windowed ? 'rgba(245,158,11,0.12)' : '#151515',
                              border: `2px solid ${windowed ? 'rgba(245,158,11,0.5)' : '#2a2a2a'}`,
                              color: windowed ? '#fbbf24' : '#bbb', textAlign: 'right',
                            }}
                          >
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 14, fontWeight: 900 }}>
                                {isAr
                                  ? (windowed ? 'نمط العد: نافذة مرنة' : 'نمط العد: متتالي (افتراضي)')
                                  : (windowed ? 'Count mode: windowed' : 'Count mode: consecutive (default)')}
                              </span>
                              <span style={{ fontSize: 11, opacity: 0.75 }}>
                                {isAr
                                  ? 'يسمح بارتداد صغير واحد بين الشموع المعاكسة؛ شمعتان مع الاتجاه تُبطل التراجع ويُنتظر تراجع جديد.'
                                  : 'One small bounce may sit between opposite candles; two with-trade candles invalidate the run and a new retrace is awaited.'}
                              </span>
                            </span>
                            <span style={{ width: 44, height: 24, borderRadius: 99, background: windowed ? '#f59e0b' : '#3a3a3a', display: 'flex', alignItems: 'center', padding: 2, flexShrink: 0 }}>
                              <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', transform: `translateX(${windowed ? 20 : 0}px)`, transition: 'transform .15s' }} />
                            </span>
                          </button>
                        );
                      })()}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>
                          {isAr ? 'عدد شموع التراجع' : 'Retrace candles'}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          value={draft !== undefined ? draft : String(count)}
                          onChange={(e) => {
                            const digits = toWesternDigits(e.target.value).replace(/[^0-9]/g, '').slice(0, 2);
                            setRetraceDrafts((prev) => ({ ...prev, [row.suffix]: digits }));
                          }}
                          onBlur={() => {
                            const n = parseInt(retraceDrafts[row.suffix] ?? '', 10);
                            if (Number.isFinite(n)) updateStrategy(countKey, Math.max(1, Math.min(10, n)));
                            setRetraceDrafts((prev) => {
                              const next = { ...prev };
                              delete next[row.suffix];
                              return next;
                            });
                          }}
                          style={{ width: 64, textAlign: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid #3a3a3a', background: '#111', color: '#fff', fontWeight: 900, fontSize: 15 }}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd' }}>{isAr ? 'الفريم' : 'Timeframe'}</span>
                        <select
                          value={(RETRACE_TIMEFRAMES as readonly string[]).includes(tf) ? tf : '1d'}
                          onChange={(e) => updateStrategy(tfKey, e.target.value)}
                          dir="ltr"
                          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #3a3a3a', background: '#111', color: '#fff', fontWeight: 900, fontSize: 14 }}
                        >
                          {RETRACE_TIMEFRAMES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>

                      {row.suffix === 'Forex' && (
                        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.06)', color: '#10b981', fontSize: 11, lineHeight: 1.7 }}>
                          {isAr
                            ? 'الوضع المخفّف مطبَّق تلقائياً لكل الفئات مثل الفوركس: تُحسب كل شمعة عاكسة بجسم أكبر من 10% من مداها، والدوجي فقط يُتجاهل.'
                            : 'Lenient mode now applies to every category like forex: every opposite candle with a body larger than 10% of its range counts; only doji is skipped.'}
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}

            {shownSystem === 'sound' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'الصوت' : 'Sound'}</span>
                <button className="mt5-btn mt5-btn-secondary" onClick={() => onSoundToggle(!soundEnabled)}>
                  {soundEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
                </button>
              </div>
            )}

            {shownSystem === 'language' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'اللغة' : 'Language'}</span>
                <select value={language} onChange={(e) => onLanguageChange(e.target.value as Language)}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
            )}

            {shownSystem === 'devLogin' && onDeveloperLogin && (
              <>
                <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onDeveloperLogin} disabled={devLoginBusy}>
                  {devLoginBusy ? <Loader2 size={16} className="spin" /> : <Shield size={16} />} {isAr ? 'تسجيل دخول المطور' : 'Developer Login'}
                </button>
                {devLoginError && <div style={{ color: 'red', fontSize: 12 }}>{devLoginError}</div>}
              </>
            )}

            {shownSystem === 'tradingValues' && mode.isDev && (
              <TradingValuesPanel lang={language} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
