import { useEffect, useState } from 'react';
import { Crown, X, RefreshCcw, TimerReset, Zap, CalendarCheck, Hourglass, Trash2, AlertTriangle, ChevronRight, Copy } from 'lucide-react';
import { isMirrorEnabled, setMirrorEnabled } from '../services/tradeMirror';

interface MyPlanModalProps {
  lang: 'ar' | 'en';
  plan: { label: string; amount: number; expiryDate: string; firstReleasedAt?: string | null } | null;
  features: string[];
  paidMode?: boolean;
  onClose: () => void;
  onReturnToFree: () => void;
  onActivate?: () => void;
  onDeletePlan?: () => void;
  email?: string;
  /** Render as a full page instead of a floating modal. */
  asPage?: boolean;
}

const gmt = (iso?: string | null) =>
  iso && isFinite(new Date(iso).getTime())
    ? new Date(iso).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false })
    : '';

// Live countdown in whole days / hours / minutes so a renewal is visibly
// counting down instead of showing a single static number of days.
function useCountdown(target?: string | null) {
  const compute = () => (target && isFinite(new Date(target).getTime()) ? new Date(target).getTime() - Date.now() : NaN);
  const [ms, setMs] = useState<number>(compute);
  useEffect(() => {
    setMs(compute());
    const t = setInterval(() => setMs(compute()), 30_000);
    return () => clearInterval(t);
  }, [target]);
  if (!isFinite(ms)) return null;
  const past = ms <= 0;
  const abs = Math.abs(ms);
  return {
    past,
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
  };
}

export default function MyPlanModal({ lang, plan, features, paidMode = true, onClose, onReturnToFree, onActivate, onDeletePlan, email, asPage = false }: MyPlanModalProps) {
  const isAr = lang === 'ar';
  const [confirmDelete, setConfirmDelete] = useState(false);
  // نسخ صفقات المطور — مفتاح اشتراك العميل في المزامنة التلقائية.
  const [mirrorOn, setMirrorOn] = useState<boolean>(() => isMirrorEnabled());
  useEffect(() => {
    const onChange = (e: Event) => {
      try { setMirrorOn((e as CustomEvent)?.detail?.on ?? isMirrorEnabled()); } catch {}
    };
    try { window.addEventListener('finalyze-mirror-changed', onChange as EventListener); } catch {}
    return () => { try { window.removeEventListener('finalyze-mirror-changed', onChange as EventListener); } catch {} };
  }, []);
  const left = useCountdown(plan?.expiryDate);
  if (!plan) return null;

  const hasPeriod = !!gmt(plan.expiryDate);
  const firstRelease = gmt(plan.firstReleasedAt);
  const expired = !!(left && left.past);

  const inner = (
    <div className={`bg-gray-900 border border-amber-500/30 rounded-3xl shadow-[0_0_60px_rgba(245,158,11,0.15)] p-6 sm:p-7 relative ${asPage ? 'max-w-2xl w-full mx-auto' : 'w-full max-w-md my-10'}`}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg mb-4">
            <Crown size={30} className="text-black" />
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-wider">{plan.label}</h2>
          <p className="text-3xl font-black text-amber-400 mt-2">${Number(plan.amount).toFixed(2)}</p>
          <span className={`mt-2 px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-widest ${expired ? 'text-red-400 bg-red-500/10 border border-red-500/40' : paidMode ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/40' : 'text-slate-300 bg-white/5 border border-white/15'}`}>
            {expired ? (isAr ? 'منتهية' : 'Expired') : paidMode ? (isAr ? 'مفعّلة' : 'Active') : (isAr ? 'محفوظة — وضع مجاني' : 'Saved — Free Mode')}
          </span>
        </div>

        <div className="space-y-3 mb-5">
          <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
            <span className="text-xs font-black text-slate-400">{isAr ? 'نوع الخطة' : 'Plan Type'}</span>
            <span className="text-sm font-black text-white">{plan.label}</span>
          </div>
          <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
            <span className="text-xs font-black text-slate-400 flex items-center gap-1.5">
              <CalendarCheck size={14} />
              {isAr ? 'أول إفراج (GMT)' : 'First release (GMT)'}
            </span>
            <span className="text-sm font-black text-white" dir="ltr">{firstRelease || (isAr ? 'لم يُحدَّد بعد' : 'Not set yet')}</span>
          </div>
          <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
            <span className="text-xs font-black text-slate-400 flex items-center gap-1.5">
              <TimerReset size={14} />
              {isAr ? 'نهاية الصلاحية (GMT)' : 'Expiry (GMT)'}
            </span>
            {hasPeriod ? (
              <span className="text-sm font-black text-white" dir="ltr">{gmt(plan.expiryDate)}</span>
            ) : (
              <span className="text-sm font-black text-amber-400">{isAr ? 'بانتظار الموافقة' : 'Awaiting approval'}</span>
            )}
          </div>
          <div className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
            <span className="text-xs font-black text-slate-400 flex items-center gap-1.5">
              <Hourglass size={14} />
              {isAr ? 'الوقت المتبقي' : 'Time remaining'}
            </span>
            {left ? (
              <span className={`text-sm font-black ${left.past ? 'text-red-400' : 'text-emerald-400'}`} dir="ltr">
                {left.past
                  ? (isAr ? 'انتهت المدة' : 'Finished')
                  : `${left.days}${isAr ? 'ي' : 'd'} ${String(left.hours).padStart(2, '0')}${isAr ? 'س' : 'h'} ${String(left.minutes).padStart(2, '0')}${isAr ? 'د' : 'm'}`}
              </span>
            ) : (
              <span className="text-sm font-black text-amber-400">{isAr ? 'لم تبدأ' : 'Not started'}</span>
            )}
          </div>
        </div>

        {email && (
          <div className="bg-black/25 border border-white/10 rounded-2xl p-4 mb-5 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isAr ? 'البريد المرتبط بالتخطيط' : 'Plan email'}</span>
            <span className="text-xs font-black text-white" dir="ltr">{email}</span>
          </div>
        )}

        {features.length > 0 && (
          <div className="bg-black/25 border border-white/10 rounded-2xl p-4 mb-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{isAr ? 'مميزات خطتك' : 'Your Plan Features'}</p>
            <ul className="space-y-2 max-h-56 overflow-y-auto">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                  <span className="text-emerald-400 shrink-0 mt-0.5 leading-none">▪</span>
                  <span className="leading-snug">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!paidMode ? (
          <button
            onClick={onActivate}
            className="w-full py-4 rounded-2xl font-black text-sm transition-all shadow-lg mb-3 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-[#F59E0B] text-black hover:opacity-90 active:scale-95"
          >
            <Zap size={16} /> {isAr ? 'تفعيل الخطة المدفوعة الآن' : 'Activate Paid Plan Now'}
          </button>
        ) : (
          <p className="text-center text-[11px] text-slate-500 mb-3">{isAr ? 'خطتك مفعّلة وتعمل في كل مميزات التحليل.' : 'Your plan is active with all analysis features.'}</p>
        )}
        {/* نسخ صفقات المطور تلقائياً — نفس صفقات المطور تُفتح في حسابك */}
        <button
          onClick={() => { const next = !mirrorOn; setMirrorOn(next); try { setMirrorEnabled(next); } catch {} }}
          className={`w-full mb-3 flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border-2 font-black text-sm transition-all active:scale-[0.98] ${mirrorOn ? 'bg-emerald-500 border-emerald-600 text-white shadow-lg shadow-emerald-500/30' : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'}`}
          title={isAr ? 'نسخ صفقات المطور' : 'Copy developer trades'}
        >
          <span className="flex items-center gap-2">
            <Copy size={16} />
            {isAr ? 'نسخ صفقات المطور تلقائياً' : 'Auto-copy developer trades'}
          </span>
          <span className={`px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-widest ${mirrorOn ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
            {mirrorOn ? (isAr ? 'مفعّل' : 'ON') : (isAr ? 'مغلق' : 'OFF')}
          </span>
        </button>
        <p className="text-center text-[10px] text-slate-500 mb-3 leading-relaxed">
          {isAr
            ? 'عند التفعيل: كل صفقة تلقائية يفتحها المطور تُفتح فوراً في حسابك بنفس المنطق (صفقة واحدة لكل رمز)، ويصلك صوت فتح قارورة الشمبانيا 🍾.'
            : 'When ON: every auto trade the developer opens is mirrored into your account with the same logic (one trade per symbol), with a champagne-pop sound 🍾.'}
        </p>
        <button
          onClick={onReturnToFree}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white text-xs font-black transition-all"
        >
          <RefreshCcw size={14} />
          {isAr ? 'الرجوع للخطة المجانية' : 'Return to Free Plan'}
        </button>
        {onDeletePlan && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:text-red-300 text-xs font-black transition-all"
          >
            <Trash2 size={14} />
            {isAr ? 'حذف الخطة / الإلغاء' : 'Delete / Cancel Plan'}
          </button>
        )}
        <p className="text-center text-[10px] text-slate-500 mt-3 leading-relaxed">
          {isAr
            ? 'عند العودة للمجاني تبقى خطتك المدفوعة محفوظة في قسم الخطط في المتجر حتى نهاية مدتها، ويمكنك تفعيلها في أي وقت.'
            : 'If you go free, your paid plan stays saved in the Plans section of the store until its period ends, and you can reactivate it anytime.'}
        </p>
    </div>
  );

  const deleteDialog = confirmDelete ? (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-gray-900 border border-red-500/40 rounded-3xl shadow-2xl p-6">
            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center mb-3">
                <AlertTriangle size={26} className="text-red-400" />
              </div>
              <h3 className="text-lg font-black text-white">
                {isAr ? 'تأكيد حذف الخطة' : 'Confirm Plan Deletion'}
              </h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                {isAr
                  ? 'سيتم إلغاء خطتك المدفوعة نهائياً والعودة للمجاني. لا يمكن التراجع عن هذا الإجراء.'
                  : 'Your paid plan will be cancelled permanently and you will return to free. This cannot be undone.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-black transition-all"
              >
                <X size={14} />
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDeletePlan?.(); }}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-xs font-black hover:bg-red-400 transition-all"
              >
                <Trash2 size={14} />
                {isAr ? 'حذف الخطة' : 'Delete Plan'}
              </button>
            </div>
          </div>
        </div>
  ) : null;

  if (asPage) {
    return (
      <div className="w-full px-4 pb-10">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-black transition-all"
          >
            <ChevronRight size={16} className={isAr ? '' : 'rotate-180'} />
            {isAr ? 'رجوع' : 'Back'}
          </button>
        </div>
        {inner}
        {deleteDialog}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      {inner}
      {deleteDialog}
    </div>
  );
}
