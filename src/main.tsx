import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { MobileLayout } from './components/mobile/MobileLayout';
import { MobileLogin } from './components/mobile/MobileLogin';
import { Language } from './lib/i18n';
import { initMoneytizer } from './lib/moneytizer';
import './index.css';
import './styles/mobile_pt1.css';
import './styles/mobile_pt2.css';

(window as any).__BUILD = 'v3.1.0';
initMoneytizer();

function AppWrapper() {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>(() => {
    try {
      const s = localStorage.getItem('language');
      return (s === 'ar' || s === 'en') ? (s as Language) : 'en';
    } catch { return 'en'; }
  });

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // على الجوال (≤768px): أي زائر (عميل أو غير مسجل) يفتح التطبيق مباشرةً
  // بدون بوابة تسجيل دخول — مستوى العميل يُكتشف من المتجر المحلي.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      try {
        if (u?.email) {
          localStorage.setItem('finalyze_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
          localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
        }
      } catch {}
    });
    // لا ننتظر Firebase ببطء: لو لم يتوفر المستخدم بعد، نعرّف الواجهة فوراً.
    const t = setTimeout(() => setAuthLoading(false), 3000);
    return () => { unsub(); clearTimeout(t); };
  }, []);

  useEffect(() => {
    const h = () => {
      // Desktop parity: dev logout → land on the CLIENT home, not the login
      // wall. Firebase signs out, the dev email identity is cleared, and the
      // client home (shared signals + client features) stays open.
      signOut(auth).catch(() => {});
      try {
        localStorage.removeItem('finalyze_user');
        localStorage.removeItem('finalyze_auth_user');
      } catch {}
    };
    window.addEventListener('mobile-logout', h);
    return () => window.removeEventListener('mobile-logout', h);
  }, []);

  const doLogin = async () => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      const code = String(e?.code || '');
      if (code.includes('popup-closed') || code.includes('cancelled')) setLoginError(null);
      else if (code.includes('popup-blocked')) setLoginError(lang === 'ar' ? 'النافذة محظورة — اسمح بالنوافذ المنبثقة' : 'Popup blocked — allow popups and retry');
      else if (code.includes('network')) setLoginError(lang === 'ar' ? 'خطأ شبكة — تحقق من الاتصال' : 'Network error — check connection');
      else setLoginError(lang === 'ar' ? 'فشل الدخول — حاول مجدداً' : 'Sign-in failed — try again');
    } finally {
      setLoginBusy(false);
    }
  };

  // على أجهزة سطح المكتب (≥769px): التطبيق الحالي بدون أي تغيير
  if (!isMobile) {
    return (
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );
  }

  // على الجوال (≤768px): يتطلب تسجيل الدخول أولاً مثل الموقع
  if (authLoading) {
    return (
      <div className="mobile-only" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10B981', fontSize: 15, fontWeight: 700 }}>
        Joseph.Trading...
      </div>
    );
  }
  // Desktop parity (App.tsx guest/client mode): a CLIENT opens the app and lands
  // straight on the client home — no login wall. Dev-only sections stay hidden
  // until a developer email signs in via Settings → Developer Login.
  // After a dev logout, Firebase user is null BUT the client home must show
  // (not the login wall) — same as the site returning to the main page.
  if (!user) {
    return (
      <StrictMode>
        <ErrorBoundary>
          <MobileLayout />
        </ErrorBoundary>
      </StrictMode>
    );
  }

  // مسجل الدخول: واجهة MT5 الخاصة بالهاتف فقط — لا تؤثر على سطح المكتب
  return (
    <StrictMode>
      <ErrorBoundary>
        <MobileLayout />
      </ErrorBoundary>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(
  <AppWrapper />
);
