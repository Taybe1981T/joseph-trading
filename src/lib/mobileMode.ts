import { useState, useEffect } from 'react';
import { isDeveloperEmail, DEVELOPER_EMAILS } from './clientIds';
import { Language } from './i18n';

export type MobileMode = 'developer' | 'client' | 'unknown';

/**
 * Desktop parity (App.tsx processGoogleUser + isDeveloperSession):
 * - developer = email is in DEVELOPER_EMAILS, OR equals the stored dev email,
 *   OR contains 'dev'. Everyone else is a CLIENT.
 * - unknown = no signed-in email at all (client home shows, login required
 *   only for dev-only sections).
 */
export function detectMobileMode(): { mode: MobileMode; email: string; uid: string } {
  try {
    const raw = localStorage.getItem('finalyze_user');
    const o = raw ? JSON.parse(raw) : {};
    const email = String(o.email || '').toLowerCase().trim();
    const uid = String(o.uid || 'anonymous');
    if (!email) return { mode: 'unknown', email: '', uid };
    const devEmail = (localStorage.getItem('finalyze_dev_email') || DEVELOPER_EMAILS[0] || '').toLowerCase();
    const dev = email === devEmail || isDeveloperEmail(email) || email.includes('dev');
    return { mode: dev ? 'developer' : 'client', email, uid };
  } catch {
    return { mode: 'unknown', email: '', uid: 'anonymous' };
  }
}

export function hasClientPlan(): boolean {
  try {
    const raw = localStorage.getItem('finalyze_clients');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr) && arr.length > 0) return true;
  } catch {}
  try {
    if (localStorage.getItem('client_plan_active') === '1') return true;
  } catch {}
  return false;
}

export function useMobileMode() {
  const [info, setInfo] = useState(detectMobileMode);
  const [plan, setPlan] = useState(hasClientPlan);
  useEffect(() => {
    const check = () => { setInfo(detectMobileMode()); setPlan(hasClientPlan()); };
    check();
    window.addEventListener('storage', check);
    const iv = setInterval(check, 5000);
    return () => { window.removeEventListener('storage', check); clearInterval(iv); };
  }, []);
  return { ...info, hasPlan: plan, isDev: info.mode === 'developer', isClient: info.mode === 'client' };
}

export function mobileT(lang: Language, en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
}