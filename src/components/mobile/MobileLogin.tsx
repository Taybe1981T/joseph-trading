import React, { useState, useEffect } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { BASE_URL } from '../../lib/firebase';

interface MobileLoginProps {
  lang: Language;
  onLangChange: (l: Language) => void;
  onLogin: () => void;
  busy: boolean;
  error: string | null;
}

export function MobileLogin({ lang, onLangChange, onLogin, busy, error }: MobileLoginProps) {
  const isAr = lang === 'ar';
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    try { setLogo(localStorage.getItem('finalyze_custom_logo')); } catch {}
  }, []);
  return (
    <div className="mobile-only" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>
      <button onClick={() => onLangChange(lang === 'ar' ? 'en' : 'ar')}
        style={{ position: 'absolute', top: 16, right: 16, padding: '8px 14px', borderRadius: 10, border: '1px solid #2a2a2a', background: '#121212', color: '#e0e0e0', fontSize: 13, fontWeight: 700 }}>
        {lang === 'ar' ? 'EN' : 'عربي'}
      </button>
      <div style={{ width: 72, height: 72, borderRadius: 18, overflow: 'hidden', background: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
        <img src={logo || (BASE_URL + 'logo.png')} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>
          Joseph.<span style={{ color: '#10B981', fontStyle: 'italic' }}>Trading</span>
        </div>
        <div style={{ fontSize: 12, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 4 }}>
          {isAr ? 'محرك التحليل المؤسسي' : 'Institutional Engine'}
        </div>
      </div>
      <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 14, padding: '14px 16px', fontSize: 13, color: '#a7f3d0', textAlign: 'center', maxWidth: 340 }}>
        {isAr ? 'سجل مجاناً واحصل على إشارات قوية لكل الأسواق' : 'Sign up free & get strong signals for all markets'}
      </div>
      <button onClick={onLogin} disabled={busy}
        style={{ width: '100%', maxWidth: 340, background: '#fff', color: '#111', border: 'none', borderRadius: 14, padding: 15, fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
        )}
        {busy ? (isAr ? 'جاري...' : 'Signing in...') : (isAr ? 'تسجيل دخول بـ Google' : 'Sign In with Google')}
      </button>
      {error && (
        <div style={{ maxWidth: 340, background: 'rgba(255,51,51,0.1)', border: '1px solid rgba(255,51,51,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fca5a5', textAlign: 'center' }}>
          {error}
        </div>
      )}
      <div style={{ fontSize: 11, color: '#666' }}>
        <LogIn size={12} style={{ display: 'inline', verticalAlign: -1 }} /> Google Secure Verification
      </div>
    </div>
  );
}