import React, { useState, useEffect, useRef } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, User, Camera } from 'lucide-react';
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
  savedAccounts?: string[];
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
  userEmail?: string | null;
  avatarUrl?: string | null;
  onProfileImageChange?: (url: string) => void;
  onLogoChange?: (url: string) => void;
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
  savedAccounts,
  onLoginClick,
  onLogoutClick,
  userEmail,
  avatarUrl,
  onProfileImageChange,
  onLogoChange,
  devLoginBusy,
  devLoginError,
  version,
}: MobileSettingsProps) {
  const Row = ({ icon: Icon, title, subtitle, control }: { icon: React.ElementType; title: string; subtitle: string; control: React.ReactNode }) => (
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

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Shield size={16} /> Settings
      </div>

      <Row icon={RefreshCw} title="Auto Mirror Trading" subtitle="Copy developer trades instantly" control={<Toggle on={autoTradeEnabled} onFlip={() => onAutoTradeToggle(!autoTradeEnabled)} />} />

      <Row icon={Volume2} title="Trade Sounds" subtitle="Alert on new position" control={<Toggle on={soundEnabled} onFlip={() => onSoundToggle(!soundEnabled)} />} />

      <Row icon={Bell} title="Push Notifications" subtitle="New signal alerts" control={<Toggle on={true} onFlip={() => {}} />} />

      <Row icon={Globe} title="Language" subtitle="App interface language" control={
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`mt5-btn ${language === 'en' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => onLanguageChange('en')}>EN</button>
          <button className={`mt5-btn ${language === 'ar' ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`} style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => onLanguageChange('ar')}>AR</button>
        </div>
      } />

      {/* Login / Account section */}
      <div className="mt5-section-title" style={{ marginTop: 20 }}>
        <User size={16} /> {language === 'ar' ? 'الحساب' : 'Account'}
      </div>
      {userEmail ? (
        <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <User size={20} style={{ color: '#888' }} />
            )}
            <div className="mt5-signal-info">
              <div className="mt5-card-title">{userEmail}</div>
              <div className="mt5-card-subtitle">{language === 'ar' ? 'متصل' : 'Connected'}</div>
            </div>
          </div>
          <button className="mt5-btn mt5-btn-danger mt5-btn-block" onClick={() => onLogoutClick?.()}>
            <LogOut size={16} /> {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
          </button>
        </div>
      ) : (
        <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LogIn size={18} style={{ color: '#F59E0B', flexShrink: 0 }} />
            <div className="mt5-signal-info">
              <div className="mt5-card-title">{language === 'ar' ? 'تسجيل الدخول' : 'Login'}</div>
              <div className="mt5-card-subtitle">{language === 'ar' ? 'اختر حساباً محفوظاً أو سجّل باستخدام Google' : 'Choose a saved account or sign in with Google'}</div>
            </div>
          </div>
          {savedAccounts && savedAccounts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedAccounts.map((em) => (
                <button key={em} className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={() => { onLoginClick?.(); }}>
                  {em}
                </button>
              ))}
            </div>
          )}
          <button className="mt5-btn mt5-btn-primary mt5-btn-block" onClick={() => onLoginClick?.()}>
            <LogIn size={16} /> {language === 'ar' ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google'}
          </button>
        </div>
      )}

      <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onClearCache}>Clear Cache</button>

      {/* Personal Profile section */}
      <div className="mt5-section-title" style={{ marginTop: 24 }}>
        <User size={16} /> {language === 'ar' ? 'الملف الشخصي' : 'Personal Profile'}
      </div>
      <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: 96, height: 96 }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.2)' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: '#2a2a2a', border: '2px dashed rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={32} style={{ color: '#888' }} />
              </div>
            )}
            <label style={{ position: 'absolute', bottom: 2, right: 2, background: '#10B981', borderRadius: '50%', padding: 6, cursor: 'pointer', border: '2px solid #1a1a1a' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const dataUrl = ev.target?.result as string;
                  try { localStorage.setItem('finalyze_custom_avatar', dataUrl); } catch {}
                  onProfileImageChange?.(dataUrl);
                };
                reader.readAsDataURL(file);
              }} />
              <Camera size={14} style={{ color: '#fff' }} />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
            <div className="mt5-card-title" style={{ textAlign: 'center' }}>{userEmail || (language === 'ar' ? 'غير مسجل الدخول' : 'Not signed in')}</div>
            <div className="mt5-card-subtitle" style={{ textAlign: 'center', color: '#888' }}>{language === 'ar' ? 'صورة البروفيل' : 'Profile picture'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={16} style={{ color: '#888' }} />
          </div>
          <div className="mt5-signal-info" style={{ flex: 1 }}>
            <div className="mt5-card-title">{language === 'ar' ? 'شعار التطبيق' : 'App Logo'}</div>
            <div className="mt5-card-subtitle">{language === 'ar' ? 'تغيير شعار التطبيق الظاهر في الهيدر' : 'Change app logo shown in header'}</div>
          </div>
          <button className="mt5-btn mt5-btn-secondary" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e: any) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const dataUrl = ev.target?.result as string;
                try { localStorage.setItem('finalyze_custom_logo', dataUrl); } catch {}
                onLogoChange?.(dataUrl);
              };
              reader.readAsDataURL(file);
            };
            input.click();
          }}>
            {language === 'ar' ? 'تغيير' : 'Change'}
          </button>
        </div>
        {userEmail && (
          <button className="mt5-btn mt5-btn-danger mt5-btn-block" onClick={() => onLogoutClick?.()}>
            <LogOut size={16} /> {language === 'ar' ? 'تسجيل الخروج من كافة الأجهزة' : 'Sign out from all devices'}
          </button>
        )}
      </div>

      <div className="mt5-empty-subtitle" style={{ textAlign: 'center', marginTop: 12 }}>
        Joseph.Trading v{version} — MT5 Mobile Edition
      </div>
    </div>
  );
}

/** Developer login row — desktop parity (App.tsx guest mode shows a developer login; clients never get the dev sections until a dev email signs in). */
function DevLoginRow({ language, onDeveloperLogin, devLoginBusy, devLoginError }: { language: Language; onDeveloperLogin?: () => void; devLoginBusy?: boolean; devLoginError?: string | null }) {
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
      <button className="mt5-btn mt5-btn-primary mt5-btn-block" disabled={!!devLoginBusy} onClick={() => onDeveloperLogin?.()}>
        {devLoginBusy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
        {language === 'ar' ? 'تسجيل دخول المطور' : 'Sign in as developer'}
      </button>
      {devLoginError && <div style={{ color: '#ff6b6b', fontSize: 12, fontWeight: 700, textAlign: 'center' }}>{devLoginError}</div>}
    </div>
  );
}

/** Logout button — only meaningful while a developer session is active. */
function DevLogoutButton({ language }: { language: Language }) {
  const { isDev } = useMobileMode();
  if (!isDev) return null;
  return (
    <button className="mt5-btn mt5-btn-danger mt5-btn-block" onClick={() => {
      if (confirm(language === 'ar' ? 'تسجيل الخروج؟' : 'Logout?')) {
        try { window.dispatchEvent(new Event('mobile-logout')); } catch {}
      }
    }}>
      <LogOut size={16} /> {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
    </button>
  );
}
