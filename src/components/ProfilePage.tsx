import React, { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Camera, Upload, Trash2, Image, ArrowLeft, Save, Check, RefreshCw, XCircle, History } from 'lucide-react';
import { Language } from '../lib/i18n';
import { BASE_URL } from '../lib/firebase';
import { loadAllSessions, cancelSession, PaymentSession } from '../services/paymentSession';
import { readProfileAsset, writeProfileAsset, profileEmail } from '../lib/profileAssets';

interface ProfilePageProps {
  user: User | null;
  lang: Language;
  onBack: () => void;
  onAvatarChange?: (dataUrl: string | null) => void;
  onLogoChange?: (dataUrl: string | null) => void;
  isDeveloper?: boolean;
  onResumeSession?: (session: PaymentSession) => void;
  autoEmail?: string;
}

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage({ user, lang, onBack, onAvatarChange, onLogoChange, isDeveloper = false, onResumeSession, autoEmail }: ProfilePageProps) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [saved, setSaved] = useState(false);
  const [txs, setTxs] = useState<PaymentSession[]>([]);
  const [txsLoaded, setTxsLoaded] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Profile assets belong to ONE account. Kept in a variable so every read and
  // write below uses the same identity (and so a client can never inherit the
  // developer's photo from the old global key).
  const ownerEmail = profileEmail(user?.email || autoEmail || '');

  const loadHistory = () => {
    loadAllSessions(autoEmail).then((list) => { setTxs(list); setTxsLoaded(true); });
  };

  useEffect(() => {
    const savedAvatar = readProfileAsset('avatar', ownerEmail, isDeveloper);
    const savedLogo = localStorage.getItem('finalyze_custom_logo');
    const savedName = readProfileAsset('name', ownerEmail, isDeveloper);
    if (savedAvatar) setAvatar(savedAvatar);
    if (savedLogo) setLogo(savedLogo);
    if (savedName) setDisplayName(savedName);
    else if (user?.displayName) setDisplayName(user.displayName);
    else if (user?.email) setDisplayName(user.email.split('@')[0]);
    if (autoEmail) loadHistory();
  }, [user, autoEmail, ownerEmail, isDeveloper]);

  const handleCancelHistory = async (id: string) => {
    await cancelSession(id);
    loadHistory();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert(lang === 'ar' ? 'حجم الصورة يجب أن يكون أقل من 2 ميجا' : 'Image must be under 2MB');
      return;
    }
    const dataUrl = await readFileAsDataURL(file);
    setAvatar(dataUrl);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert(lang === 'ar' ? 'حجم الشعار يجب أن يكون أقل من 3 ميجا' : 'Logo must be under 3MB');
      return;
    }
    const dataUrl = await readFileAsDataURL(file);
    setLogo(dataUrl);
  };

  const handleSave = () => {
    writeProfileAsset('avatar', ownerEmail, avatar);
    writeProfileAsset('name', ownerEmail, displayName || null);

    if (logo) localStorage.setItem('finalyze_custom_logo', logo);
    else localStorage.removeItem('finalyze_custom_logo');

    onAvatarChange?.(avatar);
    onLogoChange?.(logo);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRemoveAvatar = () => {
    setAvatar(null);
    writeProfileAsset('avatar', ownerEmail, null);
    onAvatarChange?.(null);
  };

  const handleRemoveLogo = () => {
    setLogo(null);
    localStorage.removeItem('finalyze_custom_logo');
    onLogoChange?.(null);
  };

  return (
    <div className="bg-brand-alt border border-white/10 rounded-[32px] p-6 md:p-8 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="p-2 -ml-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft size={22} />
        </button>
        <h2 className="text-xl font-black text-white">{lang === 'ar' ? 'الملف الشخصي' : 'Profile'}</h2>
      </div>

      {/* Avatar Section */}
      <div className="mb-8">
        <label className="text-xs font-black uppercase tracking-wider text-white/50 mb-3 block">
          {lang === 'ar' ? 'صورة البروفيل' : 'Profile Picture'}
        </label>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-white/20 bg-white/5 flex items-center justify-center">
              {avatar ? (
                <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : user?.photoURL ? (
                <img src={user.photoURL} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-black text-white/30">{user?.email?.charAt(0).toUpperCase() || '?'}</span>
              )}
            </div>
            {avatar && (
              <button
                onClick={handleRemoveAvatar}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={12} className="text-white" />
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => avatarInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#F59E0B] text-black rounded-xl font-black text-xs uppercase tracking-wider hover:bg-[#d97706] transition-all shadow-md"
            >
              <Camera size={16} />
              {lang === 'ar' ? 'رفع صورة' : 'Upload Photo'}
            </button>
            <span className="text-[10px] text-white/30">{lang === 'ar' ? ' JPG/PNG - أقل من 2MB' : 'JPG/PNG - under 2MB'}</span>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleAvatarUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Logo Section - Developer Only */}
      {isDeveloper && (
        <div className="mb-8">
          <label className="text-xs font-black uppercase tracking-wider text-white/50 mb-3 block">
            {lang === 'ar' ? 'شعار التطبيق' : 'App Logo'}
          </label>
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-white/20 bg-black flex items-center justify-center">
                {logo ? (
                  <img src={logo} alt="logo" className="w-full h-full object-cover" />
                ) : (
                  <img src={`${BASE_URL}logo.png`} alt="logo" className="w-full h-full object-cover" />
                )}
              </div>
              {logo && (
                <button
                  onClick={handleRemoveLogo}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={12} className="text-white" />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => logoInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#F59E0B] text-black rounded-xl font-black text-xs uppercase tracking-wider hover:bg-[#d97706] transition-all shadow-md"
              >
                <Image size={16} />
                {lang === 'ar' ? 'رفع شعار' : 'Upload Logo'}
              </button>
              <span className="text-[10px] text-white/30">{lang === 'ar' ? 'SVG/PNG/JPG - أقل من 3MB' : 'SVG/PNG/JPG - under 3MB'}</span>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/svg+xml,image/png,image/jpeg,image/webp"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Display Name */}
      <div className="mb-8">
        <label className="text-xs font-black uppercase tracking-wider text-white/50 mb-3 block">
          {lang === 'ar' ? 'الاسم' : 'Display Name'}
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={lang === 'ar' ? 'اسمك' : 'Your name'}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-bold text-sm placeholder-white/30 focus:outline-none focus:border-[#F59E0B] transition-colors"
        />
      </div>

      {/* User Info (read-only) */}
      <div className="space-y-3 mb-8">
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <span className="text-xs text-slate-500 font-bold block mb-1">{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</span>
          <span className="text-sm font-bold text-white">{user?.email || (lang === 'ar' ? 'غير مسجل' : 'Not logged in')}</span>
        </div>
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <span className="text-xs text-slate-500 font-bold block mb-1">{lang === 'ar' ? 'المعرف' : 'User ID'}</span>
          <span className="text-sm font-mono text-white/70 break-all">{user?.uid || '—'}</span>
        </div>
      </div>

      {/* Transactions History */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History size={16} className="text-[#F59E0B]" />
            <label className="text-xs font-black uppercase tracking-wider text-white/50">
              {lang === 'ar' ? 'معاملاتي' : 'My Transactions'}
            </label>
          </div>
          <button
            onClick={loadHistory}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white text-[10px] font-black uppercase tracking-wider transition-all"
          >
            <RefreshCw size={11} />
            {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
        </div>

        {!txsLoaded ? (
          <button
            onClick={loadHistory}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
          >
            <History size={14} />
            {lang === 'ar' ? 'عرض المعاملات' : 'View transactions'}
          </button>
        ) : txs.length === 0 ? (
          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
            <p className="text-[11px] text-white/40 font-bold text-center">
              {lang === 'ar' ? 'لا توجد معاملات بعد' : 'No transactions yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {txs.map((t) => {
              const isLive = t.status === 'active' || t.status === 'pending';
              return (
                <div key={t.id} className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-white truncate">
                        {t.kind === 'bot' ? t.botName || 'Bot' : t.planLabel || 'Plan'}
                      </p>
                      <p className="text-[10px] text-white/40 font-bold truncate mt-0.5">
                        {t.buyerEmail || (lang === 'ar' ? 'بدون بريد' : 'no email')} · ${t.amountUsd.toFixed?.(2) ?? t.amountUsd} USDT
                        {t.requestNo ? ` · #${t.requestNo}` : ''}
                        {t.method ? ` · ${t.method}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                        t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400'
                        : t.status === 'cancelled' ? 'bg-red-500/20 text-red-400'
                        : t.status === 'pending' ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {t.kind === 'bot'
                          ? (t.status === 'completed'
                              ? (lang === 'ar' ? 'منتج مكتمل' : 'Product Completed')
                              : t.status === 'cancelled'
                                ? (lang === 'ar' ? 'ملغاة' : 'Cancelled')
                                : (lang === 'ar' ? 'قيد الانتظار' : 'Pending'))
                          : (t.status === 'completed'
                              ? (lang === 'ar' ? 'مكتملة' : 'Completed')
                              : t.status === 'cancelled'
                                ? (lang === 'ar' ? 'ملغاة' : 'Cancelled')
                                : t.status === 'pending'
                                  ? (lang === 'ar' ? 'قيد التأكيد' : 'Pending')
                                  : (lang === 'ar' ? 'قيد الانتظار' : 'Active'))}
                      </span>
                    </div>
                  </div>
                  {isLive && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => onResumeSession?.(t)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F59E0B] text-black font-black text-[10px] uppercase tracking-wider hover:bg-[#d97706] transition-all"
                      >
                        <RefreshCw size={11} />
                        {lang === 'ar' ? 'استئناف' : 'Resume'}
                      </button>
                      <button
                        onClick={() => handleCancelHistory(t.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/50 hover:text-red-400 hover:border-red-500/40 text-[10px] font-black uppercase tracking-wider transition-all"
                      >
                        <XCircle size={11} />
                        {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className={cn(
          "w-full py-3 rounded-2xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2",
          saved
            ? "bg-emerald-500 text-white"
            : "bg-[#F59E0B] text-black hover:bg-[#d97706] shadow-md"
        )}
      >
        {saved ? (
          <>
            <Check size={18} />
            {lang === 'ar' ? 'تم الحفظ!' : 'Saved!'}
          </>
        ) : (
          <>
            <Save size={18} />
            {lang === 'ar' ? 'حفظ التغييرات' : 'Save Changes'}
          </>
        )}
      </button>
    </div>
  );
}
