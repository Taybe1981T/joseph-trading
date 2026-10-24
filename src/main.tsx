import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { MobileLayout } from './components/mobile/MobileLayout';
import { Language } from './lib/i18n';
import './index.css';
import './styles/mobile_pt1.css';
import './styles/mobile_pt2.css';

(window as any).__BUILD = 'v3.1.0';

function AppWrapper() {
  const [isMobile, setIsMobile] = useState<boolean>(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (isMobile) {
    return <MobileLayout />;
  }

  return (
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<AppWrapper />);
