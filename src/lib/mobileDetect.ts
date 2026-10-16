import React from 'react';

/**
 * Joseph.Trading — Mobile Detection Utility
 * يكشف عما إذا كان المستخدم يستخدم جهاز محمول لتطبيق واجهة MT5 الخاصة بالجوال فقط.
 * لا يؤثر على سطح المكتب إطلاقاً.
 */

const MOBILE_USER_AGENT_PATTERNS = [
  /Android/i,
  /webOS/i,
  /iPhone/i,
  /iPad/i,
  /iPod/i,
  /BlackBerry/i,
  /Windows Phone/i,
  /IEMobile/i,
  /Opera Mini/i,
];

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_USER_AGENT_PATTERNS.some((p) => p.test(navigator.userAgent));
}

export function isMobileScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}

export function isMobile(): boolean {
  return isMobileDevice() || isMobileScreen();
}

export function useMobile(): boolean {
  const [mobile, setMobile] = React.useState<boolean>(isMobileScreen());

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return mobile;
}
