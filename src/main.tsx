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

function AppWrapper() {
  const [isMobile, setIsMobile] = useState<boolean>(false);

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
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
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
