import { useState, useEffect } from 'react';
import { isDeveloperEmail } from './clientIds';
import { clientScopeKey } from './clientScope';
import { Language } from './i18n';

export type MobileMode = 'developer' | 'client' | 'unknown';

/**
 * Desktop parity (App.tsx processGoogleUser + isDeveloperSession):
 * - developer = email is one of the developer accounts in DEVELOPER_EMAILS.
 *   Everyone else is a CLIENT.
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
    const dev = isDeveloperEmail(email);
    return { mode: dev ? 'developer' : 'client', email, uid };
  } catch {
    return { mode: 'unknown', email: '', uid: 'anonymous' };
  }
}

export interface MobileSubscription {
  label: string;
  amount: number;
  expiryDate: string;
}

/** The stored plan record, exactly as the desktop site writes it. */
export function readMobileSubscription(): MobileSubscription | null {
  try {
    const o = JSON.parse(localStorage.getItem('active_subscription') || 'null');
    if (!o) return null;
    return {
      label: String(o.label || ''),
      amount: Number(o.amount || 0),
      expiryDate: String(o.expiryDate || ''),
    };
  } catch {
    return null;
  }
}

/** A plan with a past expiryDate is expired and unlocks nothing (desktop parity). */
export function mobileSubscriptionActive(sub: MobileSubscription | null = readMobileSubscription()): boolean {
  if (!sub) return false;
  if (!sub.expiryDate) return true; // granted but not started yet
  const ms = new Date(sub.expiryDate).getTime();
  return isFinite(ms) ? ms > Date.now() : true;
}

function planEmail(email?: string | null): string {
  return (email || detectMobileMode().email || '').toLowerCase().trim();
}

/**
 * "Paid mode": whether the client is currently USING their paid plan. Stored in
 * the SAME per-account key the desktop site uses, so returning to free on the
 * phone is honoured on the site too (and the other way round). Default = paid.
 */
export function mobilePaidMode(email?: string | null): boolean {
  try {
    return localStorage.getItem(clientScopeKey(planEmail(email), 'paid_mode')) !== 'false';
  } catch {
    return true;
  }
}

export function setMobilePaidMode(email: string | null | undefined, paid: boolean): void {
  try {
    localStorage.setItem(clientScopeKey(planEmail(email), 'paid_mode'), paid ? 'true' : 'false');
  } catch {}
}

/**
 * The client explicitly chose "Return to Free Plan". Persisted (desktop parity)
 * so a background grant poll cannot switch the paid plan back on by itself.
 */
export function mobileFreeModeChosen(email?: string | null): boolean {
  try {
    return localStorage.getItem(clientScopeKey(planEmail(email), 'free_mode')) === 'true';
  } catch {
    return false;
  }
}

export function setMobileFreeModeChosen(email: string | null | undefined, chosen: boolean): void {
  try {
    localStorage.setItem(clientScopeKey(planEmail(email), 'free_mode'), chosen ? 'true' : 'false');
  } catch {}
}

/**
 * True when the signed-in account OWNS a running paid plan AND is in paid mode.
 * Desktop parity: `isPlanClient = ownsPaidPlan && paidMode`.
 * A developer account always counts as paid.
 */
export function isMobilePlanClient(email?: string | null): boolean {
  const info = detectMobileMode();
  if (info.mode === 'developer') return true;
  if (!info.email) return false;
  if (!mobilePaidMode(email || info.email)) return false;
  return mobileSubscriptionActive();
}

export function hasClientPlan(): boolean {
  // The real source of truth is the stored subscription: it carries an expiry,
  // so an expired plan must not keep unlocking paid sections.
  const sub = readMobileSubscription();
  if (sub) return mobileSubscriptionActive(sub) && mobilePaidMode();
  // Legacy flag written by an older build when a payment completed.
  try {
    return localStorage.getItem('client_plan_active') === '1' && mobilePaidMode();
  } catch {
    return false;
  }
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