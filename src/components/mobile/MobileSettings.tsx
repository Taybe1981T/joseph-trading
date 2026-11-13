import React, { useState } from 'react';
import { Bell, Volume2, Globe, Shield, LogOut, LogIn, Loader2, RefreshCw, User, Camera, ChevronLeft } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { useMobileMode } from '../../lib/mobileMode';
import TradingValuesPanel from '../TradingValuesPanel';

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

// Mobile parity with desktop: Settings shows ONLY the system names (one per
// line). Tapping a name opens that system's own page with its controls.
type MobileSystem = 'autoTrade' | 'sound' | 'language' | 'devLogin' | 'tradingValues';

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
  const mode = useMobileMode();
  const [activeSystem, setActiveSystem] = useState<MobileSystem | null>(null);

  const systems: Array<{ id: MobileSystem; ar: string; en: string; devOnly?: boolean }> = [
    { id: 'autoTrade', ar: 'التداول التلقائي', en: 'Auto Trade' },
    { id: 'sound', ar: 'الصوت والتنبيهات', en: 'Sound & Alerts' },
    { id: 'language', ar: 'اللغة', en: 'Language' },
    { id: 'devLogin', ar: 'تسجيل دخول المطور', en: 'Developer Login', devOnly: true },
    { id: 'tradingValues', ar: 'نظام القيم الثابتة للتداول (مطور)', en: 'Fixed Trading Values (Dev)', devOnly: true },
  ];
  const visibleSystems = systems.filter((s) => {
    if (s.id === 'devLogin') return !!onDeveloperLogin;
    if (s.devOnly) return mode.isDev;
    return true;
  });
  const activeInfo = activeSystem ? systems.find((s) => s.id === activeSystem) : null;

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        <Globe size={18} /> {isAr ? 'الإعدادات' : 'Settings'}
      </div>

      {/* ── Systems index: names only ── */}
      {activeSystem === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#888', fontWeight: 700, padding: '0 4px' }}>
            {isAr ? 'اختر النظام الذي تريد تعديله — كل نظام في صفحة مستقلة.' : 'Choose a system to edit — each one opens on its own page.'}
          </div>
          {visibleSystems.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mt5-signal-card"
              onClick={() => setActiveSystem(s.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, padding: '16px', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{isAr ? s.ar : s.en}</span>
              <ChevronLeft size={20} style={{ opacity: 0.5, transform: 'rotate(180deg)', flexShrink: 0 }} />
            </button>
          ))}
          <div style={{ fontSize: 12, color: '#888', textAlign: 'center', paddingTop: 4 }}>v{version}</div>
        </div>
      )}

      {/* ── Dedicated system page ── */}
      {activeSystem !== null && activeInfo && (
        <>
          <button
            type="button"
            className="mt5-btn mt5-btn-secondary"
            onClick={() => setActiveSystem(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 900 }}
          >
            <ChevronLeft size={18} style={{ transform: 'rotate(180deg)' }} />
            {isAr ? 'رجوع' : 'Back'}
          </button>

          <div className="mt5-signal-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>
              {isAr ? activeInfo.ar : activeInfo.en}
            </div>

            {activeSystem === 'autoTrade' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'التداول التلقائي' : 'Auto Trade'}</span>
                <button className="mt5-btn mt5-btn-secondary" onClick={() => onAutoTradeToggle(!autoTradeEnabled)}>
                  {autoTradeEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
                </button>
              </div>
            )}

            {activeSystem === 'sound' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'الصوت' : 'Sound'}</span>
                <button className="mt5-btn mt5-btn-secondary" onClick={() => onSoundToggle(!soundEnabled)}>
                  {soundEnabled ? (isAr ? 'مفعّل' : 'On') : (isAr ? 'معطّل' : 'Off')}
                </button>
              </div>
            )}

            {activeSystem === 'language' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{isAr ? 'اللغة' : 'Language'}</span>
                <select value={language} onChange={(e) => onLanguageChange(e.target.value as Language)}>
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
            )}

            {activeSystem === 'devLogin' && onDeveloperLogin && (
              <>
                <button className="mt5-btn mt5-btn-secondary mt5-btn-block" onClick={onDeveloperLogin} disabled={devLoginBusy}>
                  {devLoginBusy ? <Loader2 size={16} className="spin" /> : <Shield size={16} />} {isAr ? 'تسجيل دخول المطور' : 'Developer Login'}
                </button>
                {devLoginError && <div style={{ color: 'red', fontSize: 12 }}>{devLoginError}</div>}
              </>
            )}

            {activeSystem === 'tradingValues' && mode.isDev && (
              <TradingValuesPanel lang={language} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
