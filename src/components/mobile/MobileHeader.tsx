import React, { useState, useEffect, useRef } from 'react';
import { Globe, Sun, Moon, Bell, User, Users, Activity } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { getOpenStockExchanges } from '../../lib/marketHours';
import { BASE_URL } from '../../lib/firebase';

interface MobileHeaderProps {
  title: string;
  lang: Language;
  onLangChange: (l: Language) => void;
  isDark: boolean;
  toggleTheme: () => void;
  clientCount?: number;
  onClientsClick?: () => void;
  onNotificationsClick?: () => void;
  userEmail?: string | null;
  avatarUrl?: string | null;
  onProfileClick?: () => void;
  autoAnalysisRunning?: boolean;
  onAutoAnalysisToggle?: () => void;
}

function isCatOpen(key: string, now: Date): boolean {
  if (key === 'crypto') return true;
  if (key === 'stocks') return getOpenStockExchanges(now).length > 0;
  const day = now.getUTCDay();
  return day !== 0 && day !== 6;
}

const CATS = [
  { key: 'forex', en: 'Forex', ar: 'فوركس' },
  { key: 'crypto', en: 'Crypto', ar: 'كريبتو' },
  { key: 'stocks', en: 'Stocks', ar: 'الأسهم' },
  { key: 'metals', en: 'Metals', ar: 'المعادن' },
];

export function MobileHeader({
  title, lang, onLangChange, isDark, toggleTheme, clientCount, onClientsClick,
  onNotificationsClick, userEmail, avatarUrl, onProfileClick, autoAnalysisRunning, onAutoAnalysisToggle,
}: MobileHeaderProps) {
  const [logo, setLogo] = useState<string | null>(null);
  const [showLang, setShowLang] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    try { setLogo(localStorage.getItem('finalyze_custom_logo')); } catch {}
    const h = () => { try { setLogo(localStorage.getItem('finalyze_custom_logo')); } catch {} };
    window.addEventListener('storage', h);
    const iv = setInterval(() => setNow(new Date()), 60000);
    return () => { window.removeEventListener('storage', h); clearInterval(iv); };
  }, []);
  const isAr = lang === 'ar';
  return (
    <>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.2); } }`}</style>
      <header className="mt5-header" style={{ height: 'auto', flexDirection: 'column', alignItems: 'stretch', gap: 6, padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }}>
          <img src={logo || (BASE_URL + 'logo.png')} alt="JT" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>
            Joseph.<span style={{ color: '#7dd3fc', fontStyle: 'italic' }}>Trading</span>
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {isAr ? 'لتحليل الأسواق المالية' : 'For Financial Market Analysis'} · {title}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="mt5-icon-btn" style={{ width: 36, height: 36 }} onClick={() => setShowLang(!showLang)} aria-label="Language">
            <Globe size={17} />
          </button>
          {showLang && (
            <div style={{ position: 'absolute', top: 42, right: 0, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', zIndex: 300, minWidth: 130 }}>
              {(['en', 'ar'] as Language[]).map((l) => (
                <button key={l} onClick={() => { onLangChange(l); setShowLang(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: lang === l ? 'rgba(16,185,129,0.15)' : 'transparent', border: 'none', color: '#e0e0e0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  <span>{l === 'en' ? 'EN' : 'عربي'}</span>
                  {lang === l && <span style={{ color: '#00ff88' }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="mt5-icon-btn" style={{ width: 36, height: 36, position: 'relative' }} onClick={onAutoAnalysisToggle} aria-label="Auto Analysis">
          <Activity size={17} style={{ color: autoAnalysisRunning ? '#10B981' : '#ef4444', animation: autoAnalysisRunning ? 'pulse 1.5s infinite' : 'none' }} />
          <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: autoAnalysisRunning ? '#10B981' : '#ef4444' }} />
        </button>
        <button className="mt5-icon-btn" style={{ width: 36, height: 36 }} onClick={toggleTheme} aria-label="Theme">
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        {onNotificationsClick && (
          <button className="mt5-icon-btn" style={{ width: 36, height: 36 }} onClick={onNotificationsClick} aria-label="Notifications">
            <Bell size={17} />
          </button>
        )}
        {/* Profile icon — goes to Profile */}
        <div style={{ position: 'relative' }}>
          <button
            className="mt5-icon-btn"
            style={{ width: 36, height: 36 }}
            onClick={() => { onProfileClick?.(); }}
            aria-label="Profile"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <User size={17} />
            )}
          </button>
          {userEmail && (
            <div style={{ position: 'absolute', top: -8, right: -8, background: '#10B981', borderRadius: '50%', width: 14, height: 14, border: '2px solid #1a1a1a', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ●
            </div>
          )}
        </div>
        {clientCount && clientCount > 0 && onClientsClick && (
          <button className="mt5-icon-btn" style={{ width: 36, height: 36, position: 'relative' }} onClick={onClientsClick} aria-label="Clients">
            <Users size={16} />
            <span style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#F59E0B', color: '#000', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {clientCount}
            </span>
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {CATS.map((c) => {
          const open = isCatOpen(c.key, now);
          return (
            <span key={c.key} title={(isAr ? c.ar : c.en) + ': ' + (open ? (isAr ? 'مفتوح' : 'Open') : (isAr ? 'مغلق' : 'Closed'))}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 26, borderRadius: 999, fontSize: 11, fontWeight: 800, color: '#fff', background: open ? '#10B981' : '#ef4444' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
              {isAr ? c.ar : c.en}
            </span>
          );
        })}
      </div>
    </header>
    </>
  );
}