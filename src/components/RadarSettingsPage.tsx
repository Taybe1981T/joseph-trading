import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, Activity, Layers, Sparkles, Clock, Music, Volume2, CheckCircle, Crown, Star, X } from 'lucide-react';
import { AutoAnalysisSettings } from '../types';
import { Language } from '../lib/i18n';
import { playStart, playSuccess, playFail, playCompletion } from '../lib/audioEngine';

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

interface RadarSettingsPageProps {
  autoSettings: AutoAnalysisSettings;
  onAutoSettingsChange: (s: AutoAnalysisSettings) => void;
  onSave?: () => void;
  isWaiting?: boolean;
  lang: Language;
  hasActivePlan?: boolean;
  onUpgrade?: () => void;
  isDeveloper?: boolean;
}

export default function RadarSettingsPage({ autoSettings, onAutoSettingsChange, onSave, isWaiting, lang, hasActivePlan = true, onUpgrade, isDeveloper = false }: RadarSettingsPageProps) {
  const [saved, setSaved] = useState(false);
  const [showUpgradeOverlay, setShowUpgradeOverlay] = useState(false);

  const handleSave = () => {
    onSave?.();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedList = autoSettings.category === 'all'
    ? ['forex', 'crypto', 'stocks', 'metals']
    : (autoSettings.category || 'all').split(',');

  const handleStrategyChange = (value: string) => {
    if (!hasActivePlan && value !== 'day_trading') {
      setShowUpgradeOverlay(true);
      return;
    }
    onAutoSettingsChange({ ...autoSettings, tradingStyle: value as any });
  };

  const handleTimeframeChange = (tf: string) => {
    if (!hasActivePlan && tf !== '1d') {
      setShowUpgradeOverlay(true);
      return;
    }
    onAutoSettingsChange({ ...autoSettings, timeframe: tf });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-2xl mx-auto">
      {/* Radar Toggle */}
      <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-brand-text">
            {lang === 'ar' ? 'نظام الرادار' : 'Radar System'}
          </h3>
          <p className="text-sm text-brand-muted mt-1">
            {autoSettings.isEnabled
              ? (lang === 'ar' ? 'الرادار نشط' : 'Radar Active')
              : (lang === 'ar' ? 'الرادار متوقف' : 'Radar Off')}
          </p>
        </div>
        <button
          onClick={() => onAutoSettingsChange({ ...autoSettings, isEnabled: !autoSettings.isEnabled })}
          className={cn(
            "flex items-center gap-2 px-5 py-3 rounded-xl transition-all border-2 shadow-lg",
            autoSettings.isEnabled
              ? 'bg-emerald-500 border-emerald-600 text-white shadow-emerald-500/40'
              : 'bg-[#F59E0B] border-black/10 text-black hover:bg-[#d97706]'
          )}
        >
          <div className="relative">
            <Zap size={20} fill={autoSettings.isEnabled ? "currentColor" : "none"} />
            {autoSettings.isEnabled && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white rounded-full animate-ping shadow-[0_0_12px_white]" />
            )}
          </div>
          <span className="text-sm font-black uppercase tracking-wider">
            {autoSettings.isEnabled ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      {/* Audio Section — developer only. Paid clients get the radar and its
          results, but sound/alert options are intentionally not shown to them. */}
      {isDeveloper && (
      <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 space-y-6">
        <div className="flex items-center gap-3 text-brand-muted">
          <Music size={18} className="text-[#F59E0B]" />
          <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
            {lang === 'ar' ? 'التنبيهات الصوتية' : 'Sound Alerts'}
          </span>
        </div>

        {isDeveloper && (
          <div className="space-y-3">
            {/* Alert 1: New Opportunity */}
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-brand-bg border border-brand-text/5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-bold text-brand-text">
                  {lang === 'ar' ? '1. تنبيه فرصة جديدة' : '1. New Opportunity Alert'}
                </span>
              </div>
              <button onClick={() => playSuccess(autoSettings.volume || 0.5)} className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-500/30 transition-colors" title={lang === 'ar' ? 'اختبار' : 'Test'}>
                <Volume2 size={14} />
              </button>
            </div>

            {/* Alert 2: Session End */}
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-brand-bg border border-brand-text/5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-xs font-bold text-brand-text">
                  {lang === 'ar' ? '2. تنبيه انتهاء الدورة' : '2. Cycle Completion Alert'}
                </span>
              </div>
              <button onClick={() => playCompletion(autoSettings.volume || 0.5)} className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-500/30 transition-colors" title={lang === 'ar' ? 'اختبار' : 'Test'}>
                <Volume2 size={14} />
              </button>
            </div>

            {/* Alert 3: Analysis Complete */}
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-brand-bg border border-brand-text/5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-xs font-bold text-brand-text">
                  {lang === 'ar' ? '3. تنبيه إتمام التحليل' : '3. Analysis Complete Alert'}
                </span>
              </div>
              <button onClick={() => playFail(autoSettings.volume || 0.5)} className="p-2 bg-emerald-500/20 rounded-xl text-emerald-400 hover:bg-emerald-500/30 transition-colors" title={lang === 'ar' ? 'اختبار' : 'Test'}>
                <Volume2 size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Volume */}
        <div className="pt-4 border-t border-brand-text/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-[#F59E0B]" />
              <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
                {lang === 'ar' ? 'مستوى الصوت' : 'Volume'}
              </span>
            </div>
            <span className="text-sm font-mono font-black text-[#F59E0B]">{Math.round(autoSettings.volume * 100)}%</span>
          </div>
          <input
            type="range" min="0" max="1" step="0.1"
            value={autoSettings.volume}
            onChange={(e) => onAutoSettingsChange({ ...autoSettings, volume: parseFloat(e.target.value) })}
            className="w-full h-2 bg-brand-bg rounded-lg appearance-none cursor-pointer accent-[#F59E0B]"
          />
        </div>
      </div>
      )}

      {/* Market Selection */}
      <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 space-y-4">
        <div className="flex items-center gap-3 text-brand-muted">
          <Layers size={18} className="text-[#F59E0B]" />
          <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
            {lang === 'ar' ? 'السوق' : 'Market'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'forex', label: lang === 'ar' ? 'فوركس' : 'Forex' },
            { id: 'crypto', label: lang === 'ar' ? 'كريبتو' : 'Crypto' },
            { id: 'stocks', label: lang === 'ar' ? 'الأسهم' : 'Stocks' },
            { id: 'metals', label: lang === 'ar' ? 'معادن' : 'Metals' }
          ].map((cat) => {
            const isSelected = selectedList.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => {
                  let newList = [...selectedList];
                  if (isSelected) {
                    if (newList.length > 1) newList = newList.filter(id => id !== cat.id);
                  } else {
                    newList.push(cat.id);
                  }
                  onAutoSettingsChange({ ...autoSettings, category: (newList.length === 4 ? 'all' : newList.join(',')) as any });
                }}
                className={cn(
                  "flex items-center justify-between px-4 py-3.5 rounded-2xl text-xs font-black border-2 transition-all w-full",
                  isSelected ? 'bg-primary/10 border-primary text-primary' : 'bg-brand-bg border-brand-text/5 text-brand-muted'
                )}
              >
                <span>{cat.label}</span>
                <div className={cn("w-4 h-4 rounded-md border flex items-center justify-center transition-all", isSelected ? "border-primary bg-primary text-white" : "border-brand-text/20")}>
                  {isSelected && <span className="text-[10px] leading-none font-bold">✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scan Interval & Strategy */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 space-y-3">
          <div className="flex items-center gap-2 text-brand-muted">
            <Zap size={16} className="text-orange-500" />
            <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
              {lang === 'ar' ? 'الفحص كل' : 'Scan Every'}
            </span>
          </div>
          <select
            value={autoSettings.interval}
            onChange={(e) => onAutoSettingsChange({ ...autoSettings, interval: parseInt(e.target.value) })}
            className="w-full bg-brand-bg border-2 border-brand-text/10 rounded-2xl px-4 py-3 text-sm font-black text-brand-text focus:border-primary outline-none appearance-none cursor-pointer"
          >
            <option value="1">1 Minute</option>
            <option value="5">5 Minutes</option>
            <option value="15">15 Minutes</option>
            <option value="60">1 Hour</option>
            <option value="120">2 Hours</option>
            <option value="240">4 Hours</option>
            <option value="1440">1 Day</option>
          </select>
        </div>
        <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 space-y-3">
          <div className="flex items-center gap-2 text-brand-muted">
            <Sparkles size={16} className="text-[#F59E0B]" />
            <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
              {lang === 'ar' ? 'الاستراتيجية' : 'Strategy'}
            </span>
          </div>
          <select
            value={autoSettings.tradingStyle}
            onChange={(e) => handleStrategyChange(e.target.value)}
            className={cn(
              "w-full bg-brand-bg border-2 rounded-2xl px-4 py-3 text-sm font-black text-brand-text focus:border-primary outline-none appearance-none cursor-pointer",
              !hasActivePlan ? "border-amber-500/40" : "border-brand-text/10"
            )}
          >
            <option value="scalping">{lang === 'ar' ? 'سكالبينج' : 'Scalping'}</option>
            <option value="day_trading">{lang === 'ar' ? 'تداول يومي' : 'Day Trading'}</option>
            <option value="swing_trading">{lang === 'ar' ? 'سوينغ' : 'Swing Trading'}</option>
          </select>
          {!hasActivePlan && (
            <p className="text-[10px] text-amber-400 font-bold">{lang === 'ar' ? 'المجاني: تداول يومي فقط' : 'Free: Day Trading only'}</p>
          )}
        </div>
      </div>

      {/* Timeframe */}
      <div className="bg-brand-alt rounded-2xl border border-white/10 p-6 space-y-4">
        <div className="flex items-center gap-2 text-brand-muted">
          <Clock size={18} />
          <span className="text-xs font-black uppercase tracking-widest text-brand-text/90">
            {lang === 'ar' ? 'الإطار الزمني' : 'Timeframe'}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {['15m', '1h', '4h', '1d', '1w', '1M', '1Y'].map((tf) => {
            const isLocked = !hasActivePlan && tf !== '1d';
            return (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={cn(
                  "py-3 text-xs font-black rounded-2xl border-2 transition-all",
                  autoSettings.timeframe === tf
                    ? 'bg-primary border-primary text-white shadow-xl shadow-primary/30'
                    : isLocked
                      ? 'bg-brand-bg border-brand-text/5 text-brand-muted/30 cursor-not-allowed'
                      : 'bg-brand-bg border-brand-text/5 text-brand-muted hover:border-primary/30'
                )}
              >
                {tf}
              </button>
            );
          })}
        </div>
        {!hasActivePlan && (
          <p className="text-[10px] text-amber-400 font-bold">{lang === 'ar' ? 'المجاني: إطار يومي فقط' : 'Free: 1d timeframe only'}</p>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-4 bg-primary text-white rounded-2xl text-sm font-black shadow-xl shadow-primary/30 hover:shadow-primary/50 transition-all flex items-center justify-center gap-2"
      >
        {saved ? (
          <>
            <CheckCircle size={18} />
            {lang === 'ar' ? 'تم الحفظ ✓' : 'Saved ✓'}
          </>
        ) : (
          lang === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'
        )}
      </button>

      {/* Upgrade Overlay */}
      <AnimatePresence>
        {showUpgradeOverlay && (() => {
          const subPrices = (() => { try { return JSON.parse(localStorage.getItem('subscription_prices') || '{}'); } catch { return {}; } })();
          const prices = { weekly: subPrices.weekly ?? 2, monthly: subPrices.monthly ?? 6, yearly: subPrices.yearly ?? 60 };
          const plans = [
            { key: 'weekly', label: lang === 'ar' ? 'أسبوعي' : 'Weekly', price: prices.weekly, desc: lang === 'ar' ? 'تحليل مؤسسي لمدة 7 أيام' : '7 days analysis', color: 'from-sky-500 to-sky-600', border: 'border-sky-500/30' },
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
                    <Crown size={22} className="text-white" />
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
                      <Star size={14} className="text-white" />
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
                onClick={() => { setShowUpgradeOverlay(false); onUpgrade?.(); }}
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
    </motion.div>
  );
}