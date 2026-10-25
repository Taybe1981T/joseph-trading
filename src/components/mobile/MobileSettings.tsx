import React, { useState, useEffect, useRef } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, User } from 'lucide-react';
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
