import React, { useState, useEffect } from 'react';
import { Globe, Sun, Moon, Bell, User, Activity } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { getOpenStockExchanges } from '../../lib/marketHours';

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

/** White icon button used inside the green brand bar (visible in both themes). */
const barBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.38)',
  color: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

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
      <header
        className="mt5-header"
        style={{
          height: 'auto',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 6,
          padding: 0,
          background: 'transparent',
          borderBottom: 'none',
        }}
      >
        {/* ── Green brand bar: mini logo + site name + every top icon ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: 'linear-gradient(100deg, #047857 0%, #10B981 55%, #34D399 100%)',
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
            boxShadow: '0 4px 16px rgba(16,185,129,0.30)',
            color: '#ffffff',
          }}
        >
          {/* Mini site logo — raised to the same level as the site name. */}
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.45)',
              flexShrink: 0,
            }}
          >
            <img
              src={logo || 'https://joseph-trading.vercel.app/logo.png'}
              alt="JT"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: '#ffffff',
                lineHeight: 1.05,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Joseph.<span style={{ color: '#D1FAE5', fontStyle: 'italic' }}>Trading</span>
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: 'rgba(255,255,255,0.88)',
                fontWeight: 700,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {isAr ? 'لتحليل الأسواق المالية' : 'Financial Market Analysis'} · {title}
            </div>
          </div>

          {/* Top icons — all inside the green bar. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <button
                className="mt5-icon-btn"
                style={barBtn}
                onClick={() => setShowLang(!showLang)}
                aria-label="Language"
              >
                <Globe size={16} />
              </button>
              {showLang && (
                <div
                  style={{
                    position: 'absolute',
                    top: 40,
                    right: 0,
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: 10,
                    overflow: 'hidden',
                    zIndex: 300,
                    minWidth: 130,
                  }}
                >
                  {(['en', 'ar'] as Language[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => { onLangChange(l); setShowLang(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '10px 12px',
                        background: lang === l ? 'rgba(16,185,129,0.15)' : 'transparent',
                        border: 'none',
                        color: '#e0e0e0',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      <span>{l === 'en' ? 'EN' : 'عربي'}</span>
                      {lang === l && <span style={{ color: '#00ff88' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Auto analysis: original top position, START/ON word underneath. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              <button
                className="mt5-icon-btn"
                style={{ ...barBtn, width: 36, position: 'relative' }}
                onClick={onAutoAnalysisToggle}
                aria-label={isAr ? 'بدء التحليل التلقائي' : 'Start auto analysis'}
              >
                <Activity
                  size={19}
                  style={{
                    color: autoAnalysisRunning ? '#D1FAE5' : '#FDE68A',
                    animation: autoAnalysisRunning ? 'pulse 1.5s infinite' : 'none',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: autoAnalysisRunning ? '#ffffff' : '#F59E0B',
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                />
              </button>
              {onAutoAnalysisToggle && (
                <span
                  style={{
                    fontSize: 7.5,
                    fontWeight: 900,
                    letterSpacing: '0.05em',
                    lineHeight: 1,
                    textTransform: 'uppercase',
                    color: autoAnalysisRunning ? '#D1FAE5' : '#FDE68A',
                  }}
                >
                  {autoAnalysisRunning ? (isAr ? 'يعمل' : 'ON') : (isAr ? 'بدء' : 'START')}
                </span>
              )}
            </div>

            <button
              className="mt5-icon-btn"
              style={barBtn}
              onClick={toggleTheme}
              aria-label="Theme"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {onNotificationsClick && (
              <button
                className="mt5-icon-btn"
                style={barBtn}
                onClick={onNotificationsClick}
                aria-label="Notifications"
              >
                <Bell size={16} />
              </button>
            )}

            {/* Profile icon — goes to Profile */}
            <div style={{ position: 'relative' }}>
              <button
                className="mt5-icon-btn"
                style={barBtn}
                onClick={() => { onProfileClick?.(); }}
                aria-label="Profile"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <User size={16} />
                )}
              </button>
              {userEmail && (
                <div
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    background: '#ffffff',
                    borderRadius: '50%',
                    width: 10,
                    height: 10,
                    border: '2px solid #10B981',
                    fontSize: 8,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              )}
            </div>

          </div>
        </div>

        {/* ── Four market-status boxes (clear in day + night) ── */}
        <div style={{ display: 'flex', gap: 6, padding: '0 10px' }}>
          {CATS.map((c) => {
            const open = isCatOpen(c.key, now);
            return (
              <span
                key={c.key}
                title={(isAr ? c.ar : c.en) + ': ' + (open ? (isAr ? 'مفتوح' : 'Open') : (isAr ? 'مغلق' : 'Closed'))}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  height: 26,
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  color: '#fff',
                  background: open ? '#10B981' : '#ef4444',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                }}
              >
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
