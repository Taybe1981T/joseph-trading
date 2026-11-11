import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { MobileBottomNav, MobileTab } from './MobileBottomNav';
import { MobileHeader } from './MobileHeader';
import { MobileHome } from './MobileHome';
import { MobileQuotes, MobileQuote } from './MobileQuotes';
import { useLiveQuotes } from './useLiveQuotes';
import { MobilePositions, MobilePosition } from './MobilePositions';
import { MobileNewTrade } from './MobileNewTrade';
import { MobileSettings } from './MobileSettings';
import { MobileProfile } from './MobileProfile';
import { MobileTradeDialog } from './MobileTradeDialog';
import { MobileSignalDetail } from './MobileSignalDetail';
import { Language } from '../../lib/i18n';
import { isDeveloperEmail, DEVELOPER_EMAILS, clientDocId } from '../../lib/clientIds';
import { isGoogleOrMicrosoftEmail } from '../../lib/authPolicy';
import { installUiClickSound } from '../../lib/uiClickSound';
import {
  detectMobileMode,
  isMobilePlanClient,
  mobilePaidMode,
  setMobilePaidMode,
  mobileFreeModeChosen,
  setMobileFreeModeChosen,
  readMobileSubscription,
  mobileSubscriptionActive,
} from '../../lib/mobileMode';
import { fetchUserGrants, activateClientPlan, revokeClientPlanGrants, toMillis as grantTimeMillis } from '../../services/paymentRequests';
import { MobileAnalysis } from './MobileAnalysis';
import { readMobileAuto, isMobileRadarOn, startMobileRadar, stopMobileRadar } from '../../services/mobileAnalysisEngine';
import { MobileManualSheet } from './MobileManualSheet';
import { MobileClientMonitor } from './MobileClientMonitor';
import TransactionsPage from '../TransactionsPage';
import { useMobileSignalAlert } from './useMobileSignalAlert';
import { AnalysisResult, SignalType } from '../../types';
import {
  isMobileAutoTradeOn,
  setMobileAutoTrade,
  listMobileTrades,
  readMobileAccount,
  syncMobileAutoEngine,
  closeMobileTrade,
  startMobilePositionManager,
} from '../../services/mobileTradeBridge';
import { auth, db } from '../../lib/firebase';
import { signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import StorePage from '../StorePage';
import PaymentModal from '../PaymentModal';
import type { StoreBot } from '../../services/storeService';
import { getLivePrices, calcPnl } from '../../services/paperTradingService';
import { rememberBuyerEmail, setCurrentUserEmail } from '../../lib/clientScope';

interface MobileSignal {
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  change: number;
  changePercent: number;
}

const TITLES: Record<MobileTab, string> = {
  home: 'Joseph.Trading', quotes: 'Market Watch', positions: 'Open Positions', trade: 'Trading Platform',
  settings: 'Settings', profile: 'Profile', analysis: 'Auto Analysis', manual: 'Manual Analysis', store: 'Store', clients: 'Clients', transactions: 'My Transactions',
};

export function MobileLayout({ children }: { children?: React.ReactNode }) {
  const quotes = useLiveQuotes();
  const [tab, setTab] = useState<MobileTab>('home');
  // Back-navigation history: every section jump pushes the previous tab, Back pops it (desktop parity: always a way back)
  const histRef = useRef<MobileTab[]>([]);
  const goTab = useCallback((t: MobileTab) => {
    setTab((cur) => {
      if (cur !== t && histRef.current[histRef.current.length - 1] !== cur) histRef.current.push(cur);
      return t;
    });
  }, []);
  const goBack = useCallback(() => {
    const prev = histRef.current.pop();
    setTab(prev || 'home');
  }, []);
  const goHome = useCallback(() => {
    histRef.current = [];
    setTab('home');
  }, []);
  const [dialog, setDialog] = useState<MobileQuote | null>(null);
  useEffect(() => {
    const cleanup = installUiClickSound();
    return cleanup;
  }, []);
  const [alert, setAlert] = useState<string | null>(null);
  const [auto, setAuto] = useState(() => isMobileAutoTradeOn());
  const [autoAnalysisOn, setAutoAnalysisOn] = useState(() => isMobileRadarOn() || readMobileAuto().isEnabled);
  const [radarProgress, setRadarProgress] = useState<{ current: string; total: number; index: number; category?: string } | null>(null);
  const toggleAutoAnalysis = useCallback(() => {
    try {
      const s = readMobileAuto();
      const v = !s.isEnabled;
      localStorage.setItem('auto_settings', JSON.stringify({ ...s, isEnabled: v }));
      setAutoAnalysisOn(v);
      if (v) {
        setRadarProgress(null);
        // Read the signed-in identity from storage instead of the component's
        // state: this callback has an empty dependency list, and the old code
        // shadowed the `email` state with itself ("Cannot access 'email' before
        // initialization"), which crashed the toggle on first use.
        const info = detectMobileMode();
        startMobileRadar(info.uid, info.email, (p) => setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category }), (r) => {
          setRadarProgress(null);
        });
      } else {
        stopMobileRadar();
        setRadarProgress(null);
      }
      window.dispatchEvent(new CustomEvent('mobile-radar-settings'));
    } catch {}
  }, []);
  useEffect(() => {
    const sync = () => { try { setAutoAnalysisOn(isMobileRadarOn() && readMobileAuto().isEnabled); } catch {} };
    sync();
    const iv = setInterval(sync, 3000);
    window.addEventListener('storage', sync);
    window.addEventListener('mobile-radar-settings', sync);
    return () => { clearInterval(iv); window.removeEventListener('storage', sync); window.removeEventListener('mobile-radar-settings', sync); };
  }, []);
  const [sound, setSound] = useState(true);
  const [lang, setLang] = useState<Language>(() => {
    try {
      const s = localStorage.getItem('language');
      return (s === 'ar' || s === 'en') ? (s as Language) : 'en';
    } catch { return 'en'; }
  });
  const [isDark, setIsDark] = useState(() => {
    try { return localStorage.getItem('theme') !== 'light'; } catch { return true; }
  });
  const [signals, setSignals] = useState<MobileSignal[]>([]);
  const [fullSignals, setFullSignals] = useState<AnalysisResult[]>([]);
  const [detail, setDetail] = useState<AnalysisResult | null>(null);
  const [positions, setPositions] = useState<MobilePosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<any[]>([]);
  const [balance, setBalance] = useState(10000);
  const [equity, setEquity] = useState(10000);
  const [selSym, setSelSym] = useState<string | null>(null);
  const [showStore, setShowStore] = useState(false);
  // ── Store + payment (desktop parity) ───────────────────────────────────
  // The mobile tab renders the SAME <StorePage> the desktop site uses, and a
  // purchase is handed to the SAME <PaymentModal>, so every product, plan,
  // price and payment method is identical on both. A client (not only a
  // developer) can buy, exactly like on the site.
  const [storePlan, setStorePlan] = useState<{ amount: number; label: string; durationDays: number; planUnit?: string; planUnits?: number } | null>(null);
  const [storeBot, setStoreBot] = useState<StoreBot | null>(null);
  const [mobileSub, setMobileSub] = useState<{ label: string; amount: number; expiryDate: string } | null>(() => {
    try {
      const o = JSON.parse(localStorage.getItem('active_subscription') || 'null');
      return o && o.expiryDate
        ? { label: String(o.label || ''), amount: Number(o.amount || 0), expiryDate: String(o.expiryDate) }
        : null;
    } catch { return null; }
  });
  // Paid mode / explicit free-mode choice — SAME per-account keys as the desktop
  // site, so a client can move between paid and free on either device and the
  // other side follows.
  const [planPaid, setPlanPaid] = useState<boolean>(() => mobilePaidMode());
  const [freeChosen, setFreeChosen] = useState<boolean>(() => mobileFreeModeChosen());
  const [isDev, setIsDev] = useState(false);
  // Initialise from storage (not '') so the plan-restore effect sees the real
  // identity on the very first render instead of treating a returning client as
  // a guest and wiping their stored plan.
  const [email, setEmail] = useState<string>(() => {
    try {
      const raw = localStorage.getItem('finalyze_user');
      return raw ? String(JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
    } catch { return ''; }
  });
  const [clientCount, setClientCount] = useState(0);
  const [savedAccounts, setSavedAccounts] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('finalyze_saved_accounts') || '[]'); } catch { return []; }
  });
  const [customAvatar, setCustomAvatar] = useState(() => {
    try {
      const u = localStorage.getItem('finalyze_user') || localStorage.getItem('finalyze_auth_user');
      const parsed = u ? JSON.parse(u) : null;
      const email = parsed?.email || '';
      return email ? (localStorage.getItem('finalyze_custom_avatar_' + email) || null) : null;
    } catch { return null; }
  });
  const [customLogo, setCustomLogo] = useState(() => {
    try {
      const u = localStorage.getItem('finalyze_user') || localStorage.getItem('finalyze_auth_user');
      const parsed = u ? JSON.parse(u) : null;
      const email = parsed?.email || '';
      return email ? (localStorage.getItem('finalyze_custom_logo_' + email) || null) : null;
    } catch { return null; }
  });
  const [following, setFollowing] = useState(() => localStorage.getItem('finalyze_following') === 'true');

  const toggleFollowing = () => {
    const next = !following;
    setFollowing(next);
    try { localStorage.setItem('finalyze_following', String(next)); } catch {}
  };

  // Firebase auth state
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Turn a Firebase auth error into something the user can actually act on.
  // Before this, every failure was only written to the console, so a blocked
  // popup looked exactly like "the app stayed on the guest screen".
  const loginErrorText = (e: any, isAr: boolean) => {
    const code = String(e?.code || e?.message || '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return isAr ? 'أُغلقت نافذة الدخول قبل إكماله. أعد المحاولة.' : 'The sign-in window closed before finishing. Try again.';
    }
    if (code === 'auth/popup-blocked') {
      return isAr ? 'المتصفح منع النافذة المنبثقة. جرّب مرة أخرى.' : 'The browser blocked the sign-in popup. Try again.';
    }
    if (code === 'auth/unauthorized-domain') {
      return isAr
        ? `النطاق (${window.location.hostname}) غير مصرّح به في Firebase.`
        : `This domain (${window.location.hostname}) is not authorised in Firebase.`;
    }
    if (code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') {
      return isAr
        ? 'المتصفح يمنع تسجيل الدخول (وضع التصفح الخفي أو متصفح داخل تطبيق). افتح الموقع في Chrome أو Safari.'
        : 'This browser blocks sign-in (private mode or an in-app browser). Open the site in Chrome or Safari.';
    }
    if (code === 'no_email') {
      return isAr ? 'لم يتم الحصول على بريد الحساب. أعد المحاولة.' : 'No account email was returned. Try again.';
    }
    return code || (isAr ? 'تعذر تسجيل الدخول. أعد المحاولة.' : 'Sign-in failed. Try again.');
  };

  // Full-page redirect sign-in: this completes the sign-in when Google sends
  // the browser back to the site.
  useEffect(() => {
    let cancelled = false;
    getRedirectResult(auth)
      .then((result) => {
        if (cancelled || !result?.user?.email) return;
        const em = result.user.email.toLowerCase().trim();
        setUser(result.user);
        setEmail(em);
        setIsDev(isDeveloperEmail(em));
        try {
          localStorage.setItem('finalyze_user', JSON.stringify({ email: em, uid: result.user.uid }));
          localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: em, uid: result.user.uid }));
          localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
          const raw = localStorage.getItem('finalyze_saved_accounts');
          const arr: unknown = raw ? JSON.parse(raw) : [];
          const list = Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase().trim()) : [];
          const next = [em, ...list.filter((x) => x && x !== em)].slice(0, 8);
          localStorage.setItem('finalyze_saved_accounts', JSON.stringify(next));
          setSavedAccounts(next);
        } catch {}
      })
      .catch((e) => {
        if (!cancelled) setLoginError(loginErrorText(e, lang === 'ar'));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const check = () => {
      try {
        const raw = localStorage.getItem('finalyze_user');
        const em = raw ? String(JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
        setEmail(em);
        setIsDev(isDeveloperEmail(em));
      } catch { setIsDev(false); }
      try {
        const raw = localStorage.getItem('finalyze_clients');
        const arr = raw ? JSON.parse(raw) : [];
        setClientCount(Array.isArray(arr) ? arr.length : 0);
      } catch { setClientCount(0); }
    };
    check();
    window.addEventListener('storage', check);
    const iv = setInterval(check, 5000);
    return () => { window.removeEventListener('storage', check); clearInterval(iv); };
  }, []);

  // Firebase auth effect
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u?.email) {
        const em = u.email.toLowerCase().trim();
        // Reflect the live identity immediately. Waiting for the 5-second
        // localStorage poll made a successful login look like it did nothing.
        setEmail(em);
        setIsDev(isDeveloperEmail(em));
        try {
          localStorage.setItem('finalyze_user', JSON.stringify({ email: em, uid: u.uid }));
          localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: em, uid: u.uid }));
          localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
        } catch {}
      }
      setLoadingAuth(false);
    });
    const t = setTimeout(() => setLoadingAuth(false), 3000);
    return () => { unsub(); clearTimeout(t); };
  }, []);

  // Keep the mobile avatar/logo in sync with the account that is signed in.
  // They are stored per-email, so switching accounts must not keep the previous
  // account's photo on screen.
  useEffect(() => {
    const em = (user?.email || email || '').toLowerCase().trim();
    if (!em) { setCustomAvatar(null); setCustomLogo(null); return; }
    try {
      setCustomAvatar(localStorage.getItem('finalyze_custom_avatar_' + em) || null);
      setCustomLogo(localStorage.getItem('finalyze_custom_logo_' + em) || null);
    } catch {}
  }, [user?.email, email]);

  // ── Paid plan on the phone (desktop parity) ─────────────────────────────
  // A plan belongs to ONE account: it is restored only when the signed-in email
  // matches the email stored with it, it is dropped on logout, and it disappears
  // the moment its expiry passes. This is the exact logic App.tsx uses.
  const signedInEmail = (user?.email || email || '').toLowerCase().trim();
  useEffect(() => {
    setPlanPaid(mobilePaidMode(signedInEmail));
    setFreeChosen(mobileFreeModeChosen(signedInEmail));
    if (!signedInEmail) {
      // Not signed in: HIDE the plan, but do not delete it. The record carries
      // its owner's email, so nobody else can ever see it, and the real owner
      // gets it back on the next sign-in (desktop parity).
      setMobileSub(null);
      return;
    }
    try {
      const raw = localStorage.getItem('active_subscription');
      if (!raw) { setMobileSub(null); return; }
      const sub = JSON.parse(raw);
      const subEmail = String(sub?.email || '').toLowerCase().trim();
      if (subEmail && subEmail !== signedInEmail) { setMobileSub(null); return; }
      if (sub?.expiryDate && new Date(sub.expiryDate).getTime() <= Date.now()) {
        localStorage.removeItem('active_subscription');
        setMobileSub(null);
        return;
      }
      setMobileSub({
        label: String(sub.label || ''),
        amount: Number(sub.amount || 0),
        expiryDate: String(sub.expiryDate || ''),
      });
    } catch { setMobileSub(null); }
  }, [signedInEmail]);

  // Plan reached its expiry while the app is open → back to free, like the site.
  useEffect(() => {
    const iv = setInterval(() => {
      const sub = readMobileSubscription();
      if (!sub?.expiryDate) return;
      const ms = new Date(sub.expiryDate).getTime();
      if (!isFinite(ms) || ms > Date.now()) return;
      try { localStorage.removeItem('active_subscription'); } catch {}
      setMobileSub(null);
      setPlanPaid(false);
      setFreeChosen(true);
      setMobilePaidMode(signedInEmail, false);
      setMobileFreeModeChosen(signedInEmail, true);
    }, 30000);
    return () => clearInterval(iv);
  }, [signedInEmail]);

  // Pick up a plan the developer approved on ANOTHER device (bought on the
  // desktop site, opened later on the phone). The grants endpoint is the source
  // of truth, so the same paid plan appears on both without re-buying it.
  useEffect(() => {
    if (!signedInEmail || isDeveloperEmail(signedInEmail)) return;
    let stopped = false;
    const checkGrant = async () => {
      try {
        const grants = await fetchUserGrants(signedInEmail);
        if (stopped) return;
        const planGrants = grants.filter((g) => g.kind === 'plan' && g.status === 'active');
        if (!planGrants.length) return;
        const started = planGrants
          .filter((g) => g.expiryDate && !isNaN(new Date(g.expiryDate).getTime()) && new Date(g.expiryDate).getTime() > Date.now())
          .sort((a, b) => new Date(b.expiryDate!).getTime() - new Date(a.expiryDate!).getTime());
        const pendingKey = planGrants.filter((g) => !g.expiryDate || isNaN(new Date(g.expiryDate).getTime()));
        const best = started[0] || pendingKey[0];
        if (!best) return;
        // Renewals stack: first release = earliest start, visible end = latest.
        const starts = planGrants
          .map((g) => grantTimeMillis(g.activatedAt || g.releasedAt))
          .filter((n) => isFinite(n) && n > 0);
        const firstReleaseIso = starts.length
          ? new Date(Math.min(...starts)).toISOString()
          : (best.createdAt ? new Date(grantTimeMillis(best.createdAt) || Date.now()).toISOString() : new Date().toISOString());
        const next = {
          label: best.planLabel || 'Plan',
          amount: Number(best.amountUsd || 0),
          activatedAt: firstReleaseIso,
          firstReleasedAt: firstReleaseIso,
          expiryDate: best.expiryDate || '',
          requestNo: best.requestNo,
          durationDays: best.durationDays,
          planUnit: best.planUnit,
          planUnits: best.planUnits,
          email: signedInEmail,
        };
        let prev: any = null;
        try { prev = JSON.parse(localStorage.getItem('active_subscription') || 'null'); } catch {}
        const prevEnd = prev?.expiryDate ? new Date(prev.expiryDate).getTime() : 0;
        const thisEnd = next.expiryDate ? new Date(next.expiryDate).getTime() : 0;
        // Never keep a date the server no longer reports (an expired plan must go),
        // but never shorten a renewal that is still valid.
        if (!thisEnd) return;
        const merged = prevEnd > thisEnd && prev
          ? { ...next, expiryDate: prev.expiryDate, label: prev.label || next.label }
          : next;
        try { localStorage.setItem('active_subscription', JSON.stringify(merged)); } catch {}
        setMobileSub({ label: merged.label, amount: merged.amount, expiryDate: merged.expiryDate });
        if (!mobileFreeModeChosen(signedInEmail)) {
          setPlanPaid(true);
          setMobilePaidMode(signedInEmail, true);
        }
      } catch {}
    };
    checkGrant();
    const iv = setInterval(checkGrant, 60000);
    // Coming back to the app (unlock / tab switch) is the moment a client
    // expects their plan to be there — do not make them wait for the 60s tick.
    const wake = () => { if (document.visibilityState === 'visible') void checkGrant(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [signedInEmail]);

  // Plan entitlements (desktop parity): a client in paid mode with a running
  // plan gets the SAME analysis tools as a developer — Auto Analysis + Manual —
  // and the one-tap auto-analysis switch in the header.
  const planActive = !!mobileSub && mobileSubscriptionActive(mobileSub);
  const isPlanClient = !isDev && planActive && planPaid;
  const canUseAnalysis = isDev || isPlanClient;
  // Losing the plan (expired / returned to free / signed out) must not leave the
  // client stranded on a paid screen that no longer renders.
  useEffect(() => {
    if (!canUseAnalysis && (tab === 'analysis' || tab === 'manual')) {
      histRef.current = [];
      setTab('home');
    }
  }, [canUseAnalysis, tab]);

  // Auto-restart radar if enabled but not running (ensures analysis continues across tab navigation)
  useEffect(() => {
    const ensureRadar = () => {
      try {
        const s = readMobileAuto();
        if (s.isEnabled && !isMobileRadarOn()) {
          const uid = (user?.uid || 'anonymous');
          const emailVal = (user?.email || email || '');
          startMobileRadar(uid, emailVal, (p) => setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category }), (r) => {
            setRadarProgress(null);
          });
        }
      } catch {}
    };
    ensureRadar();
    const iv = setInterval(ensureRadar, 10000);
    return () => clearInterval(iv);
  }, [user, email]);

  // Login / logout helpers
  const doLogin = async (emailHint?: string) => {
    setLoadingAuth(true);
    setLoginError(null);
    try {
      const provider = new GoogleAuthProvider();
      const params: Record<string, string> = { prompt: 'select_account' };
      if (emailHint) params.login_hint = emailHint;
      provider.setCustomParameters(params);
      // Full-page redirect is the default on phones: popups are routinely
      // blocked in mobile browsers and in-app webviews, and a blocked popup used
      // to leave the visitor stuck as a guest. getRedirectResult below finishes
      // the sign-in when Google sends the browser back.
      await signInWithRedirect(auth, provider);
      return;
    } catch (e: any) {
      console.error(e);
      setLoginError(loginErrorText(e, lang === 'ar'));
    } finally {
      setLoadingAuth(false);
    }
  };

  const doLogout = async () => {
    try {
      await signOut(auth);
    } catch {}
    try {
      localStorage.removeItem('finalyze_user');
      localStorage.removeItem('finalyze_auth_user');
      localStorage.removeItem('finalyze_dev_email');
      // Per-account assets (finalyze_custom_avatar_<email>) are intentionally
      // NOT deleted: signing out must not erase the owner's picture. They are
      // scoped by email, so another account can never read them.
    } catch {}
    setUser(null);
    setEmail('');
    setIsDev(false);
    try { window.location.reload(); } catch {}
  };

  const onProfileImageChange = (url: string) => {
    setCustomAvatar(url);
    try {
      const u = localStorage.getItem('finalyze_user') || localStorage.getItem('finalyze_auth_user');
      const parsed = u ? JSON.parse(u) : null;
      const email = parsed?.email || '';
      if (email) localStorage.setItem('finalyze_custom_avatar_' + email, url);
    } catch {}
  };

  const onLogoChange = (url: string) => {
    setCustomLogo(url);
    try {
      const u = localStorage.getItem('finalyze_user') || localStorage.getItem('finalyze_auth_user');
      const parsed = u ? JSON.parse(u) : null;
      const email = parsed?.email || '';
      if (email) localStorage.setItem('finalyze_custom_logo_' + email, url);
    } catch {}
  };

  // Modal for login
  const [showLoginModal, setShowLoginModal] = useState(false);

  // (click sounds disabled to debug freeze)
  const setAutoBoth = useCallback((v: boolean) => {
    setAuto(v);
    setMobileAutoTrade(v);
    // Force the shared engine to resync immediately (same-tab toggles don't re-run effects).
    try { window.dispatchEvent(new CustomEvent('mobile-autotrade-resync')); } catch {}
  }, []);

  // Sync the shared mobile auto engine with the SAME home-page signals (desktop parity: App.tsx).
  useEffect(() => {
    syncMobileAutoEngine(fullSignals);
  }, [fullSignals]);

  const loadAll = useCallback(async () => {
    try {
      const merged: any[] = [];
      // Auto radar signals (same as desktop AnalysisResults) - only for developers
      if (isDev) {
        try {
          const raw = localStorage.getItem('top_signals_persistent');
          const auto = raw ? JSON.parse(raw) : [];
          if (Array.isArray(auto)) {
            merged.push(...auto.filter((s: any) => s && s.signal !== 'neutral' && s.signal !== 'no_entry' && !s.isSideways).map((s: any) => ({ ...s, source: s.source || 'auto' })));
          }
        } catch {}
      }
      // Manual analysis results (same as desktop — always in sync)
      try {
        const mraw = localStorage.getItem('manual_results');
        const man = mraw ? JSON.parse(mraw) : [];
        if (Array.isArray(man)) {
          merged.push(...man.filter((s: any) => s && s.signal && s.signal !== 'neutral').map((s: any) => ({ ...s, source: 'manual' })));
        }
      } catch {}
      // de-dup by symbol+timeframe (first occurrence wins)
      const seen = new Set<string>();
      const full: any[] = [];
      for (const s of merged) {
        const k = `${s.symbol}_${s.timeframe || ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        full.push(s);
      }
      full.sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
      // Only update state when the data really changed (avoids needless re-renders every 5s).
      const nextFull = full.slice(0, 40);
      setFullSignals((prev) => {
        if (nextFull.length === 0 && prev.length > 0) return prev;
        try { if (JSON.stringify(prev) === JSON.stringify(nextFull)) return prev; } catch {}
        return nextFull as AnalysisResult[];
      });
      setSignals(full.map((s: any) => ({
        symbol: String(s.symbol || ''),
        type: (String(s.signal || '').includes('sell') ? 'sell' : 'buy') as 'buy' | 'sell',
        price: Number(s.entryPrice ?? s.price ?? 0),
        change: Number(s.change ?? 0),
        changePercent: Number(s.changePercent ?? 0),
      })).filter((s) => s.symbol));
    } catch {}
    // Account: same store as desktop (balance + leverage aware).
    try {
      const acc = await readMobileAccount();
      if (typeof acc.balance === 'number') setBalance(acc.balance);
    } catch {}
    // Positions tab: read open trades from the SAME store (auto + manual) — no mock fills.
    try {
      const all = await listMobileTrades();
      const open = all.filter((t: any) => t.status === 'open');
      // History tab: closed trades from the SAME store (desktop parity: History tab).
      const closed = all
        .filter((t: any) => t.status === 'closed')
        .slice()
        .sort((a: any, b: any) => (b.closedAt || 0) - (a.closedAt || 0))
        .slice(0, 60)
        .map((t: any) => ({
          id: String(t.id), symbol: String(t.symbol),
          type: (t.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
          volume: Number(t.qty ?? 0.01),
          openPrice: Number(t.entryPrice ?? 0),
          exitPrice: Number(t.exitPrice ?? t.entryPrice ?? 0),
          profit: Number(t.pnl ?? 0),
          openedAt: t.openedAt != null ? Number(t.openedAt) : undefined,
          closedAt: t.closedAt != null ? Number(t.closedAt) : undefined,
          closeReason: t.closeReason ? String(t.closeReason) : null,
          source: t.source === 'manual' ? 'manual' : 'auto',
        }));
      setClosedTrades(closed);
      const mapped: MobilePosition[] = open.map((t: any) => {
        const cur = Number(t.currentPrice ?? t.entryPrice ?? 0);
        const op = Number(t.entryPrice ?? 0);
        return {
          id: String(t.id), symbol: String(t.symbol),
          type: (t.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
          volume: Number(t.qty ?? t.volume ?? 0.01), openPrice: op, currentPrice: cur,
          profit: 0, // live P&L is computed in MobilePositions via the same quote path
          // Full original-account details (desktop parity: TradeNowPage table)
          category: t.category ? String(t.category) : undefined,
          sl: t.sl != null ? Number(t.sl) : null,
          tp: t.tp != null ? Number(t.tp) : null,
          openedAt: t.openedAt != null ? Number(t.openedAt) : undefined,
          source: t.source === 'manual' ? 'manual' : 'auto',
        };
      });
      // Hydrate live prices once for an instant accurate display.
      // ONE batched request for all open symbols instead of one per position.
      try {
        const syms = [...new Set(mapped.map((m) => m.symbol))];
        const prices = await getLivePrices(syms);
        for (const m of mapped) {
          const p = prices.get(m.symbol);
          if (p != null && p > 0) {
            m.currentPrice = p;
            const t = open.find((x: any) => String(x.id) === m.id);
            if (t) {
              m.profit = calcPnl(t as any, p);
            }
          }
        }
      } catch {}
      setPositions(mapped);
    } catch {}
  }, [isDev]);

  // Live store sync: trades opened/closed (auto engine or this device) refresh instantly.
  // IMPORTANT: this effect must NOT depend on fullSignals. loadAll() calls
  // setFullSignals(new array) every run, so depending on it created an endless
  // render loop (loadAll -> setFullSignals -> effect re-run -> loadAll ...) that
  // froze the mobile UI. The latest signals are read through a ref instead.
  const fullSignalsRef = useRef<AnalysisResult[]>([]);
  useEffect(() => { fullSignalsRef.current = fullSignals; }, [fullSignals]);

  useEffect(() => {
    loadAll();
    // Desktop parity: background TP/SL/trailing manager for ALL open trades.
    try { startMobilePositionManager(); } catch {}
    const iv = setInterval(loadAll, 3000);
    const h = () => { loadAll(); };
    const rs = () => { syncMobileAutoEngine(fullSignalsRef.current); };
    window.addEventListener('mobile-trades-changed', h);
    window.addEventListener('mobile-autotrade-resync', rs);
    return () => {
      clearInterval(iv);
      window.removeEventListener('mobile-trades-changed', h);
      window.removeEventListener('mobile-autotrade-resync', rs);
    };
  }, [loadAll]);
  // CLIENT: Poll radar status from developer (same as desktop) - only in FREE
  // mode. A paid-plan client runs their own radar, so mirroring the developer's
  // status here would immediately undo the client's own on/off switch.
  useEffect(() => {
    const userEmail = (user?.email || email || '').toLowerCase().trim();
    const isDev = isDeveloperEmail(userEmail);
    if (isDev || isPlanClient) return;

    const checkRadarStatus = async () => {
      try {
        const snap = await getDocs(collection(db, 'shared_status'));
        if (snap.empty) return;
        let latestData: any = null;
        let latestTs = 0;
        snap.forEach(d => {
          const dta = d.data();
          let ts = 0;
          if (dta.timestamp) {
            if (typeof dta.timestamp === 'string') ts = new Date(dta.timestamp).getTime();
            else if (typeof dta.timestamp === 'number') ts = dta.timestamp;
          }
          if (ts >= latestTs) { latestTs = ts; latestData = dta; }
        });
        if (latestData) {
          const running = latestData.isRunning === true;
          setAutoAnalysisOn(running);
        }
      } catch (e) {
        console.warn('[CLIENT] Failed to check radar status:', e);
      }
    };
    checkRadarStatus();
    const iv = setInterval(checkRadarStatus, 10000);
    return () => clearInterval(iv);
  }, [user, email, isPlanClient]);



  // CLIENT: Poll Firestore for shared signals from desktop (same as desktop client logic).
  // Paid-plan clients run their own analysis instead (desktop parity).
  useEffect(() => {
    const userEmail = (user?.email || email || '').toLowerCase().trim();
    const isDev = isDeveloperEmail(userEmail);
    if (isDev || isPlanClient) return;

    const pollFirestore = async () => {
      try {
        const snap = await getDocs(collection(db, 'shared_results'));
        if (snap.empty) return;
        let latestData: any = null;
        let latestTs = 0;
        snap.forEach(d => {
          const dta = d.data();
          let ts = 0;
          if (dta.timestamp) {
            if (typeof dta.timestamp === 'string') ts = new Date(dta.timestamp).getTime();
            else if (typeof dta.timestamp === 'number') ts = dta.timestamp;
          }
          if (ts >= latestTs) { latestTs = ts; latestData = dta; }
        });
        if (!latestData || !Array.isArray(latestData.results)) return;
        const firestoreSignals = latestData.results.filter((s: any) => s && s.signal !== 'neutral' && s.signal !== 'no_entry' && !s.isSideways).map((s: any) => ({ ...s, source: s.source || 'auto' }));
        if (firestoreSignals.length > 0) {
          setFullSignals((prev) => {
            const seen = new Set<string>();
            const merged: any[] = [];
            for (const s of firestoreSignals) {
              const k = `${s.symbol}_${s.timeframe || ''}`;
              if (seen.has(k)) continue;
              seen.add(k);
              merged.push(s);
            }
            for (const s of prev) {
              const k = `${s.symbol}_${s.timeframe || ''}`;
              if (seen.has(k)) continue;
              seen.add(k);
              merged.push(s);
            }
            merged.sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
            return merged.slice(0, 40) as any;
          });
        }
      } catch (e) {
        console.warn('[CLIENT] Failed to poll Firestore:', e);
      }
    };
    pollFirestore();
    const iv = setInterval(pollFirestore, 10000);
    return () => clearInterval(iv);
  }, [user, email, isPlanClient]);

  const ping = (freq: number) => {
    if (!sound) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      o.start(); o.stop(ctx.currentTime + 0.3);
    } catch {}
  };

  const openTrade = (sym: string, type: 'buy' | 'sell', vol: number) => {
    ping(type === 'buy' ? 880 : 440);
    setAlert((lang === 'ar' ? 'تم إرسال الأمر: ' : 'Order sent: ') + type.toUpperCase() + ' ' + vol.toFixed(2) + ' ' + sym);
    setTimeout(() => setAlert(null), 4000);
    // Refresh account + open trades from the SAME store (auto/manual included).
    loadAll();
    if (tab === 'trade') goTab('positions');
  };

  const closeTradeById = useCallback(async (id: string) => {
    try { await closeMobileTrade(id); } catch {}
    loadAll();
  }, [loadAll]);

  // A plan/product was chosen in the store: open the same PaymentModal the
  // desktop site opens for the very same choice.
  const startStorePayment = (
    plan: { amount: number; label: string; durationDays: number; planUnit?: string; planUnits?: number } | null,
    bot: StoreBot | null,
  ) => {
    setStorePlan(plan);
    setStoreBot(bot);
  };

  // Same post-payment work as the desktop handler (App.tsx): the buyer is
  // registered as a client under the payment email and the plan is stored
  // locally with its real expiry, so My Plan / the plan gate agree everywhere.
  const completeStorePayment = async (grantInfo?: { expiryDate?: string; requestNo?: number }) => {
    const plan = storePlan;
    const buyerEmail = (user?.email || email || '').toLowerCase().trim();
    const serverExpiry = grantInfo?.expiryDate ? new Date(grantInfo.expiryDate) : null;
    const fallbackDays = Number(plan?.durationDays) > 0 ? Number(plan.durationDays) : 30;
    const expiry = serverExpiry ?? new Date(Date.now() + fallbackDays * 86400000);
    if (buyerEmail) {
      try { rememberBuyerEmail(buyerEmail, buyerEmail); } catch {}
      try { setCurrentUserEmail(buyerEmail); } catch {}
      try {
        await setDoc(doc(db, 'clients', clientDocId(buyerEmail)), {
          email: buyerEmail,
          status: 'verified',
          plan: 'paid',
          planExpiry: expiry.toISOString(),
          autoRegistered: true,
          updatedAt: serverTimestamp(),
          registeredAt: serverTimestamp(),
          rank: 0,
        }, { merge: true });
      } catch (e) { console.warn('Auto client registration on payment failed:', e); }
      try { localStorage.setItem('client_plan_active', '1'); } catch {}
    }
    const sub = {
      label: plan?.label || '',
      amount: plan?.amount || 0,
      activatedAt: new Date().toISOString(),
      firstReleasedAt: new Date().toISOString(),
      expiryDate: expiry.toISOString(),
      requestNo: grantInfo?.requestNo,
      durationDays: plan?.durationDays,
      planUnit: plan?.planUnit,
      planUnits: plan?.planUnits,
    };
    try { localStorage.setItem('active_subscription', JSON.stringify({ ...sub, email: buyerEmail })); } catch {}
    setMobileSub({ label: sub.label, amount: sub.amount, expiryDate: sub.expiryDate });
    // A new payment reopens paid mode immediately (desktop parity).
    setPlanPaid(true);
    setFreeChosen(false);
    setMobilePaidMode(buyerEmail, true);
    setMobileFreeModeChosen(buyerEmail, false);
    setStorePlan(null);
    setStoreBot(null);
    setAlert(lang === 'ar' ? 'تم تفعيل الخطة بنجاح ✓' : 'Plan activated successfully ✓');
    setTimeout(() => setAlert(null), 5000);
    goTab('store');
  };

  // ── Plan controls used by the store card (identical to the desktop site) ──
  // Return to free: keeps the paid plan OWNED until it expires, but stops using
  // its features and unlocks the free experience right away.
  const returnToFreePlan = () => {
    setFreeChosen(true);
    setPlanPaid(false);
    setMobileFreeModeChosen(signedInEmail, true);
    setMobilePaidMode(signedInEmail, false);
    setAlert(lang === 'ar' ? 'تم الرجوع للخطة المجانية' : 'Returned to the free plan');
    setTimeout(() => setAlert(null), 4000);
  };

  // Re-activate a plan the client still owns.
  const activatePaidPlan = () => {
    if (!mobileSub) return;
    setFreeChosen(false);
    setPlanPaid(true);
    setMobileFreeModeChosen(signedInEmail, false);
    setMobilePaidMode(signedInEmail, true);
    if (signedInEmail) {
      let requestNo: number | null = null;
      try {
        const o = JSON.parse(localStorage.getItem('active_subscription') || 'null');
        if (o?.requestNo != null) requestNo = Number(o.requestNo);
      } catch {}
      activateClientPlan(signedInEmail, requestNo).catch(() => {});
    }
    setAlert(lang === 'ar' ? 'تم تفعيل الخطة المدفوعة ✓' : 'Paid plan activated ✓');
    setTimeout(() => setAlert(null), 4000);
  };

  // Delete/cancel the plan permanently (revokes the server grant too).
  const deleteClientPlan = async () => {
    if (signedInEmail) await revokeClientPlanGrants(signedInEmail).catch(() => {});
    try { localStorage.removeItem('active_subscription'); } catch {}
    try { localStorage.removeItem('client_plan_active'); } catch {}
    setMobileSub(null);
    setPlanPaid(false);
    setFreeChosen(false);
    setMobilePaidMode(signedInEmail, false);
    setMobileFreeModeChosen(signedInEmail, false);
    setAlert(lang === 'ar' ? 'تم حذف الخطة' : 'Plan deleted');
    setTimeout(() => setAlert(null), 4000);
  };

  const pickSymbol = (s: string) => {
    const q = quotes.find((x) => x.symbol === s);
    if (q) setDialog(q); else { setSelSym(s); goTab('trade'); }
  };

  const removeSignal = (sym: string) => {
    try {
      const raw = localStorage.getItem('top_signals_persistent');
      const arr = raw ? JSON.parse(raw) : [];
      const next = (Array.isArray(arr) ? arr : []).filter((s: any) => String(s.symbol) !== sym);
      localStorage.setItem('top_signals_persistent', JSON.stringify(next));
    } catch {}
    try {
      const raw = localStorage.getItem('manual_results');
      const arr = raw ? JSON.parse(raw) : [];
      const next = (Array.isArray(arr) ? arr : []).filter((s: any) => String(s.symbol) !== sym);
      localStorage.setItem('manual_results', JSON.stringify(next));
    } catch {}
    loadAll();
  };

  const signalFor = useCallback((sym: string) => fullSignals.find((r) => r.symbol === sym), [fullSignals]);

  const [freshCount, setFreshCount] = useState(0);
  useMobileSignalAlert(useCallback((n: number) => {
    loadAll();
    setFreshCount(n);
    ping(880);
    setAlert((lang === 'ar' ? 'إشارة جديدة: ' : 'New signal: ') + n);
    setTimeout(() => { setAlert(null); setFreshCount(0); }, 8000);
  }, [loadAll, lang]));

  const runManual = (results: any[]) => {
    loadAll();
    const first = results && results[0];
    const sym = first ? String(first.symbol || '') : '';
    ping(660);
    setAlert((lang === 'ar' ? 'تحليل يدوي مكتمل: ' : 'Manual analysis done: ') + (sym || (results ? results.length : 0) + ' signals'));
    setTimeout(() => setAlert(null), 5000);
    goHome();
  };

  return (
    <div className="mobile-only" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', paddingBottom: 72 }}>
      <MobileHeader title={TITLES[tab]} lang={lang}
        onLangChange={(l) => { setLang(l); try { localStorage.setItem('language', l); } catch {} }}
        isDark={isDark}
        toggleTheme={() => {
          const v = !isDark; setIsDark(v);
          try { localStorage.setItem('theme', v ? 'dark' : 'light'); } catch {}
          try { if (v) document.body.classList.remove('light'); else document.body.classList.add('light'); } catch {}
        }}
        clientCount={isDev ? clientCount : 0}
        onClientsClick={() => goTab('clients')}
        onNotificationsClick={goHome}
        userEmail={user?.email || email || null}
        avatarUrl={customAvatar || user?.photoURL || null}
        onProfileClick={() => goTab('profile')}
        autoAnalysisRunning={autoAnalysisOn}
        onAutoAnalysisToggle={canUseAnalysis ? toggleAutoAnalysis : undefined} />
      {tab !== 'home' && tab !== 'store' && (
        <button
          type="button"
          onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#F59E0B', fontSize: 13, fontWeight: 800, cursor: 'pointer', padding: '8px 16px 0', alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={15} /> {lang === 'ar' ? 'عودة' : 'Back'}
        </button>
      )}
      {/* Paid plan strip: the client's plan is visible on every section of the
          app, with the same paid/free switch the desktop site has. */}
      {tab !== 'store' && mobileSub && (
        <div style={{ margin: '8px 14px 0', padding: '10px 12px', borderRadius: 12, background: planPaid ? 'rgba(16,185,129,0.12)' : 'rgba(148,163,184,0.12)', border: `1px solid ${planPaid ? 'rgba(16,185,129,0.4)' : 'rgba(148,163,184,0.35)'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: planPaid ? '#10B981' : '#94A3B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {planPaid ? (lang === 'ar' ? 'خطتك المدفوعة' : 'Your paid plan') : (lang === 'ar' ? 'الخطة المدفوعة متوقفة' : 'Paid plan paused')}
              {': '}{mobileSub.label}
            </span>
            <span style={{ fontSize: 11, color: '#9CA3AF' }}>
              {(() => {
                const ms = new Date(mobileSub.expiryDate).getTime();
                if (!isFinite(ms)) return lang === 'ar' ? 'بانتظار المفتاح' : 'Waiting for key';
                const d = Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
                return lang === 'ar' ? `${d} يوم متبقٍ` : `${d} days left`;
              })()}
            </span>
          </div>
          <button
            type="button"
            onClick={() => { if (planPaid) returnToFreePlan(); else activatePaidPlan(); }}
            style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, color: '#fff', background: planPaid ? '#475569' : '#10B981' }}
          >
            {planPaid ? (lang === 'ar' ? 'رجوع للمجانية' : 'Back to Free') : (lang === 'ar' ? 'تفعيل المدفوعة' : 'Activate Paid')}
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', overflowAnchor: 'none' }}>
        {tab === 'home' && <MobileHome fullSignals={fullSignals} lang={lang} onDetail={setDetail} onTrade={(s) => { setSelSym(s); goTab('trade'); }} onRemove={removeSignal} onRemoveAll={() => setFullSignals([])} autoTradeEnabled={auto} onAutoTradeToggle={setAutoBoth} radarOn={freshCount > 0} radarLabel={freshCount > 0 ? (lang === 'ar' ? `${freshCount} إشارة جديدة` : `${freshCount} new signals`) : null} radarProgress={radarProgress} />}
        {tab === 'quotes' && isDev && <MobileQuotes quotes={quotes} onSelect={pickSymbol} />}
        {tab === 'positions' && <MobilePositions positions={positions} closed={closedTrades} onClose={closeTradeById} onSelect={(sym) => { setSelSym(sym); goTab('trade'); }} />}
        {tab === 'trade' && <MobileNewTrade quotes={quotes} defaultSymbol={selSym} lang={lang} balance={balance} signalFor={signalFor} onOpen={openTrade} />}
        {/* Desktop parity: a paid-plan client in paid mode gets Auto + Manual too. */}
        {tab === 'analysis' && canUseAnalysis && <MobileAnalysis lang={lang} />}
        {tab === 'manual' && canUseAnalysis && <MobileManualSheet lang={lang} onClose={goHome} onDone={runManual} />}
        {tab === 'transactions' && <TransactionsPage lang={lang} onBack={goHome} autoEmail={email} isDeveloper={isDev} />}
        {tab === 'store' && !storePlan && (
          <StorePage
            lang={lang}
            onBack={goBack}
            isDark={isDark}
            userName={user?.displayName || ''}
            userEmail={user?.email || email || ''}
            onBuyBot={(bot) => startStorePayment({ amount: bot.price / 100, label: '', durationDays: 0 }, bot)}
            onBuyPlan={(plan) => startStorePayment(
              {
                amount: plan.priceUsd,
                label: (lang === 'ar' ? plan.labelAr : plan.labelEn) || plan.key,
                durationDays: plan.durationDays,
                planUnit: plan.planUnit,
                planUnits: plan.planUnits,
              },
              null,
            )}
            customerPlan={mobileSub}
            planKeyEntered={isDev || planActive}
            paidMode={planPaid}
            onCustomerEnterKey={() => activatePaidPlan()}
            onCustomerUseFree={() => returnToFreePlan()}
            onCustomerUsePaid={() => activatePaidPlan()}
            onCustomerDeletePlan={() => { void deleteClientPlan(); }}
            onRequireAuth={() => setShowLoginModal(true)}
          />
        )}
        {tab === 'store' && storePlan && (
          <PaymentModal
            key={user?.uid || 'no-session'}
            isOpen={true}
            onClose={() => { setStorePlan(null); setStoreBot(null); goTab('store'); }}
            planLabel={storePlan.label}
            amount={storePlan.amount}
            asPage
            lang={lang}
            botPurchase={storeBot}
            sectionTab={storeBot ? 'bot' : 'plan'}
            buyerEmail={isGoogleOrMicrosoftEmail(user?.email || email) ? (user?.email || email || '') : ''}
            buyerName={user?.displayName || ''}
            planDurationDays={storePlan.durationDays}
            planUnit={storePlan.planUnit}
            planUnits={storePlan.planUnits}
            onBotPaid={() => { setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onGoToStore={() => { setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onGoToPlans={() => { setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onConfirm={completeStorePayment}
          />
        )}
        {tab === 'settings' && <MobileSettings autoTradeEnabled={auto} soundEnabled={sound} language={lang} onAutoTradeToggle={setAutoBoth} onSoundToggle={setSound} onLanguageChange={setLang} onClearCache={() => { setAlert('Cache cleared'); setTimeout(() => setAlert(null), 3000); }} version="3.1.0" savedAccounts={savedAccounts} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} />}
        {tab === 'profile' && <MobileProfile language={lang} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} isLoggedIn={!!(user?.email || email)} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} onProfileImageChange={onProfileImageChange} onLogoChange={onLogoChange} isFollowing={following} onFollowToggle={toggleFollowing} />}
        {tab === 'clients' && isDev && <MobileClientMonitor lang={lang} onClose={goHome} />}
        {children}
      </div>
      <MobileBottomNav activeTab={tab} onTabChange={goTab} isDeveloper={isDev} hasPlan={canUseAnalysis} lang={lang} />
      {dialog && <MobileTradeDialog symbol={dialog.symbol} bid={dialog.bid} ask={dialog.ask} onOpen={(t, v) => openTrade(dialog.symbol, t, v)} onClose={() => setDialog(null)} />}
      {detail && <MobileSignalDetail res={detail} lang={lang} onClose={() => setDetail(null)} />}
      {showLoginModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, color: '#fff' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>{lang === 'ar' ? 'تسجيل الدخول' : 'Login'}</h3>
            {loginError && (
              <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', fontSize: 12, lineHeight: 1.5 }}>
                {loginError}
              </div>
            )}
            {savedAccounts.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{lang === 'ar' ? 'الحسابات المحفوظة:' : 'Saved accounts:'}</div>
                {savedAccounts.map((em) => (
                  <button key={em} onClick={() => { doLogin(em); setShowLoginModal(false); }} style={{ display: 'block', width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, marginBottom: 8, cursor: 'pointer', textAlign: 'left' }}>
                    {em}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setLoginError(null); doLogin(); setShowLoginModal(false); }} disabled={loadingAuth} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px', background: '#4285F4', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', justifyContent: 'center', opacity: loadingAuth ? 0.6 : 1 }}>
              <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" width="18" height="18" alt="Google" />
              {loadingAuth ? (lang === 'ar' ? 'جارٍ تسجيل الدخول…' : 'Signing in…') : (lang === 'ar' ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google')}
            </button>
            <button onClick={() => setShowLoginModal(false)} style={{ marginTop: 12, width: '100%', padding: '8px', background: 'transparent', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer' }}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
      {alert && <div className="mt5-signal-alert">{alert}</div>}
    </div>
  );
}
