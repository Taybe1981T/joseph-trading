import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, ShieldCheck, UserRound, ArrowLeft } from 'lucide-react';
import { Language } from '../lib/i18n';
import { AuthProviderId } from '../lib/authPolicy';
import { readSavedEmails, rememberSavedEmail } from '../lib/savedAccounts';

interface AuthModalProps {
  open: boolean;
  lang: Language;
  onClose: () => void;
  /** Google-only sign-in. `emailHint` preselects a saved account in Google's chooser. */
  onLogin: (provider?: AuthProviderId, emailHint?: string) => void;
  loginError?: string | null;
  redirecting?: boolean;
  /** Bold context line, e.g. the purchase gate message. */
  notice?: string | null;
  title?: string | null;
}

/**
 * The single sign-in surface for guests on desktop.
 *
 * It lists the emails this browser already knows (a previous purchase, a Google
 * sign-in, a saved account) so a returning client signs in with one tap, and it
 * always offers a plain "continue with Google" button for a brand-new client.
 * There is no password field anywhere: Google is the only method, by design.
 */
export default function AuthModal({
  open,
  lang,
  onClose,
  onLogin,
  loginError,
  redirecting,
  notice,
  title,
}: AuthModalProps) {
  const isAr = lang === 'ar';
  const [accounts, setAccounts] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setAccounts(readSavedEmails());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const heading = title || (isAr ? 'تسجيل الدخول أو إنشاء حساب' : 'Sign in or create an account');
  const hasAccounts = accounts.length > 0;

  const start = (emailHint?: string) => {
    if (emailHint) rememberSavedEmail(emailHint);
    onLogin('google', emailHint);
  };

  const body = useMemo(() => (
    <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      {notice && (
        <div className="rounded-2xl border-2 border-amber-400/50 bg-amber-500/10 p-4">
          <p className="text-[13px] sm:text-sm font-black leading-relaxed text-amber-200 text-center">
            {notice}
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3">
        <p className="flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-300 text-center">
          <ShieldCheck size={14} />
          {isAr
            ? 'الدخول بحساب Google فقط — سريع وآمن وبدون كلمة مرور.'
            : 'Google sign-in only — fast, secure, no password to remember.'}
        </p>
      </div>

      {hasAccounts ? (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {isAr ? 'حسابات محفوظة على هذا المتصفح' : 'Accounts saved on this browser'}
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {accounts.map((email) => (
              <button
                key={email}
                type="button"
                disabled={redirecting}
                onClick={() => start(email)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 border border-white/10 hover:border-emerald-400/60 hover:bg-white/10 transition-all active:scale-[0.99] disabled:opacity-50"
              >
                <span className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 flex items-center justify-center text-black font-black text-sm">
                  {email.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 text-start">
                  <span className="block text-sm font-black text-white truncate" dir="ltr">{email}</span>
                  <span className="block text-[10px] font-bold text-slate-400">
                    {isAr ? 'متابعة بهذا الحساب' : 'Continue with this account'}
                  </span>
                </span>
                <ArrowLeft size={16} className={isAr ? 'text-slate-400' : 'text-slate-400 rotate-180'} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {isAr ? 'أو' : 'or'}
            </span>
            <div className="flex-1 h-px bg-white/10" />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
          <UserRound size={26} className="mx-auto mb-2 text-emerald-400" />
          <p className="text-xs font-bold text-slate-300 leading-relaxed">
            {isAr
              ? 'لا يوجد حساب محفوظ على هذا المتصفح. أنشئ حسابك مجاناً بحساب Google بضغطة واحدة.'
              : 'No saved account on this browser. Create your free account with Google in one tap.'}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => start()}
        disabled={redirecting}
        className="w-full bg-white hover:bg-slate-100 text-slate-900 font-black py-4 rounded-2xl transition-all text-sm shadow-lg active:scale-[0.99] flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {redirecting ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
        )}
        {redirecting
          ? (isAr ? 'جاري فتح Google…' : 'Opening Google…')
          : (isAr ? 'المتابعة بحساب Google' : 'Continue with Google')}
      </button>

      {loginError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-[11px] font-bold text-red-300 text-center leading-relaxed">{loginError}</p>
        </div>
      )}

      <p className="text-center text-[10px] font-bold text-slate-500 leading-relaxed">
        {isAr
          ? 'سجّل مجاناً لتحصل على إشارات قوية لكل الأسواق — ويمكنك تفعيل خطتك أو تحميل منتجاتك في أي وقت.'
          : 'Sign up free to get strong signals across all markets — activate your plan or download products anytime.'}
      </p>
    </div>
  ), [accounts, hasAccounts, isAr, loginError, notice, redirecting]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="w-full max-w-md bg-brand-alt border border-white/10 rounded-3xl shadow-2xl p-5 sm:p-6 my-auto"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-black text-white leading-tight">{heading}</h3>
                <p className="text-[11px] font-bold text-slate-400 mt-1">
                  {isAr ? 'حساب Google واحد يكفي — للعملاء والمطورين.' : 'One Google account is enough — clients and developers.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isAr ? 'إغلاق' : 'Close'}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={18} />
              </button>
            </div>
            {body}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
