import React, { useState } from 'react';
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
  savedAccounts?: any[];
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
  devLoginBusy,
  devLoginError,
  version,
  savedAccounts,
  onLoginClick,
  onLogoutClick,
  userEmail,
  avatarUrl,
}: MobileSettingsProps) {
  const isAr = language === 'ar';
  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Globe size={18} /> {isAr ? 'الإعدادات' : 'Settings'}
      </div>
      <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{isAr ? 'التداول التلقائي' : 'Auto Trade'}</span>
          <button className="mt5-btn mt5-btn-secondary" onClick={() => onAutoTradeToggle(!autoTradeEnabled)}>
            {autoTradeEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{isAr ? 'الصوت' : 'Sound'}</span>
          <button className="mt5-btn mt5-btn-secondary" onClick={() => onSoundToggle(!soundEnabled)}>
            {soundEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{isAr ? 'اللغة' : 'Language'}</span>
          <select value={language} onChange={(e) => onLanguageChange(e.target.value as Language)}>
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onClearCache}>
          <RefreshCw size={16} /> {isAr ? 'مسح الذاكرة' : 'Clear Cache'}
        </button>
        {onDeveloperLogin && (
          <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onDeveloperLogin} disabled={devLoginBusy}>
            {devLoginBusy ? <Loader2 size={16} className="spin" /> : <Shield size={16} />} {isAr ? 'تسجيل دخول المطور' : 'Developer Login'}
          </button>
        )}
        {devLoginError && <div style={{ color: 'red', fontSize: 12 }}>{devLoginError}</div>}
        <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>v{version}</div>
      </div>
    </div>
  );
}