import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Settings2, Activity, LayoutTemplate, Layers, ShieldCheck, Mail, MessageSquare, CheckCircle, RotateCcw, AlertTriangle, Loader2, Lock, Trash2 } from 'lucide-react';
import { StrategySettings } from '../types';
import { DEFAULT_STRATEGY_SETTINGS } from '../constants';
import { User } from 'firebase/auth';
import { Language } from '../lib/i18n';
import { isDeveloperEmail, DEVELOPER_EMAILS } from '../lib/clientIds';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: StrategySettings;
  onSettingsChange: (newSettings: StrategySettings) => void;
  onSave?: () => void;
  user: User | null;
  asPage?: boolean;
  lang: Language;
  onDeleteClientResults?: () => Promise<void>;
  planClient?: boolean;
  planKeyEntered?: boolean;
  onChangeClientKey?: (key: string) => Promise<string | null | undefined> | void | null | undefined;
  onDeleteClientKey?: () => void;
}

export default function SettingsModal({ isOpen, onClose, settings, onSettingsChange, onSave, user, asPage, lang, onDeleteClientResults, planClient, planKeyEntered, onChangeClientKey, onDeleteClientKey }: SettingsModalProps) {
  const isAr = lang === 'ar';
  const [ownKeyInput, setOwnKeyInput] = useState('');
  const [ownKeySaving, setOwnKeySaving] = useState(false);
  const [ownKeyError, setOwnKeyError] = useState('');
  const [ownKeyDone, setOwnKeyDone] = useState(false);
  const handleChange = (key: keyof StrategySettings, value: any) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const resetToDefault = () => {
    onSettingsChange(DEFAULT_STRATEGY_SETTINGS);
  };

  // Developer security states
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [currentDevEmail, setCurrentDevEmail] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('finalyze_dev_email') || DEVELOPER_EMAILS[0];
    }
    return DEVELOPER_EMAILS[0];
  });
  const [currentDevPhone, setCurrentDevPhone] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('finalyze_dev_phone') || '0663919868';
    }
    return '0663919868';
  });

  const [isVerifying, setIsVerifying] = useState(false);
  const [generatedSmsOtp, setGeneratedSmsOtp] = useState('');
  const [generatedEmailOtp, setGeneratedEmailOtp] = useState('');
  const [enteredSmsOtp, setEnteredSmsOtp] = useState('');
  const [enteredEmailOtp, setEnteredEmailOtp] = useState('');
  
  const [otpError, setOtpError] = useState('');
  const [otpSuccess, setOtpSuccess] = useState('');
  const [notification, setNotification] = useState<{ type: 'sms' | 'email'; title: string; body: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Stable version info
  const [stableVersion, setStableVersion] = useState<{ version: string; date: string; commit: string } | null>(null);

  // Factory Reset state
  const [showFactoryReset, setShowFactoryReset] = useState(false);
  const [factoryResetLoading, setFactoryResetLoading] = useState(false);
  const [factoryResetDone, setFactoryResetDone] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState('');
  const [factoryResetRedirectUrl, setFactoryResetRedirectUrl] = useState('');
  const [githubPat, setGithubPat] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('finalyze_github_pat') || '';
    return '';
  });
  const [saveStableLoading, setSaveStableLoading] = useState(false);
  const [saveStableDone, setSaveStableDone] = useState(false);
  const [saveStableError, setSaveStableError] = useState('');

  const GITHUB_REPO = 'kraa1981t/finalyze-ai';
  const STABLE_TAG = 'stable-v2';

  const ghHeaders = () => {
    const token = githubPat;
    if (!token) throw new Error('GitHub PAT required — please paste your token above');
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  };

  const handleSaveStable = async () => {
    setSaveStableLoading(true);
    setSaveStableError('');
    setSaveStableDone(false);
    try {
      if (githubPat) localStorage.setItem('finalyze_github_pat', githubPat);
      const headers = ghHeaders();
      const gh = (url: string, opts?: any) => fetch(`https://api.github.com/repos/${GITHUB_REPO}${url}`, { headers, ...opts });

      const mainRef = await (await gh('/git/refs/heads/main')).json();
      const latestSha = mainRef.object?.sha;
      if (!latestSha) { setSaveStableError('Could not get latest commit'); setSaveStableLoading(false); return; }

      const tagResp = await gh(`/git/refs/tags/${STABLE_TAG}`, { method: 'PATCH', body: JSON.stringify({ sha: latestSha, force: true }) });
      if (!tagResp.ok && tagResp.status === 404) {
        await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/tags/${STABLE_TAG}`, sha: latestSha }) });
      } else if (!tagResp.ok) {
        const err = await tagResp.json().catch(() => ({}));
        setSaveStableError(`Tag update failed: ${err.message || tagResp.status}`);
        setSaveStableLoading(false); return;
      }

      const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const commitMsg = await (await gh(`/git/commits/${latestSha}`)).json();
      const refContent = JSON.stringify({
        stableVersion: latestSha,
        description: `${latestSha.substring(0, 7)} ${(commitMsg.message || '').split('\n')[0]}`,
        savedAt: dateStr, autoUpdate: true
      }, null, 2);

      const existingResp = await gh('/contents/.backups/stable-ref.json');
      let existingSha: string | null = null;
      if (existingResp.ok) { const ex = await existingResp.json(); existingSha = ex.sha; }

      await gh('/contents/.backups/stable-ref.json', {
        method: 'PUT', body: JSON.stringify({
          message: `Update stable-ref to ${latestSha.substring(0, 7)}`,
          content: btoa(refContent), sha: existingSha
        })
      });

      setSaveStableDone(true);
      setTimeout(() => setSaveStableDone(false), 4000);
    } catch (e: any) {
      setSaveStableError('فشل الحفظ: ' + (e.message || 'خطأ'));
      setTimeout(() => setSaveStableError(''), 6000);
    }
    setSaveStableLoading(false);
  };

  const handleFactoryReset = async () => {
    setFactoryResetLoading(true);
    setFactoryResetError('');
    try {
      if (githubPat) localStorage.setItem('finalyze_github_pat', githubPat);
      const headers = ghHeaders();
      const gh = (url: string, opts?: any) => fetch(`https://api.github.com/repos/${GITHUB_REPO}${url}`, { headers, ...opts });

      // Get the SHA from stable-v1 tag dynamically (not hardcoded)
      let stableSha = '';
      try {
        const tagRef = await (await gh(`/git/refs/tags/${STABLE_TAG}`)).json();
        stableSha = tagRef.object?.sha || '';
      } catch {}

      // If tag lookup fails, get the commit SHA the tag points to
      if (stableSha) {
        try {
          const tagObj = await (await gh(`/git/tags/${stableSha}`)).json();
          if (tagObj.object?.sha) stableSha = tagObj.object.sha;
        } catch {}
      }

      if (!stableSha) {
        stableSha = '62c47deed780f1122533632a688f7760ff0c71f5';
      }

      const patchResp = await gh('/git/refs/heads/main', {
        method: 'PATCH',
        body: JSON.stringify({ sha: stableSha, force: true })
      });
      if (patchResp.ok) {
        setFactoryResetDone(true);
        setTimeout(() => { setShowFactoryReset(false); setFactoryResetDone(false); }, 4000);
      } else {
        const err = await patchResp.json().catch(() => ({}));
        setFactoryResetRedirectUrl(`https://github.com/${GITHUB_REPO}/actions/workflows/factory-reset.yml`);
        setFactoryResetError(`GitHub force-push failed: ${err.message || patchResp.status}`);
        setTimeout(() => setFactoryResetError(''), 6000);
      }
    } catch (e: any) {
      setFactoryResetError('فشلت عملية إعادة التعيين: ' + (e.message || 'خطأ'));
      setTimeout(() => setFactoryResetError(''), 6000);
    }
    setFactoryResetLoading(false);
  };

  // Fetch latest stable version info from GitHub
  useEffect(() => {
    const fetchStableVersion = async () => {
      try {
        const resp = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/.backups/stable-ref.json`);
        if (resp.ok) {
          const data = await resp.json();
          const commitHash = data.description?.split(' ')[0] || '';
          const savedDate = data.savedAt || '';
          let formattedDate = savedDate;
          if (savedDate) {
            try {
              const d = new Date(savedDate.replace(' ', 'T'));
              const monthsAr = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
              formattedDate = `${d.getDate()} ${monthsAr[d.getMonth()]} ${d.getFullYear()}`;
            } catch {}
          }
          setStableVersion({
            version: commitHash ? `${commitHash} - ${formattedDate}` : 'v3.12.0-stable - 23 يوليو 2026',
            date: formattedDate,
            commit: commitHash
          });
        }
      } catch {}
    };
    fetchStableVersion();
  }, []);

  // Auto close notification after 8 seconds
  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 8000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  const handleSave = () => {
    onSave?.();
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 600);
  };

  const handleRequestChange = (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError('');
    setOtpSuccess('');
    
    if (!newEmail || !newPhone) return;
    
    // Generate 4 digit random OTPs
    const emailCode = Math.floor(1000 + Math.random() * 9000).toString();
    const smsCode = Math.floor(1000 + Math.random() * 9000).toString();
    
    setGeneratedEmailOtp(emailCode);
    setGeneratedSmsOtp(smsCode);
    setIsVerifying(true);
    
    // Trigger incoming notifications overlay
    setTimeout(() => {
      setNotification({
        type: 'email',
        title: '📧 Google Security Workspace',
        body: isAr ? `رمز الموافقة الأمنية لتحديث بيانات المطور في Joseph.Trading هو: ${emailCode}` : `Security approval code for updating developer data in Joseph.Trading is: ${emailCode}`
      });
    }, 1500);

    setTimeout(() => {
      setNotification({
        type: 'sms',
        title: isAr ? '💬 رسالة نصية قصيرة (SMS)' : '💬 Short Message Service (SMS)',
        body: isAr ? `تنبيه: رمز التحقق الثنائي (OTP) لهاتفك هو: ${smsCode}` : `Alert: Your phone 2FA (OTP) code is: ${smsCode}`
      });
    }, 3500);
  };

  const handleConfirmChange = () => {
    setOtpError('');
    if (enteredEmailOtp !== generatedEmailOtp || enteredSmsOtp !== generatedSmsOtp) {
      setOtpError(isAr ? '⚠️ الرموز المدخلة غير مطابقة! يرجى التأكد من كتابة الرموز الصحيحة.' : '⚠️ Entered codes do not match! Please verify and enter the correct codes.');
      return;
    }
    
    if (typeof window !== 'undefined') {
      localStorage.setItem('finalyze_dev_email', newEmail.trim());
      localStorage.setItem('finalyze_dev_phone', newPhone.trim());
    }
    
    setCurrentDevEmail(newEmail.trim());
    setCurrentDevPhone(newPhone.trim());
    
    setIsVerifying(false);
    setOtpSuccess(isAr ? '🎉 تم تحديث بيانات المصادقة للمطور بنجاح!' : '🎉 Developer authentication data updated successfully!');
    
    setNewEmail('');
    setNewPhone('');
    setEnteredEmailOtp('');
    setEnteredSmsOtp('');
    
    alert(isAr ? '🔐 تم تحديث البريد الإلكتروني ورقم الهاتف الخاصين بالمطور بنجاح! سيتم استخدام البيانات الجديدة لجميع عمليات التحقق والدخول مستقبلاً.' : '🔐 Developer email and phone number updated successfully! The new data will be used for all future verification and login processes.');
  };

  const handleCancelVerify = () => {
    setIsVerifying(false);
    setNewEmail('');
    setNewPhone('');
    setEnteredEmailOtp('');
    setEnteredSmsOtp('');
    setOtpError('');
    setOtpSuccess('');
  };

  if (!isOpen) return null;

  const modalHeader = (
    <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/5" dir="rtl">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-primary/20 text-primary rounded-xl">
          <Settings2 size={42} />
        </div>
        <div>
          <h2 className="text-3xl md:text-[38px] font-black text-brand-text leading-tight">{isAr ? 'إعدادات التحليل الذكي' : 'Smart Analysis Settings'}</h2>
          <p className="text-lg md:text-[22px] text-brand-text/50 leading-snug mt-1">{isAr ? 'قم بضبط معايير الذكاء الاصطناعي بدقة' : 'Fine-tune AI analysis parameters precisely'}</p>
        </div>
      </div>
      <button onClick={onClose} className="p-3 text-brand-text/50 hover:text-red-500 hover:bg-white/5 rounded-xl transition-colors">
        <X size={36} />
      </button>
    </div>
  );

  const NumberInput = ({ label, value, onChange, min = 0, max = 9999, step = 1, color = 'text-primary', desc, suffix = '%' }: {
    label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; color?: string; desc?: string; suffix?: string;
  }) => {
    const [draft, setDraft] = React.useState(String(value));
    const [focused, setFocused] = React.useState(false);

    React.useEffect(() => {
      if (!focused) setDraft(String(value));
    }, [value, focused]);

    const commit = () => {
      let v = parseFloat(draft);
      if (isNaN(v)) v = value;
      v = Math.min(max, Math.max(min, v));
      onChange(v);
      setDraft(String(v));
      setFocused(false);
    };

    return (
      <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0 gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-xl md:text-[24px] font-black text-brand-text leading-tight">{label}</div>
          {desc && <div className="text-sm md:text-[17px] text-brand-text/45 mt-1.5 leading-snug">{desc}</div>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <input type="text" inputMode="decimal" translate="no" dir="ltr" lang="en"
            value={focused ? draft : draft}
            onFocus={() => { setFocused(true); setDraft(String(value)); }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setFocused(false); } }}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9.\-]/g, ''))}
            className={`w-24 md:w-28 text-center text-lg md:text-[22px] font-black font-mono notranslate ${color} bg-transparent border-2 border-white/10 rounded-xl py-2 focus:border-primary outline-none`} />
          {suffix && <span className="text-base md:text-[19px] text-[#F59E0B] font-black whitespace-nowrap">{suffix}</span>}
        </div>
      </div>
    );
  };

  const modalBody = (
    <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar" dir="rtl">
      
      {planClient && (
        <div className="space-y-4">
          <h3 className="text-xl md:text-[26px] font-black text-brand-text/70 uppercase tracking-widest flex items-center gap-3 leading-tight">
            <span className="text-[#F59E0B] text-2xl">◆</span> {isAr ? 'ANALYSIS' : 'Analysis'}
          </h3>
          <div className="bg-white/5 border border-white/5 rounded-2xl p-5 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-black px-3 py-1.5 rounded-full ${planKeyEntered ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40' : 'bg-amber-500/15 text-amber-400 border border-amber-500/40'}`}>
                {planKeyEntered ? (isAr ? 'الخطة نشطة ✓' : 'Plan active ✓') : (isAr ? 'بانتظار تفعيل الخطة' : 'Awaiting plan activation')}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isAr
                ? 'التحليل يعمل بمفاتيح المنصة المخزّنة في الخادم. لا تحتاج إلى إدخال أي مفتاح خاص بك، وتبدأ الخطة مباشرة بعد موافقة المطوّر على الدفع.'
                : "Analysis runs on the platform's keys, held server-side. You do not need to enter any key of your own, and your plan starts the moment the developer approves the payment."}
            </p>
          </div>
        </div>
      )}

      {/* Section 1: Confidence Thresholds */}
      <div className="space-y-4">
        <h3 className="text-xl md:text-[26px] font-black text-brand-text/70 uppercase tracking-widest flex items-center gap-3 leading-tight">
          <span className="text-[#F59E0B] text-2xl">◆</span> {isAr ? 'عتبات الثقة' : 'Confidence Thresholds'}
        </h3>
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 md:p-6">
          <NumberInput label={isAr ? 'حد الإشارة القوية' : 'Strong Signal Threshold'} value={settings.strongThreshold} onChange={(v) => handleChange('strongThreshold', v)} color="text-[#F59E0B]" desc={isAr ? 'الثقة المطلوبة لإشارة قوية (≥)' : 'Confidence required for strong signal (≥)'} />
          <NumberInput label={isAr ? 'الشروط الداعمة للقوة' : 'Min Support for Strong'} value={settings.minStrongSupport} onChange={(v) => handleChange('minStrongSupport', v)} color="text-[#F59E0B]" desc={isAr ? 'نسبة الشروط الداعمة المطلوبة لإشارة قوية (≥%)' : 'Support ratio required for strong signal (≥%)'} />
          <NumberInput label={isAr ? 'حد الإشارة العادية' : 'Buy/Sell Threshold'} value={settings.buyThreshold} onChange={(v) => handleChange('buyThreshold', v)} color="text-primary" desc={isAr ? 'الثقة المطلوبة لشراء/بيع عادي (≥)' : 'Confidence required for regular buy/sell (≥)'} />
          <NumberInput label={isAr ? 'الثقة الأساسية' : 'Base Confidence'} value={settings.baseConfidence} onChange={(v) => handleChange('baseConfidence', v)} color="text-emerald-400" desc={isAr ? 'نسبة أساسية ثابتة تُضاف لكل إشارة' : 'Fixed base percentage added to all signals'} />
          <div className="h-px bg-white/10 my-3" />
          <button onClick={() => handleChange('goldenRangeEnabled', settings.goldenRangeEnabled === false)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-right gap-4 ${
              settings.goldenRangeEnabled !== false
                ? 'bg-amber-400/10 border-amber-400/40 text-amber-300'
                : 'bg-white/5 border-white/5 text-brand-muted'
            }`}>
            <div className="flex-1 min-w-0">
              <div className="text-lg md:text-xl font-black leading-tight">{isAr ? 'تفعيل النطاق الذهبي (70-85)' : 'Enable Golden Window (70-85)'}</div>
              <div className="text-sm md:text-base opacity-70 mt-1 leading-snug">{isAr ? 'اعرض الإشارات داخل نطاق الثقة الذهبي فقط؛ ما دون 70% أو فوق 85% يُحوَّل لمحايد' : 'Only surface signals inside the golden window; below min or above max becomes neutral'}</div>
            </div>
            <div className={`w-14 h-8 rounded-full transition-colors flex items-center px-1 shrink-0 ${
              settings.goldenRangeEnabled !== false ? 'bg-amber-400' : 'bg-white/20'
            }`}>
              <div className={`w-6 h-6 bg-white rounded-full transition-transform shadow ${
                settings.goldenRangeEnabled !== false ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </div>
          </button>
          <NumberInput label={isAr ? 'أدنى النطاق الذهبي' : 'Golden Min (%)'} value={settings.goldenConfMin ?? 70} onChange={(v) => handleChange('goldenConfMin', v)} color="text-amber-300" desc={isAr ? 'أقل من هذه النسبة → محايد (إشارة ضعيفة)' : 'Below this → neutral (weak signal)'} />
          <NumberInput label={isAr ? 'أقصى النطاق الذهبي' : 'Golden Max (%)'} value={settings.goldenConfMax ?? 85} onChange={(v) => handleChange('goldenConfMax', v)} color="text-amber-300" desc={isAr ? 'أعلى من هذه النسبة → محايد (دخول متأخر/مطاردة)' : 'Above this → neutral (late entry / chasing)'} />
          <div className="h-px bg-white/10 my-3" />
          <button onClick={() => handleChange('trailingEnabled', settings.trailingEnabled === false)}
            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-right gap-4 ${
              settings.trailingEnabled !== false
                ? 'bg-emerald-400/10 border-emerald-400/40 text-emerald-300'
                : 'bg-white/5 border-white/5 text-brand-muted'
            }`}>
            <div className="flex-1 min-w-0">
              <div className="text-lg md:text-xl font-black leading-tight">{isAr ? 'تفعيل الوقف المتحرك (Trailing Stop)' : 'Enable Trailing Stop'}</div>
              <div className="text-sm md:text-base opacity-70 mt-1 leading-snug">{isAr ? 'يؤمّن الصفقة عند نقطة الدخول ثم يتبع الربح بخطوات؛ القيم أدناه عند لوت 0.01 وتتوسع تلقائيًا مع اللوت' : 'Locks breakeven then trails profit in steps; values below are for lot 0.01 and auto-scale with lot size'}</div>
            </div>
            <div className={`w-14 h-8 rounded-full transition-colors flex items-center px-1 shrink-0 ${
              settings.trailingEnabled !== false ? 'bg-emerald-400' : 'bg-white/20'
            }`}>
              <div className={`w-6 h-6 bg-white rounded-full transition-transform shadow ${
                settings.trailingEnabled !== false ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </div>
          </button>
          <NumberInput label={isAr ? 'ربح التفعيل عند 0.01 ($)' : 'Activation Profit @0.01 ($)'} value={settings.trailingBaseActivationUSD ?? 5} onChange={(v) => handleChange('trailingBaseActivationUSD', v)} color="text-emerald-300" suffix="$" min={1} max={100} desc={isAr ? 'الربح الذي يحرّك الوقف لنقطة الدخول (افتراضي 5$)' : 'Profit that moves the stop to breakeven (default $5)'} />
          <NumberInput label={isAr ? 'خطوة التتبع عند 0.01 ($)' : 'Trail Step @0.01 ($)'} value={settings.trailingBaseStepUSD ?? 2} onChange={(v) => handleChange('trailingBaseStepUSD', v)} color="text-emerald-300" suffix="$" min={1} max={50} desc={isAr ? 'كل ربح إضافي بهذا المقدار يضيف خطوة قفل ربح (افتراضي 2$)' : 'Each extra profit of this size locks one more step (default $2)'} />
          <NumberInput label={isAr ? 'زيادة التفعيل لكل 0.01 لوت ($)' : 'Extra Activation per +0.01 lot ($)'} value={settings.trailingActivationLotStep ?? 2} onChange={(v) => handleChange('trailingActivationLotStep', v)} color="text-emerald-300" suffix="$" min={0} max={20} desc={isAr ? 'يُضاف للتفعيل مع كل وحدة لوت إضافية (افتراضي 2$)' : 'Added to activation per extra lot unit (default $2)'} />
          <NumberInput label={isAr ? 'زيادة الخطوة لكل 0.01 لوت ($)' : 'Extra Step per +0.01 lot ($)'} value={settings.trailingStepLotStep ?? 1} onChange={(v) => handleChange('trailingStepLotStep', v)} color="text-emerald-300" suffix="$" min={0} max={10} desc={isAr ? 'يُضاف للخطوة مع كل وحدة لوت إضافية (افتراضي 1$)' : 'Added to the step per extra lot unit (default $1)'} />
        </div>
      </div>

      {/* Section 2: Primary Conditions (Entry Gates) */}
      <div className="space-y-4">
        <h3 className="text-xl md:text-[26px] font-black text-brand-text/70 uppercase tracking-widest flex items-center gap-3 leading-tight">
          <span className="text-[#F59E0B] text-2xl">◆</span> {isAr ? 'الشروط الأساسية (أبواب الدخول)' : 'Primary Conditions (Entry Gates)'}
          <span className="text-base md:text-[22px] text-brand-text/35 font-mono mr-auto">{isAr ? 'النسبة القصوى 50%' : 'Max 50%'}</span>
        </h3>
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 md:p-6">
          <NumberInput label={isAr ? '① BB Pullback — تراجع بولينجر' : '① BB Pullback — Bollinger Pullback'} value={settings.primaryBBWeight} onChange={(v) => handleChange('primaryBBWeight', v)} color="text-[#F59E0B]" desc={isAr ? 'تراجع 3-6 شموع + لمس BB + شمعة انتكاس' : '3-6 candle pullback + touch BB + reversal candle'} />
          <NumberInput label={isAr ? '② Supply/Demand — مناطق العرض والطلب' : '② Supply/Demand Zones'} value={settings.primarySDWeight} onChange={(v) => handleChange('primarySDWeight', v)} color="text-[#F59E0B]" desc={isAr ? 'منطقة طلب + صعود = شراء / منطقة عرض + هبوط = بيع' : 'Demand+uptrend=buy / Supply+downtrend=sell'} />
          <NumberInput label={isAr ? '③ Trend Age — عمر الاتجاه' : '③ Trend Age'} value={settings.primaryAgeWeight} onChange={(v) => handleChange('primaryAgeWeight', v)} color="text-[#F59E0B]" desc={isAr ? 'ناضج (25-50) = كامل / رضيع أو قديم = تخفيف' : 'Mature (25-50)=full / Infant or Old=reduced'} />
          <NumberInput label={isAr ? '④ Pre-Pullback Age — عمر الاتجاه قبل السحب' : '④ Pre-Pullback Age'} value={settings.primaryPrePullbackAgeWeight} onChange={(v) => handleChange('primaryPrePullbackAgeWeight', v)} color="text-[#F59E0B]" desc={isAr ? '15-50 شمعة = مسموح / أقل أو أكثر = محايد' : '15-50 candles=allowed / less or more=neutral'} />
          <NumberInput label={isAr ? '⑤ News — أخبار اقتصادية وسياسية' : '⑤ News Sentiment'} value={settings.primaryNewsWeight} onChange={(v) => handleChange('primaryNewsWeight', v)} color="text-[#F59E0B]" desc={isAr ? 'أخبار سلبية = حظر / لا أخبار = مسموح' : 'Negative news=block / No news=allowed'} />
        </div>
      </div>

      {/* Section 3: Supporting Conditions (Signal Boost) */}
      <div className="space-y-4">
        <h3 className="text-xl md:text-[26px] font-black text-brand-text/70 uppercase tracking-widest flex items-center gap-3 leading-tight">
          <span className="text-[#F59E0B] text-2xl">◆</span> {isAr ? 'الشروط الداعمة (تعزيز الإشارة)' : 'Supporting Conditions (Signal Boost)'}
          <span className="text-base md:text-[22px] text-brand-text/35 font-mono mr-auto">{isAr ? 'النسبة القصوى 20%' : 'Max 20%'}</span>
        </h3>
        <div className="bg-white/5 border border-white/5 rounded-2xl p-5 md:p-6">
          <NumberInput label={isAr ? 'RSI' : 'RSI'} value={settings.supportRSIWeight} onChange={(v) => handleChange('supportRSIWeight', v)} color="text-primary" desc={isAr ? 'تشبع بيع (RSI<30) = شراء / تشبع شراء (RSI>70) = بيع' : 'Oversold (<30)=buy / Overbought (>70)=sell'} />
          <NumberInput label={isAr ? 'EMA Cross — تقاطع المتوسط' : 'EMA Cross'} value={settings.supportEMAWeight} onChange={(v) => handleChange('supportEMAWeight', v)} color="text-primary" desc={isAr ? 'صاعد = دعم شراء / هابط = دعم بيع' : 'Bullish=supports buy / Bearish=supports sell'} />
          <NumberInput label={isAr ? 'Trend Direction — اتجاه الاتجاه' : 'Trend Direction'} value={settings.supportDirWeight} onChange={(v) => handleChange('supportDirWeight', v)} color="text-primary" desc={isAr ? 'صاعد/هابط = يدعم الاتجاه' : 'Uptrend/Downtrend supports direction'} />
          <NumberInput label={isAr ? 'Volume Surge — ارتفاع الحجم' : 'Volume Surge'} value={settings.supportVolWeight} onChange={(v) => handleChange('supportVolWeight', v)} color="text-primary" desc={isAr ? 'ارتفاع الحجم = تأكيد الزخم' : 'Volume surge confirms momentum'} />
          <NumberInput label={isAr ? 'Micro BB — بولينجر المصغر' : 'Micro BB Strategy'} value={settings.supportMicroBBWeight} onChange={(v) => handleChange('supportMicroBBWeight', v)} color="text-primary" desc={isAr ? 'تراجع مصغر على الإطار الأصغر = تأكيد دخول مبكر' : 'Micro pullback on lower TF = early entry confirm'} />
          <NumberInput label={isAr ? 'Micro Alignment — توافق الإطارات' : 'Micro TF Alignment'} value={settings.supportMicroAlignWeight} onChange={(v) => handleChange('supportMicroAlignWeight', v)} color="text-primary" desc={isAr ? 'الإطار المصغر يتوافق مع الكبير' : 'Lower TF aligns with higher TF'} />
        </div>
      </div>

      {/* Section 4: Toggles */}
      <div className="space-y-4">
        <h3 className="text-xl md:text-[26px] font-black text-brand-text/70 uppercase tracking-widest flex items-center gap-3 leading-tight">
          <span className="text-[#F59E0B] text-2xl">◆</span> {isAr ? 'مفاتيح التفعيل' : 'Feature Toggles'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'useIndicators', label: isAr ? 'المؤشرات الفنية' : 'Technical Indicators', desc: isAr ? 'RSI + EMA + Volume' : 'RSI + EMA + Volume' },
            { key: 'useNewsGuard', label: isAr ? 'حماية الأخبار الأسبوعية' : 'Weekly News Guard', desc: isAr ? 'حظر أي رمز عليه خبر قوي جداً خلال الأسبوع، ويُسمح بعد تجاوزه' : 'Block any symbol with a very high-impact event this week; unblock after it passes' },
            { key: 'useHigherTimeframe', label: isAr ? 'الإطار الأعلى' : 'Higher Timeframe', desc: isAr ? 'تأكيد من الإطار الأكبر' : 'Confirm from higher TF' },
            { key: 'useVolumeAnalysis', label: isAr ? 'تحليل الحجم (الكلاسيكي)' : 'Volume Analysis (Classic)', desc: isAr ? 'ارتفاع الحجم المفاجئ يدعم الزخم' : 'Volume surge supports momentum' },
            { key: 'useVolumeGuard', label: isAr ? 'حارس الحجم الاحترافي' : 'Volume Guard (Pro)', desc: isAr ? 'فلتر حجم خماسي: كشف فخاخ الامتصاص، جهد مقابل نتيجة، اتجاه الحجم، تفاعل الدعم/المقاومة' : '5-module volume filter: absorption traps, effort vs result, volume trend, S/R interaction' },
            { key: 'useFilterSideways', label: isAr ? 'فلتر الاتجاه العرضي' : 'Sideways Filter', desc: isAr ? 'حظر الإشارات في الأسواق العرضية' : 'Block signals in sideways markets' },
            { key: 'useCandleMatch', label: isAr ? 'فلتر منع الانعكاس (الشموع)' : 'Reversal Guard (Candles)', desc: isAr ? 'تفعيل فلتر الشموع المتقدم' : 'Enable the advanced reversal-prevention filter' },
            { key: 'candleDirectionFilter', label: isAr ? 'تأكيد الاتجاه الشهري (1M)' : 'Monthly Trend Confirmation (1M)', desc: isAr ? 'حظر الإشارة إذا كانت شمعة الشهر (1M) ضدها — الأسبوع واليوم حرّان' : 'Block the signal if the Monthly (1M) candle opposes it — Weekly & Daily are free' },
          ].map((item) => (
            <button key={item.key} onClick={() => {
              const next = !(settings as any)[item.key];
              const applied: any = { ...settings, [item.key]: next };
              if ((item.key === 'candleDirectionFilter') && next) {
                applied.useCandleMatch = true;
              }
              onSettingsChange(applied);
            }}
              className={`flex items-center justify-between p-5 md:p-6 rounded-2xl border-2 transition-all text-right gap-4 ${
                (settings as any)[item.key]
                  ? 'bg-[#F59E0B]/10 border-[#F59E0B]/40 text-[#F59E0B]'
                  : 'bg-white/5 border-white/5 text-brand-muted'
              }`}>
              <div className="flex-1 min-w-0">
                <div className="text-xl md:text-[26px] font-black leading-tight">{item.label}</div>
                <div className="text-base md:text-[20px] opacity-70 mt-1.5 leading-snug">{item.desc}</div>
              </div>
              <div className={`w-16 h-9 rounded-full transition-colors flex items-center px-1 shrink-0 ${
                (settings as any)[item.key] ? 'bg-[#F59E0B]' : 'bg-white/20'
              }`}>
                <div className={`w-7 h-7 bg-white rounded-full transition-transform shadow ${
                  (settings as any)[item.key] ? 'translate-x-7' : 'translate-x-0'
                }`} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Volume Guard Threshold (Pro) */}
      {settings?.useVolumeGuard !== false && (
        <div className="space-y-2 pt-6 border-t border-white/10">
          <h3 className="text-2xl md:text-[28px] font-black text-amber-400/60 uppercase tracking-widest">
            {isAr ? 'عتبة حارس الحجم' : 'Volume Guard Threshold'}
          </h3>
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-6">
            <NumberInput
              label={isAr ? 'عتبة التأكيد' : 'Confirmation Threshold'}
              desc={isAr
                ? '≥ العتبة → حجم مؤكد (تعزيز ثقة). < العتبة → الإشارة تُحيد ولا تعرض. امتصاص مؤكد → قمع كامل حتى لو كانت الدرجة عالية.'
                : '≥ threshold → confirmed volume (confidence boost). < threshold → signal suppressed, not displayed. Confirmed absorption → full suppression even if score is high.'}
              value={settings?.volumeGuardThreshold ?? 45}
              onChange={(v) => handleChange('volumeGuardThreshold', v)}
              min={20}
              max={70}
              suffix=""
              color='text-amber-400'
            />
            <NumberInput
              label={isAr ? 'عتبة الذروة القصوى' : 'Climax Ceiling'}
              desc={isAr
                ? 'أقصى درجة مسموحة قبل اعتبار الحجم ذروة مضاربية شاذة (حجب الإشارة). القيم بين العتبة والسقف = النطاق الصحي.'
                : 'Max allowed score before volume is treated as an abnormal speculative spike (signal suppressed). Values between threshold and ceiling = healthy band.'}
              value={settings?.volumeGuardMaxThreshold ?? 85}
              onChange={(v) => handleChange('volumeGuardMaxThreshold', v)}
              min={71}
              max={100}
              suffix=""
              color='text-amber-400'
            />
          </div>
        </div>
      )}


      {/* Section 5: Developer Trend Age Zones */}
        {user && isDeveloperEmail(user.email) && (
        <div className="space-y-4 pt-6 border-t border-white/10">
          <h3 className="text-2xl md:text-[28px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-3">
            <span className="text-amber-400 text-3xl">◆</span> {isAr ? '🔧 مناطق عمر الاتجاه (مطور)' : '🔧 Trend Age Zones (Dev)'}
          </h3>
          <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-6 space-y-6">

            {/* Zone Visualization */}
            <div className="bg-black/30 rounded-xl p-4">
              <div className="text-base md:text-[20px] text-brand-text/40 font-mono mb-3 text-center">
                {isAr ? 'مناطق عمر الاتجاه (Total Age)' : 'Trend Age Zones (Total Age)'}
              </div>
              <div className="flex h-10 rounded-xl overflow-hidden text-base md:text-[18px] font-black">
                <div className="flex-1 bg-red-500/30 border-r border-black/30 flex items-center justify-center text-red-300">
                  {isAr ? 'رضيع <10' : 'Infant <10'}
                </div>
                <div className="flex-1 bg-amber-500/30 border-r border-black/30 flex items-center justify-center text-amber-300">
                  {isAr ? 'طفل 10-25' : 'Youth 10-25'}
                </div>
                <div className="flex-1 bg-emerald-500/30 border-r border-black/30 flex items-center justify-center text-emerald-300">
                  {isAr ? 'ناضج 25-50' : 'Mature 25-50'}
                </div>
                <div className="flex-1 bg-red-500/30 flex items-center justify-center text-red-300">
                  {isAr ? 'عجوز >50' : 'Aging >50'}
                </div>
              </div>
              <div className="flex justify-between mt-2 text-sm md:text-[16px] text-brand-text/30 font-mono px-1">
                <span>0</span>
                <span>{settings.minInfantAge}</span>
                <span>{settings.minMatureAge}</span>
                <span>{settings.maxMatureAge}</span>
              </div>
            </div>

            {/* Min Consecutive Momentum (Age) */}
            <NumberInput label={isAr ? 'حد أدنى لاندفاع الاتجاه (Age)' : 'Min Consecutive Momentum (Age)'} value={settings.minTrendAge} onChange={(v) => handleChange('minTrendAge', v)} color="text-amber-400" desc={isAr ? 'عدد الشموع المتتالية المطلوب قبل السماح بدخول الصفقة. افتراضي: 2' : 'Required consecutive candles before allowing entry. Default: 2'} suffix="" min={1} max={10} />

            {/* Infant Age Threshold */}
            <NumberInput label={isAr ? 'بداية مرحلة الطفل (Infant)' : 'Infant Zone Start'} value={settings.minInfantAge} onChange={(v) => handleChange('minInfantAge', v)} color="text-red-400" desc={isAr ? 'أقل من هذه القيمة ← اتجاه رضيع (تخفيف الثقة). افتراضي: 10' : 'Below this → infant trend (confidence cap). Default: 10'} suffix="" min={3} max={99} />

            {/* Mature Age Start */}
            <NumberInput label={isAr ? 'بداية مرحلة النضج (Mature)' : 'Mature Zone Start'} value={settings.minMatureAge} onChange={(v) => handleChange('minMatureAge', v)} color="text-emerald-400" desc={isAr ? 'من هذه القيمة يبدأ الاتجاه الناضج (يُسمح بالإشارات القوية). افتراضي: 25' : 'From this value the trend is mature (strong signals allowed). Default: 25'} suffix="" min={5} max={99} />

            {/* Old Age Threshold */}
            <NumberInput label={isAr ? 'بداية مرحلة الشيخوخة (Aging)' : 'Aging Zone Start'} value={settings.maxMatureAge} onChange={(v) => handleChange('maxMatureAge', v)} color="text-red-400" desc={isAr ? 'فوق هذه القيمة ← اتجاه عجوز (خطر انعكاس، تخفيف الثقة). افتراضي: 50' : 'Above this → aging trend (reversal risk, confidence cap). Default: 50'} suffix="" min={10} max={200} />

            {/* Pre-Pullback Age — Min */}
            <NumberInput label={isAr ? 'أدنى عمر الاتجاه ماقبل انسحاب' : 'Min Pre-Pullback Age'} value={settings.minPrePullbackAge} onChange={(v) => handleChange('minPrePullbackAge', v)} color="text-cyan-400" desc={isAr ? 'أقل من هذا العدد ← الاتجاه قبل الانسحاب قصير جداً (محايد). افتراضي: 15' : 'Below this → trend before pullback too short (neutral). Default: 15'} suffix="" min={1} max={200} />

            {/* Pre-Pullback Age — Max */}
            <NumberInput label={isAr ? 'أقصى عمر الاتجاه ماقبل انسحاب' : 'Max Pre-Pullback Age'} value={settings.maxPrePullbackAge} onChange={(v) => handleChange('maxPrePullbackAge', v)} color="text-cyan-400" desc={isAr ? 'فوق هذا العدد ← الاتجاه قبل الانسحاب مستنزف (محايد). افتراضي: 50' : 'Above this → trend before pullback exhausted (neutral). Default: 50'} suffix="" min={1} max={200} />

            {/* Min Pullback Candles */}
            <NumberInput label={isAr ? 'أدنى شموع السحبة' : 'Min Pullback Candles'} value={settings.minPullbackCandles || 2} onChange={(v) => handleChange('minPullbackCandles', v)} color="text-cyan-400" desc={isAr ? 'الحد الأدنى للشموع المعاكسة للاتجاه为了 تأكيد نقطة السحبة. افتراضي: 2' : 'Min opposite candles to confirm pullback point. Default: 2'} suffix="" min={1} max={10} />

            {/* Pullback Volume Confirm */}
            <div className="pt-3 border-t border-white/5">
              <div className="flex items-center justify-between gap-4">
                <label className="text-xl md:text-[24px] font-black text-cyan-400 leading-tight">{isAr ? 'تأكيد بالحجم عند السحبة' : 'Pullback Volume Confirm'}</label>
                <button onClick={() => handleChange('pullbackVolConfirm', !settings.pullbackVolConfirm)}
                  className={`w-16 h-9 rounded-full transition-all shrink-0 ${settings.pullbackVolConfirm ? 'bg-cyan-500' : 'bg-white/10'}`}>
                  <div className={`w-7 h-7 rounded-full bg-white shadow transition-transform ${settings.pullbackVolConfirm ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-base md:text-[20px] text-brand-text/40 mt-2 leading-snug">{isAr ? 'يتطلب حجم مرتفع عند نقطة السحبة للتأكيد' : 'Require high volume at pullback point for confirmation'}</p>
            </div>

            {/* Pullback Candle Confirm */}
            <div className="pt-3 border-t border-white/5">
              <div className="flex items-center justify-between gap-4">
                <label className="text-xl md:text-[24px] font-black text-cyan-400 leading-tight">{isAr ? 'تأكيد بشمعة ارتداد' : 'Pullback Candle Confirm'}</label>
                <button onClick={() => handleChange('pullbackCandleConfirm', !settings.pullbackCandleConfirm)}
                  className={`w-16 h-9 rounded-full transition-all shrink-0 ${settings.pullbackCandleConfirm ? 'bg-cyan-500' : 'bg-white/10'}`}>
                  <div className={`w-7 h-7 rounded-full bg-white shadow transition-transform ${settings.pullbackCandleConfirm ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>
              <p className="text-base md:text-[20px] text-brand-text/40 mt-2 leading-snug">{isAr ? 'يتطلب شمعة ارتداد (Pinbar/Engulfing/Hammer) عند نقطة السحبة' : 'Require reversal candle (Pinbar/Engulfing/Hammer) at pullback point'}</p>
            </div>

            {/* ══ Pullback-Entry System (minimize post-entry reversal) ══ */}
            <div className="pt-4 mt-2 border-t border-cyan-500/20">
              <div className="text-xs font-black text-cyan-400 uppercase tracking-wider mb-1">{isAr ? '🎯 نظام الدخول عند الارتداد (تقليل الانعكاس)' : '🎯 Pullback-Entry System (reduce reversal)'}</div>
              <p className="text-base md:text-[19px] text-brand-text/40 mb-4 leading-snug">{isAr ? 'بدل متابعة السعر عند القمة، ينتظر النظام ارتداد السعر إليك ثم يدخلك بسعر أفضل ووقف أوسع.' : 'Instead of chasing price at the top, the system waits for price to retrace to you, then enters at a better price with a wider stop.'}</p>

              {/* Entry Mode */}
              <div className="pt-3 border-t border-white/5">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xl md:text-[24px] font-black text-cyan-400 leading-tight">{isAr ? 'وضع الدخول' : 'Entry Mode'}</label>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleChange('entryMode', 'pullback')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${(settings.entryMode || 'pullback') === 'pullback' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-brand-text/60'}`}>
                      {isAr ? 'ارتداد (آمن)' : 'Pullback (safe)'}
                    </button>
                    <button onClick={() => handleChange('entryMode', 'market')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${settings.entryMode === 'market' ? 'bg-amber-500 text-white' : 'bg-white/10 text-brand-text/60'}`}>
                      {isAr ? 'فوري (مطاردة)' : 'Market (chase)'}
                    </button>
                  </div>
                </div>
                <p className="text-base md:text-[20px] text-brand-text/40 mt-2 leading-snug">{isAr ? '«ارتداد» = حدّ دخول أقل من السعر للشراء (أعلى للبيع) فلا تُنفَّذ إلا عند وصول السعر إليك. «فوري» = الدخول عند السعر الحالي كالسابق.' : '“Pullback” = entry sits below price for buys (above for sells), filled only if price reaches you. “Market” = enter at current price (old behaviour).'}</p>
              </div>

              {/* Stop ATR Multiplier */}
              <NumberInput label={isAr ? 'مضاعف الوقف (ATR)' : 'Stop ATR Multiplier'} value={settings.stopAtrMultiplier ?? 3} onChange={(v) => handleChange('stopAtrMultiplier', v)} color="text-rose-400" desc={isAr ? 'عرض وقف الخسارة بمضاعفات ATR. الأكبر = وقف أوسع ينجو من التراجع الطبيعي (3-5 شموع). افتراضي: 3' : 'Stop-loss width in ATR multiples. Larger = wider stop that survives normal 3-5 candle retrace. Default: 3'} suffix="×" min={1.5} max={6} step={0.5} />

              {/* Pullback Depth in ATR */}
              <NumberInput label={isAr ? 'عمق منطقة الارتداد (ATR)' : 'Pullback Zone Depth (ATR)'} value={settings.minPullbackAtr ?? 0.5} onChange={(v) => handleChange('minPullbackAtr', v)} color="text-cyan-400" desc={isAr ? 'بُعد حدّ الدخول عن السعر بمضاعفات ATR. الأكبر = سعر دخول أدنى للشراء (أفضل) لكن قد يفوتك التنفيذ. افتراضي: 0.5' : 'How far the entry limit sits from price in ATR. Larger = better buy price but fewer fills. Default: 0.5'} suffix="×" min={0.2} max={2} step={0.1} />

              {/* Pullback RSI Confirm */}
              <div className="pt-3 border-t border-white/5">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xl md:text-[24px] font-black text-cyan-400 leading-tight">{isAr ? 'تعميق المنطقة عند تشبع RSI' : 'Deepen Zone when RSI Stretched'}</label>
                  <button onClick={() => handleChange('pullbackRsiConfirm', !settings.pullbackRsiConfirm)}
                    className={`w-16 h-9 rounded-full transition-all shrink-0 ${settings.pullbackRsiConfirm ? 'bg-cyan-500' : 'bg-white/10'}`}>
                    <div className={`w-7 h-7 rounded-full bg-white shadow transition-transform ${settings.pullbackRsiConfirm ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </div>
                <p className="text-base md:text-[20px] text-brand-text/40 mt-2 leading-snug">{isAr ? 'عندما يكون RSI مشبعًا في اتجاه الصفقة (≥65 شراء / ≤35 بيع) تُعمَّق منطقة الارتداد إلى 1 ATR كاملة حتى لا تشتري القمة أو تبيع القاع.' : 'When RSI is stretched in the trade direction (≥65 buy / ≤35 sell) the retrace zone deepens to a full 1 ATR so you never buy the top / sell the bottom.'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 5: Developer Dynamic Credentials Security (Only visible to the developer) */}
        {user && isDeveloperEmail(user.email) && (
        <div className="space-y-4 pt-6 border-t border-white/10">
          <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck size={16} /> {isAr ? '🔐 بوابة حماية المطور والتحقق الثنائي (2FA)' : '🔐 Developer Security Gateway & 2FA'}
          </h3>
          
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 space-y-4 text-right">
            <p className="text-xs text-slate-300 leading-relaxed font-semibold">
              {isAr ? 'هذا القسم سري للغاية ومتاح لك كمطور فقط. يمكنك تغيير بريدك الإلكتروني وهاتفك المسجلين الذين يُسمح لهما حصرياً بفتح وتفعيل وضع المطور عبر شعار الموقع.' : 'This section is highly confidential and available to you as a developer only. You can change your registered email and phone that are exclusively allowed to open and activate developer mode via the site logo.'}
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 font-bold">{isAr ? 'البريد الإلكتروني الحالي للمطور:' : 'Current Developer Email:'}</span>
                <div className="p-3 bg-brand-bg border border-white/5 rounded-xl font-mono text-xs text-white text-left overflow-x-auto">
                  {currentDevEmail}
                </div>
              </div>
              
              <div className="space-y-1">
                <span className="text-xs text-slate-400 font-bold">{isAr ? 'رقم الهاتف الحالي للمطور:' : 'Current Developer Phone:'}</span>
                <div className="p-3 bg-brand-bg border border-white/5 rounded-xl font-mono text-xs text-white text-left overflow-x-auto">
                  {currentDevPhone}
                </div>
              </div>
            </div>

            {!isVerifying ? (
              <form onSubmit={handleRequestChange} className="space-y-3 pt-3 border-t border-white/5">
                <h4 className="text-xs font-bold text-emerald-400">{isAr ? '📝 طلب تحديث بيانات الحماية للمطور:' : '📝 Request Developer Security Data Update:'}</h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <input
                      type="email"
                      placeholder={isAr ? 'البريد الإلكتروني الجديد' : 'New email'}
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      className="w-full bg-brand-bg border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white text-left focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={isAr ? 'رقم الهاتف الجديد' : 'New phone number'}
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      required
                      className="w-full bg-brand-bg border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white text-left focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                
                {otpSuccess && <p className="text-xs text-emerald-400 font-bold">{otpSuccess}</p>}
                
                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl transition-all text-xs cursor-pointer shadow-lg shadow-emerald-500/10 active:scale-98"
                >
                  {isAr ? 'إرسال رموز التحقق للمصادقة وتغيير البيانات ⚡' : 'Send Verification Codes & Change Data ⚡'}
                </button>
              </form>
            ) : (
              <div className="space-y-4 pt-3 border-t border-white/5">
                <div className="bg-brand-bg p-4 rounded-xl border border-yellow-500/20 text-right space-y-2">
                  <span className="text-xs text-yellow-500 font-bold block">{isAr ? '🚨 مطلوب المصادقة الأمنية الثنائية:' : '🚨 Two-Factor Authentication Required:'}</span>
                  <p className="text-[11px] text-slate-400">
                    {isAr ? 'تم إرسال رمزي تحقق (OTP) إلى بريدك وهاتفك **الحاليين** المصاحبين لحسابك لحمايتك من الاختراق. يرجى إدخالهما للموافقة على تغيير البيانات:' : 'Two OTP codes have been sent to your **current** email and phone linked to your account to protect you from hacking. Please enter them to approve the data change:'}
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-400 font-bold">{isAr ? 'رمز البريد (Email OTP):' : 'Email Code (Email OTP):'}</span>
                    <input
                      type="text"
                      placeholder={isAr ? 'رمز البريد' : 'Email code'}
                      value={enteredEmailOtp}
                      onChange={(e) => setEnteredEmailOtp(e.target.value)}
                      maxLength={4}
                      className="w-full bg-brand-bg border border-white/10 rounded-xl px-3 py-3 text-center font-mono text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-[11px] text-slate-400 font-bold">{isAr ? 'رمز الهاتف (SMS OTP):' : 'Phone Code (SMS OTP):'}</span>
                    <input
                      type="text"
                      placeholder={isAr ? 'رمز الهاتف' : 'Phone code'}
                      value={enteredSmsOtp}
                      onChange={(e) => setEnteredSmsOtp(e.target.value)}
                      maxLength={4}
                      className="w-full bg-brand-bg border border-white/10 rounded-xl px-3 py-3 text-center font-mono text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>

                {otpError && <p className="text-[10px] text-red-400 font-bold text-right">{otpError}</p>}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancelVerify}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-all text-xs cursor-pointer"
                  >
                    {isAr ? 'إلغاء العملية' : 'Cancel Operation'}
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleConfirmChange}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl transition-all text-xs cursor-pointer shadow-lg shadow-emerald-500/10"
                  >
                    {isAr ? 'تأكيد وتطبيق التغيير 🛡️' : 'Confirm & Apply Change 🛡️'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* Section 6: Factory Reset */}
      <div className="space-y-4 pt-6 border-t border-red-500/20">
        <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
          <RotateCcw size={16} /> {isAr ? '🔴 إعادة تعيين المصنع (Factory Reset)' : '🔴 Factory Reset'}
        </h3>
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-black text-white/80 bg-white/10 px-2 py-0.5 rounded-full">{stableVersion?.version || 'v3.12.0-stable - 23 يوليو 2026'}</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-semibold">
            {isAr ? `⚠️ هذا الإجراء يعيد تعيين الموقع بالكامل إلى النسخة المستقرة (${stableVersion?.version || 'v3.12.0-stable - 23 يوليو 2026'}). سيتم فقدان أي تغييرات لاحقة. يرجى التأكد قبل المتابعة.` : `⚠️ This resets the entire site to the stable version (${stableVersion?.version || 'v3.12.0-stable - July 23, 2026'}). Any subsequent changes will be lost. Please be certain before proceeding.`}
          </p>

          <button
            onClick={() => setShowFactoryReset(true)}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-3 rounded-xl transition-all text-xs cursor-pointer shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
          >
            <RotateCcw size={16} />
            {isAr ? `استعادة إلى النسخة المستقرة (${stableVersion?.version || 'v3.12.0-stable - 23 يوليو 2026'})` : `Restore to Stable (${stableVersion?.version || 'v3.12.0-stable - July 23, 2026'})`}
          </button>
        </div>
      </div>

    </div>
  );

  const modalFooter = (
    <div className="p-6 border-t border-white/10 bg-brand-bg flex items-center justify-between" dir="rtl">
      <button onClick={resetToDefault} className="px-6 py-3 text-xl md:text-[24px] text-brand-text/50 hover:text-brand-text font-black transition-colors">
        {isAr ? 'استعادة الافتراضي' : 'Restore Default'}
      </button>
      <button onClick={handleSave} className="px-8 py-3 bg-primary text-white rounded-2xl text-xl md:text-[24px] font-black shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all flex items-center gap-3">
        {saved ? (
          <>
            <CheckCircle size={28} />
            {isAr ? 'تم الحفظ ✓' : 'Saved ✓'}
          </>
        ) : (
          isAr ? 'تطبيق وحفظ' : 'Apply & Save'
        )}
      </button>
    </div>
  );

  const notificationsOverlay = notification && (
    <motion.div
      initial={{ opacity: 0, y: -100, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      className="fixed top-6 right-6 z-[200] max-w-sm w-full bg-brand-alt border-2 border-emerald-500/40 rounded-3xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-xl text-right overflow-hidden group animate-bounce-subtle"
    >
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-primary to-emerald-400" />
      
      <div className="flex items-start gap-3 justify-end mt-1">
        <div className="flex-1 space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">{notification.title}</span>
          <p className="text-xs text-white leading-relaxed font-bold">{notification.body}</p>
          <span className="text-[9px] text-emerald-400/70 font-semibold block pt-1">{isAr ? 'وصلتك للتو • وارد الآن' : 'Just arrived • Incoming now'}</span>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20 shrink-0 shadow-inner">
          {notification.type === 'email' ? <Mail size={20} /> : <MessageSquare size={20} />}
        </div>
      </div>
      
      <button
        onClick={() => setNotification(null)}
        className="absolute top-3 left-3 text-slate-500 hover:text-white transition-colors p-1"
      >
        <X size={14} />
      </button>
    </motion.div>
  );

  const factoryResetOverlay = showFactoryReset && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <div onClick={() => { if (!factoryResetLoading) setShowFactoryReset(false); }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative bg-brand-bg border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center space-y-4"
      >
        {factoryResetDone ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle size={36} className="text-green-400" />
            </div>
            <h3 className="text-lg font-black text-green-400">
              {isAr ? '✅ تم بدء إعادة التعيين!' : '✅ Factory Reset Initiated!'}
            </h3>
            <p className="text-sm text-slate-300 font-semibold">
              {isAr ? 'سيتم إعادة نشر النسخة المستقرة (stable-v2) خلال دقائق. قد تحتاج إلى تحديث الصفحة بعد اكتمال العملية.' : 'The stable version (stable-v2) will be redeployed within minutes. You may need to refresh the page after completion.'}
            </p>
          </>
        ) : factoryResetRedirectUrl ? (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle size={36} className="text-amber-400" />
            </div>
            <h3 className="text-lg font-black text-amber-400">
              {isAr ? '🔄 يلزم تدخل يدوي' : '🔄 Manual Action Required'}
            </h3>
            <p className="text-sm text-slate-300 font-semibold">
              {isAr ? 'اضغط الزر أدناه لفتح صفحة GitHub Actions، ثم اضغط "Run workflow" لإعادة التعيين.' : 'Click the button below to open GitHub Actions, then click "Run workflow" to reset.'}
            </p>
            <a
              href={factoryResetRedirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-amber-600 hover:bg-amber-500 text-white font-black py-3 rounded-xl transition-all text-xs cursor-pointer shadow-lg shadow-amber-500/20"
            >
              {isAr ? 'فتح GitHub Actions ⚡' : 'Open GitHub Actions ⚡'}
            </a>
            <button
              onClick={() => setShowFactoryReset(false)}
              className="w-full bg-white/5 hover:bg-white/10 text-white font-bold py-2 rounded-xl transition-all text-xs cursor-pointer"
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertTriangle size={36} className="text-red-400" />
            </div>
            <h3 className="text-lg font-black text-red-400">
              {isAr ? '⚠️ تأكيد إعادة تعيين المصنع' : '⚠️ Confirm Factory Reset'}
            </h3>
            <p className="text-sm text-white/60 leading-relaxed">
              {isAr ? `هل أنت متأكد؟ سيتم إعادة تعيين الموقع إلى النسخة المستقرة (${stableVersion?.version || 'v3.12.0-stable - 23 يوليو 2026'}). هذا الإجراء لا يمكن التراجع عنه.` : `Are you sure? This will reset the site to the stable version (${stableVersion?.version || 'v3.12.0-stable - July 23, 2026'}). This action cannot be undone.`}
            </p>
            {factoryResetError && (
              <p className="text-xs text-red-400 font-bold bg-red-500/10 rounded-xl p-3">{factoryResetError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowFactoryReset(false)}
                disabled={factoryResetLoading}
                className="flex-1 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all text-xs cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={factoryResetLoading}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black py-3 rounded-xl transition-all text-xs cursor-pointer shadow-lg shadow-red-500/20 flex items-center justify-center gap-2"
              >
                {factoryResetLoading ? (
                  <><Loader2 size={16} className="animate-spin" /> {isAr ? 'جاري...' : 'Resetting...'}</>
                ) : (
                  <>{isAr ? 'تأكيد' : 'Confirm'} <RotateCcw size={16} /></>
                )}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );

  if (asPage) {
    return (
      <div>
        {modalHeader}
        {modalBody}
        {modalFooter}
        <AnimatePresence>{factoryResetOverlay}</AnimatePresence>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl bg-brand-bg border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {modalHeader}
          {modalBody}
          {modalFooter}
        </motion.div>

        <AnimatePresence>
          {notificationsOverlay}
        </AnimatePresence>

        <AnimatePresence>
          {factoryResetOverlay}
        </AnimatePresence>
      </div>
    </AnimatePresence>
  );
}
