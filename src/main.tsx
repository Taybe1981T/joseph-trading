import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { MobileLayout } from './components/mobile/MobileLayout';
import { Language } from './lib/i18n';
import './index.css';
import './styles/mobile_pt1.css';
import './styles/mobile_pt2.css';

(window as any).__BUILD = 'v3.2.0';

/** Phone layout? Decided SYNCHRONOUSLY, before the first render. */
function detectIsMobile(): boolean {
  try {
    const forced = new URLSearchParams(window.location.search).get('mobile') === '1';
    return window.matchMedia('(max-width: 768px)').matches || forced;
  } catch {
    return false;
  }
}

function AppWrapper() {
  // IMPORTANT: this must never start as `false` and flip later. With `false`
  // the desktop <App /> mounted for one render on a phone and its "no signed-in
  // user" effect deleted `active_subscription` from localStorage — which silently
  // destroyed a paid client's plan before the mobile layout ever loaded.
  const [isMobile, setIsMobile] = useState<boolean>(() => detectIsMobile());

  // Firebase auth يعمل في الخلفية فقط — لا يوقف عرض واجهة الموبايل إطلاقاً
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u: User | null) => {
      try {
        if (u?.email) {
          localStorage.setItem('finalyze_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
          localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
        }
      } catch {}
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    // `?mobile=1` lets the phone layout be opened on a desktop browser (useful
    // to check the mobile store/payment without a phone). Phones are detected
    // by the media query exactly as before.
    const forced = new URLSearchParams(window.location.search).get('mobile') === '1';
    setIsMobile(mq.matches || forced);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches || forced);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // الموبايل: يعرض MobileLayout فوراً لكل زائر، بدون بوابة تسجيل دخول، بدون انتظار Firebase
  if (isMobile) {
    return (
      <StrictMode>
        <ErrorBoundary>
          <MobileLayout />
        </ErrorBoundary>
      </StrictMode>
    );
  }

  // سطح المكتب: التطبيق الأصلي دون أي تعديل
  return (
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<AppWrapper />);
