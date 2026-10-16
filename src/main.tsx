import {StrictMode, useState, useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { MobileLayout } from './components/mobile/MobileLayout';
import { initMoneytizer } from './lib/moneytizer';
import './index.css';
import './styles/mobile.css';

(window as any).__BUILD = 'v3.1.0';
initMoneytizer();

function AppWrapper() {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

  // على الجوال (≤768px): واجهة MT5 الخاصة بالهاتف فقط — لا تؤثر على سطح المكتب
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
