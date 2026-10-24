import React, { useState, useEffect, useRef } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, Camera, Image as ImageIcon, X } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { useMobileMode } from '../../lib/mobileMode';

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
}

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
}: MobileSettingsProps) {
  const Row = ({
    icon: Icon,
    title,
    subtitle,
    control,
  }: {
    icon: React.ElementType;
    title: string;
    subtitle: string;
    control: React.ReactNode;
  }) => (
    <div className="mt5-signal-card">
      <Icon size={20} style={{ color: '#888', flexShrink: 0 }} />
      <div className="mt5-signal-info">
        <div className="mt5-card-title">{title}</div>
        <div className="mt5-card-subtitle">{subtitle}</div>
      </div>
      {control}
    </div>
  );

  const Toggle = ({ on, onFlip }: { on: boolean; onFlip: () => void }) => (
    <button
      className={`mt5-btn ${on ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
      style={{ padding: '8px 18px', fontSize: 13, minWidth: 70 }}
      onClick={onFlip}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  );

  // Profile picture + mini logo — desktop parity (ProfilePage → finalyze_custom_avatar/logo).
  const [avatar, setAvatar] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const a = localStorage.getItem('finalyze_custom_avatar');
      const l = localStorage.getItem('finalyze_custom_logo');
      if (a) setAvatar(a);
      if (l) setLogo(l);
    } catch {}
  }, []);
  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  const onAvatarFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { alert(language === 'ar' ? 'حجم الصورة يجب أن يكون أقل من 2 ميجا' : 'Image must be under 2MB'); return; }
    const url = await readFileAsDataURL(f);
    setAvatar(url);
    try { localStorage.setItem('finalyze_custom_avatar', url); window.dispatchEvent(new Event('storage')); } catch {}
    setSavedTick(true); setTimeout(() => setSavedTick(false), 2000);
  };
  const onLogoFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { alert(language === 'ar' ? 'حجم الشعار يجب أن يكون أقل من 3 ميجا' : 'Logo must be under 3MB'); return; }
    const url = await readFileAsDataURL(f);
    setLogo(url);
    try { localStorage.setItem('finalyze_custom_logo', url); window.dispatchEvent(new Event('storage')); } catch {}
    setSavedTick(true); setTimeout(() => setSavedTick(false), 2000);
  };

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Shield size={16} /> Settings
      </div>

      <Row
        icon={RefreshCw}
        title="Auto Mirror Trading"
        subtitle="Copy developer trades instantly"
        control={
          <Toggle on={autoTradeEnabled} onFlip={() => onAutoTradeToggle(!autoTradeEnabled)} />
        }
      />

      <Row
        icon={Volume2}
        title="Trade Sounds"
        subtitle="Alert on new position"
        control={
          <Toggle on={soundEnabled} onFlip={() => onSoundToggle(!soundEnabled)} />
        }
      />

      <Row
        icon={Bell}
        title="Push Notifications"
        subtitle="New signal alerts"
        control={<Toggle on={true} onFlip={() => {}} />}
      />

      <Row
        icon={Globe}
        title="Language"
        subtitle="App interface language"
        control={
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`mt5-btn ${language === 'en' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: 12 }}
              onClick={() => onLanguageChange('en')}
            >
              EN
            </button>
            <button
              className={`mt5-btn ${language === 'ar' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ padding: '8px 14px', fontSize: 12 }}
              onClick={() => onLanguageChange('ar')}
            >
              AR
            </button>
          </div>
        }
      />

      <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onClearCache}>
        Clear Cache
      </button>

      <div className="mt5-section-title" style={{ marginTop: 16 }}>
        <Camera size={16} /> {language === 'ar' ? 'صورة البروفايل والشعار' : 'Profile & Logo'}
      </div>

      <div className="mt5-signal-card">
        <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', background: '#1a1a1a', border: '2px solid #333', flexShrink: 0, position: 'relative' }}>
          {avatar ? (
            <img src={avatar} alt="profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
              <Camera size={22} />
            </div>
          )}
          {avatar && (
            <button
              type="button"
              onClick={() => { setAvatar(null); try { localStorage.removeItem('finalyze_custom_avatar'); window.dispatchEvent(new Event('storage')); } catch {} }}
              style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="mt5-signal-info">
          <div className="mt5-card-title">{language === 'ar' ? 'صورة البروفايل' : 'Profile Picture'}</div>
          <div className="mt5-card-subtitle">{language === 'ar' ? 'تظهر في الهيدر وصفحة الديسكتوب' : 'Shows in header and desktop page'}</div>
        </div>
        <button className="mt5-btn mt5-btn-secondary" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => avatarRef.current?.click()}>
          <Camera size={14} /> {language === 'ar' ? 'تغيير' : 'Change'}
        </button>
        <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
          onChange={(e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <div className="mt5-signal-card">
        <div style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0, position: 'relative' }}>
          {logo ? (
            <img src={logo} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
              <ImageIcon size={22} />
            </div>
          )}
          {logo && (
            <button
              type="button"
              onClick={() => { setLogo(null); try { localStorage.removeItem('finalyze_custom_logo'); window.dispatchEvent(new Event('storage')); } catch {} }}
              style={{ position: 'absolute', top: 0, right: 0, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="mt5-signal-info">
          <div className="mt5-card-title">{language === 'ar' ? 'الشعار المصغر' : 'Mini Logo'}</div>
          <div className="mt5-card-subtitle">{language === 'ar' ? 'يظهر في أعلى التطبيق' : 'Shows at the top of the app'}</div>
        </div>
        <button className="mt5-btn mt5-btn-secondary" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => logoRef.current?.click()}>
          <ImageIcon size={14} /> {language === 'ar' ? 'تغيير' : 'Change'}
        </button>
        <input ref={logoRef} type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" style={{ display: 'none' }}
          onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {savedTick && (
        <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700, color: '#00ff88', textAlign: 'center' }}>
          ✓ {language === 'ar' ? 'تم الحفظ — ينعكس على الموقع والتطبيق معاً' : 'Saved — reflected on both site and app'}
        </div>
      )}

      <div className="mt5-empty-subtitle" style={{ textAlign: 'center', marginTop: 12 }}>
        Joseph.Trading v{version} — MT5 Mobile Edition
      </div>
    </div>
  );
}

/**
 * Developer login row — desktop parity (App.tsx guest mode shows a developer
 * login; clients never get the dev sections until a dev email signs in).
 */
function DevLoginRow({
  language,
  onDeveloperLogin,
  devLoginBusy,
  devLoginError,
}: {
  language: Language;
  onDeveloperLogin?: () => void;
  devLoginBusy?: boolean;
  devLoginError?: string | null;
}) {
  const { isDev } = useMobileMode();
  if (isDev) return null;
  return (
    <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <LogIn size={18} style={{ color: '#F59E0B', flexShrink: 0 }} />
        <div className="mt5-signal-info">
          <div className="mt5-card-title">{language === 'ar' ? 'دخول المطور' : 'Developer Login'}</div>
          <div className="mt5-card-subtitle">
            {language === 'ar' ? 'للمطورين فقط — يفتح أدوات المطوّر' : 'Developers only — unlocks developer tools'}
          </div>
        </div>
      </div>
      <button
        className="mt5-btn mt5-btn-primary mt5-btn-block"
        disabled={!!devLoginBusy}
        onClick={() => onDeveloperLogin?.()}
      >
        {devLoginBusy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
        {language === 'ar' ? 'تسجيل دخول المطور' : 'Sign in as developer'}
      </button>
      {devLoginError && (
        <div style={{ color: '#ff6b6b', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{devLoginError}</div>
      )}
    </div>
  );
}

/** Logout button — only meaningful while a developer session is active. */
function DevLogoutButton({ language }: { language: Language }) {
  const { isDev } = useMobileMode();
  if (!isDev) return null;
  return (
    <button
      className="mt5-btn mt5-btn-danger mt5-btn-block"
      onClick={() => {
        if (confirm(language === 'ar' ? 'تسجيل الخروج؟' : 'Logout?')) {
          try { window.dispatchEvent(new Event('mobile-logout')); } catch {}
        }
      }}
    >
      <LogOut size={16} /> {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
    </button>
  );
}