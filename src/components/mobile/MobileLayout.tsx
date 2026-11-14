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
import AnalysisDetailPage from '../AnalysisDetailPage';
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
import { readMobileAuto, isMobileRadarOn, startMobileRadar, stopMobileRadar, getMobileRadarProgress, mobileSignalsStorageKey } from '../../services/mobileAnalysisEngine';
import { flagManualRadarStart, takeRadarStartNow, isFreshRadarSession, isRadarArmed } from '../../services/radarSession';
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
  detectMobileTradeCategory,
  startMobilePositionManager,
  openMobileManualTrade,
} from '../../services/mobileTradeBridge';
import { auth, db } from '../../lib/firebase';
import { signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import StorePage from '../StorePage';
import PaymentModal from '../PaymentModal';
import type { StoreBot } from '../../services/storeService';
import { fetchStoreBots } from '../../services/storeService';
import type { PaymentSession } from '../../services/paymentSession';
import { getLivePrices, calcPnl, isMarketOpen } from '../../services/paperTradingService';
import { rememberBuyerEmail, setCurrentUserEmail } from '../../lib/clientScope';
import { stackedPlanExpiry } from '../../lib/planPeriod';

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
  // Seed from the engine so a radar that was already running (resumed after a
  // tab switch / remount) still shows its progress bar immediately.
  const [radarProgress, setRadarProgress] = useState<{ current: string; total: number; index: number; category?: string } | null>(() => {
    const p = getMobileRadarProgress();
    return p ? { current: p.current, total: p.total, index: p.index, category: p.category } : null;
  });
  const toggleAutoAnalysis = useCallback(() => {
    try {
      const s = readMobileAuto();
      const v = !s.isEnabled;
      localStorage.setItem('auto_settings', JSON.stringify({ ...s, isEnabled: v }));
      setAutoAnalysisOn(v);
      if (v) {
        // This is the manual ON that arms the session: only from here may the
        // interval loop run after the client leaves the screen.
        flagManualRadarStart();
        setRadarProgress(null);
        // Read the signed-in identity from storage instead of the component's
        // state: this callback has an empty dependency list, and the old code
        // shadowed the `email` state with itself ("Cannot access 'email' before
        // initialization"), which crashed the toggle on first use.
        const info = detectMobileMode();
        startMobileRadar(info.uid, info.email, (p) => setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category }), (r) => {
          setRadarProgress(null);
        }, { immediate: true });
      } else {
        stopMobileRadar();
        setRadarProgress(null);
      }
      window.dispatchEvent(new CustomEvent('mobile-radar-settings'));
    } catch {}
  }, []);
  useEffect(() => {
    const sync = () => {
      try {
        setAutoAnalysisOn(isMobileRadarOn() && readMobileAuto().isEnabled);
        // Keep the bar in step with the engine (it may have been started by the
        // auto-restart effect, not by this screen's toggle).
        if (isMobileRadarOn()) {
          const p = getMobileRadarProgress();
          if (p) setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category });
        } else {
          setRadarProgress(null);
        }
      } catch {}
    };
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
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [mobileSub, setMobileSub] = useState<{ label: string; amount: number; expiryDate: string } | null>(() => {
    // Strict owner read: the stored record must belong to the account signed in
    // on THIS device. A guest or another account never sees it.
    const sub = readMobileSubscription();
    return sub ? { label: sub.label, amount: sub.amount, expiryDate: sub.expiryDate } : null;
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
  // Keep the developer's clients badge in sync with the cached client list even
  // before the Client Monitor page is opened (the monitor also reports its own
  // merged Firestore+local count via onCountChange).
  useEffect(() => {
    if (!isDev) { setClientCount(0); return; }
    const read = () => {
      try {
        const arr = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
        setClientCount(Array.isArray(arr) ? arr.length : 0);
      } catch { setClientCount(0); }
    };
    read();
    window.addEventListener('storage', read);
    // Live count from Firestore as well, so the badge is right on a fresh phone
    // where the local client cache has never been filled.
    let alive = true;
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'clients'));
        if (alive && snap.size > 0) setClientCount(snap.size);
      } catch { /* keep the cached count */ }
    })();
    return () => { alive = false; window.removeEventListener('storage', read); };
  }, [isDev]);
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
    // Strict ownership: only the account named in the record may use it. A
    // legacy record with NO email belongs to nobody and is never adopted.
    const sub = readMobileSubscription(signedInEmail);
    if (!sub) { setMobileSub(null); return; }
    if (sub.expiryDate && new Date(sub.expiryDate).getTime() <= Date.now()) {
      localStorage.removeItem('active_subscription');
      setMobileSub(null);
      return;
    }
    setMobileSub({ label: sub.label, amount: sub.amount, expiryDate: sub.expiryDate });
  }, [signedInEmail]);

  // Plan reached its expiry while the app is open → back to free, like the site.
  useEffect(() => {
    if (!signedInEmail) return;
    const iv = setInterval(() => {
      const sub = readMobileSubscription(signedInEmail);
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
        // Only merge with a record this account owns; never let another
        // account's leftover plan lengthen (or rename) this one.
        const prevOwner = String(prev?.email || '').toLowerCase().trim();
        if (prevOwner !== signedInEmail) prev = null;
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
  // PAID-ONLY SIGNALS: the developer's displayed analysis (shared_results) and
  // any stored signals are visible/tradeable only while the client is INSIDE a
  // paid plan. A free-plan client (or a paid client who pressed "رجوع للمجانية")
  // sees zero signals. The developer always sees them.
  const canViewSignals = isDev || isPlanClient;
  // Losing the plan (expired / returned to free / signed out) must not leave the
  // client stranded on a paid screen that no longer renders.
  useEffect(() => {
    if (!canUseAnalysis && (tab === 'analysis' || tab === 'manual')) {
      histRef.current = [];
      setTab('home');
    }
  }, [canUseAnalysis, tab]);

  // Establish the page-session marker once, so "refresh" and "reopened after
  // close" are told apart the same way as on desktop.
  useEffect(() => { isFreshRadarSession(); }, []);

  // Auto-restart radar if enabled but not running (ensures analysis continues across tab navigation)
  useEffect(() => {
    const ensureRadar = () => {
      try {
        // Only a developer or a paid-plan client may run the analysis engine
        // (same entitlement that shows the Auto/Manual tabs).
        if (!isDev && !isPlanClient) return;
        const s = readMobileAuto();
        if (!s.isEnabled) return;
        // Clients: opening/refreshing the app must never resume auto-analysis
        // from storage. They turn it ON manually (that arms this session), then
        // the interval loop keeps re-analysing on its own. The developer account
        // keeps resuming (unlimited), detected synchronously from storage so the
        // first render cannot mistake a developer for a client.
        const devNow = isDev || detectMobileMode().mode === 'developer';
        if (!devNow && !isRadarArmed()) {
          const off = { ...s, isEnabled: false };
          try { localStorage.setItem('auto_settings', JSON.stringify(off)); } catch {}
          setAutoAnalysisOn(false);
          try { window.dispatchEvent(new CustomEvent('mobile-radar-settings')); } catch {}
          return;
        }
        if (isMobileRadarOn()) {
          const p = getMobileRadarProgress();
          if (p) setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category });
          return;
        }
        const uid = (user?.uid || 'anonymous');
        const emailVal = (user?.email || email || '');
        const immediate = takeRadarStartNow();
        startMobileRadar(uid, emailVal, (p) => setRadarProgress({ current: p.current, total: p.total, index: p.index, category: p.category }), (r) => {
          setRadarProgress(null);
        }, { immediate });
      } catch {}
    };
    ensureRadar();
    const iv = setInterval(ensureRadar, 10000);
    return () => clearInterval(iv);
  }, [user, email, isDev, isPlanClient]);

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
      // Legacy device-global plan flag: never let it survive a logout.
      localStorage.removeItem('client_plan_active');
      // Per-account assets (finalyze_custom_avatar_<email>) are intentionally
      // NOT deleted: signing out must not erase the owner's picture. They are
      // scoped by email, so another account can never read them.
    } catch {}
    setUser(null);
    setEmail('');
    setIsDev(false);
    // Guest mode from this instant: no plan is visible anywhere.
    setMobileSub(null);
    setPlanPaid(false);
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
    if (!isDev && !isPlanClient) return;
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
      // Auto radar signals (same as desktop AnalysisResults). Both the developer
      // AND a paid-plan client run their own radar, so both must see the results
      // it persisted — before this, a client's radar ran but its signals never
      // reached the home feed (and therefore neither did the analysis reasons).
      if (canViewSignals) {
        try {
          const raw = localStorage.getItem(mobileSignalsStorageKey());
          const auto = raw ? JSON.parse(raw) : [];
          if (Array.isArray(auto)) {
            merged.push(...auto.filter((s: any) => s && s.signal !== 'neutral' && s.signal !== 'no_entry' && !s.isSideways).map((s: any) => ({ ...s, source: s.source || 'auto' })));
          }
        } catch {}
        // Manual analysis results (same as desktop — always in sync). Paid-only:
        // a free-mode client must not inherit a previous paid session's signals.
        try {
          const mraw = localStorage.getItem('manual_results');
          const man = mraw ? JSON.parse(mraw) : [];
          if (Array.isArray(man)) {
            merged.push(...man.filter((s: any) => s && s.signal && s.signal !== 'neutral').map((s: any) => ({ ...s, source: 'manual' })));
          }
        } catch {}
      }
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
      const nextFull = canViewSignals ? full.slice(0, 40) : [];
      setFullSignals((prev) => {
        // Free mode: always empty — signals must disappear the moment the client
        // leaves the paid plan (never keep the previous paid feed).
        if (!canViewSignals) return prev.length ? [] : prev;
        if (nextFull.length === 0 && prev.length > 0) return prev;
        try { if (JSON.stringify(prev) === JSON.stringify(nextFull)) return prev; } catch {}
        return nextFull as AnalysisResult[];
      });
      setSignals(canViewSignals ? full.map((s: any) => ({
        symbol: String(s.symbol || ''),
        type: (String(s.signal || '').includes('sell') ? 'sell' : 'buy') as 'buy' | 'sell',
        price: Number(s.entryPrice ?? s.price ?? 0),
        change: Number(s.change ?? 0),
        changePercent: Number(s.changePercent ?? 0),
      })).filter((s) => s.symbol) : []);
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
  }, [isDev, isPlanClient]);

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



  // PAID-ONLY: the developer's published analysis (shared_results) is the ONLY
  // source of "main-site" signals on mobile. It must reach paid-plan clients in
  // paid mode ONLY — never a free-plan client, never a paid client who pressed
  // "رجوع للمجانية", and never the developer (who already owns the source data).
  // canViewSignalsRef lets the poll keep its own identity without re-subscribing.
  const canViewSignalsRef = useRef(canViewSignals);
  useEffect(() => { canViewSignalsRef.current = canViewSignals; }, [canViewSignals]);

  useEffect(() => {
    const userEmail = (user?.email || email || '').toLowerCase().trim();
    const isDev = isDeveloperEmail(userEmail);
    // Developer has nothing to mirror; free clients are not entitled at all.
    if (isDev || !isPlanClient) return;

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
            // The client may have dropped to free mode mid-poll: never resurrect
            // a feed that is no longer entitled.
            if (!canViewSignalsRef.current) return prev.length ? [] : prev;
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
  }, [user, email, isPlanClient, canViewSignals]);

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

  // Desktop parity (TradeNowPage): one closed-market message for opening and
  // one for closing. Crypto is 24/7 and never blocked by isMarketOpen.
  const marketClosedAlert = (mode: 'open' | 'close') => {
    const msg = lang === 'ar'
      ? (mode === 'open'
        ? 'السوق مغلق لهذا الأصل، لا يمكن فتح صفقة. التداول متاح حالياً للكريبتو فقط (24/7).'
        : 'السوق مغلق لهذا الأصل، لا يمكن إغلاق الصفقة حالياً. الكريبتو يعمل 24/7.')
      : (mode === 'open'
        ? 'Market is closed for this asset — cannot open a trade. Trading is currently available for crypto only (24/7).'
        : 'Market is closed for this asset — cannot close the trade now. Crypto trades 24/7.');
    setAlert(msg);
    setTimeout(() => setAlert(null), 4000);
  };

  const openTrade = (sym: string, type: 'buy' | 'sell', vol: number) => {
    if (!isDev && !isPlanClient) return;
    const cat = String(detectMobileTradeCategory(sym));
    if (!isMarketOpen(cat, sym)) {
      marketClosedAlert('open');
      return;
    }
    ping(type === 'buy' ? 880 : 440);
    setAlert((lang === 'ar' ? 'تم إرسال الأمر: ' : 'Order sent: ') + type.toUpperCase() + ' ' + vol.toFixed(2) + ' ' + sym);
    setTimeout(() => setAlert(null), 4000);
    // Refresh account + open trades from the SAME store (auto/manual included).
    loadAll();
    if (tab === 'trade') goTab('positions');
  };

  // Quick-order dialog (quote list → Buy/Sell) must actually open the trade,
  // not just show an alert. Same bridge as the full mobile ticket, so the
  // developer fixed trading values are enforced here too.
  const executeDialogTrade = async (sym: string, type: 'buy' | 'sell', vol: number) => {
    if (!isDev && !isPlanClient) return;
    const cat = String(detectMobileTradeCategory(sym));
    if (!isMarketOpen(cat, sym)) {
      marketClosedAlert('open');
      return;
    }
    try {
      await openMobileManualTrade(sym, type, vol, signalFor(sym) || null);
      openTrade(sym, type, vol);
    } catch (e: any) {
      if (String(e?.message || '').startsWith('MARKET_CLOSED:')) {
        marketClosedAlert('open');
        return;
      }
      setAlert((lang === 'ar' ? 'فشل فتح الصفقة: ' : 'Failed to open trade: ') + (e?.message || String(e)));
      setTimeout(() => setAlert(null), 4000);
    }
  };

  const closeTradeById = useCallback(async (id: string) => {
    if (!isDev && !isPlanClient) return;
    try {
      await closeMobileTrade(id);
    } catch (e: any) {
      // The bridge enforces desktop market hours on closing too.
      if (String(e?.message || '').startsWith('MARKET_CLOSED:')) {
        marketClosedAlert('close');
        return;
      }
    }
    try { window.dispatchEvent(new CustomEvent('mobile-close-trade', { detail: { id } })); } catch {}
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAll, lang]);

  // A plan/product was chosen in the store: open the same PaymentModal the
  // desktop site opens for the very same choice.
  const startStorePayment = (
    plan: { amount: number; label: string; durationDays: number; planUnit?: string; planUnits?: number } | null,
    bot: StoreBot | null,
  ) => {
    setResumeSessionId(null);
    setStorePlan(plan);
    setStoreBot(bot);
  };

  // Transactions → Resume: reopen the very same payment in the store with its
  // saved method/address/timer — identical to the desktop behaviour.
  const resumeStorePayment = async (session: PaymentSession) => {
    let bot: StoreBot | null = null;
    if (session.kind === 'bot' && session.botId) {
      try {
        const bots = await fetchStoreBots();
        bot = bots.find((b) => b.id === session.botId) || null;
      } catch {}
    }
    setStoreBot(bot);
    setStorePlan({
      amount: session.amountUsd,
      label: session.planLabel || '',
      durationDays: session.durationDays || 0,
      planUnit: session.planUnit,
      planUnits: session.planUnits,
    });
    setResumeSessionId(session.id);
    goTab('store');
  };

  // Same post-payment work as the desktop handler (App.tsx): the buyer is
  // registered as a client under the payment email and the plan is stored
  // locally with its real expiry, so My Plan / the plan gate agree everywhere.
  const completeStorePayment = async (grantInfo?: { expiryDate?: string; requestNo?: number }) => {
    const plan = storePlan;
    const buyerEmail = (user?.email || email || '').toLowerCase().trim();
    const serverExpiry = grantInfo?.expiryDate ? new Date(grantInfo.expiryDate) : null;
    const expiry = serverExpiry ?? stackedPlanExpiry(mobileSub?.expiryDate, {
      label: plan?.label || '',
      durationDays: plan?.durationDays,
      planUnit: plan?.planUnit,
      planUnits: plan?.planUnits,
    });
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
    // A plan may only be activated for a SIGNED-IN buyer whose email owns it.
    // Without an identity nothing is stored, so a guest can never end up with
    // somebody else's plan on this device.
    if (!buyerEmail) {
      setAlert(lang === 'ar' ? 'سجّل الدخول أولاً لتفعيل الخطة' : 'Sign in first to activate the plan');
      setTimeout(() => setAlert(null), 5000);
      return;
    }
    try { localStorage.setItem('active_subscription', JSON.stringify({ ...sub, email: buyerEmail })); } catch {}
    setMobileSub({ label: sub.label, amount: sub.amount, expiryDate: sub.expiryDate });
    // A new payment reopens paid mode immediately (desktop parity).
    setPlanPaid(true);
    setFreeChosen(false);
    setMobilePaidMode(buyerEmail, true);
    setMobileFreeModeChosen(buyerEmail, false);
    setStorePlan(null);
    setStoreBot(null);
    setResumeSessionId(null);
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
    // Signals are a paid entitlement: wipe them from the screen at once and stop
    // the client's own radar, so nothing from the developer's feed stays visible.
    setFullSignals([]);
    setSignals([]);
    setDetail(null);
    setFreshCount(0);
    try { syncMobileAutoEngine([]); } catch {}
    try {
      stopMobileRadar();
      setAutoAnalysisOn(false);
      setRadarProgress(null);
      const s = readMobileAuto();
      try { localStorage.setItem('auto_settings', JSON.stringify({ ...s, isEnabled: false })); } catch {}
      try { window.dispatchEvent(new CustomEvent('mobile-radar-settings')); } catch {}
    } catch {}
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
        if (String(o?.email || '').toLowerCase().trim() === signedInEmail && o?.requestNo != null) {
          requestNo = Number(o.requestNo);
        }
      } catch {}
      activateClientPlan(signedInEmail, requestNo).catch(() => {});
    }
    setAlert(lang === 'ar' ? 'تم تفعيل الخطة المدفوعة ✓' : 'Paid plan activated ✓');
    setTimeout(() => setAlert(null), 4000);
  };

  // Delete/cancel the plan permanently (revokes the server grant too).
  const deleteClientPlan = async () => {
    if (signedInEmail) await revokeClientPlanGrants(signedInEmail).catch(() => {});
    // Only remove the local record when this account owns it — never wipe a
    // plan that belongs to a different account on this device.
    try {
      const o = JSON.parse(localStorage.getItem('active_subscription') || 'null');
      const owner = String(o?.email || '').toLowerCase().trim();
      if (owner && (owner === signedInEmail || isDev)) localStorage.removeItem('active_subscription');
    } catch {}
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
      const raw = localStorage.getItem(mobileSignalsStorageKey());
      const arr = raw ? JSON.parse(raw) : [];
      const next = (Array.isArray(arr) ? arr : []).filter((s: any) => String(s.symbol) !== sym);
      localStorage.setItem(mobileSignalsStorageKey(), JSON.stringify(next));
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
  // PAID-ONLY: alerts are gated by the same entitlement that gates the feed.
  useMobileSignalAlert(useCallback((n: number) => {
    loadAll();
    setFreshCount(n);
    ping(880);
    setAlert((lang === 'ar' ? 'إشارة جديدة: ' : 'New signal: ') + n);
    setTimeout(() => { setAlert(null); setFreshCount(0); }, 8000);
  }, [loadAll, lang]), canViewSignals);

  // Leaving the paid plan (free mode / expiry / sign-out) must remove the
  // displayed developer signals IMMEDIATELY — not on the next 3s load tick and
  // not only after a refresh. Reactivating the plan is handled by the normal
  // loadAll effects, which repopulate the feed from the entitled sources.
  useEffect(() => {
    if (canViewSignals) return;
    setFullSignals((prev) => (prev.length ? [] : prev));
    setSignals((prev) => (prev.length ? [] : prev));
    setDetail(null);
    setFreshCount(0);
    try { syncMobileAutoEngine([]); } catch {}
  }, [canViewSignals]);

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
          app, with the same paid/free switch the desktop site has. SOLID YELLOW
          (brand accent) so it is impossible to miss as the free/paid link. */}
      {tab !== 'store' && mobileSub && (
        <div style={{ margin: '8px 14px 0', padding: '10px 12px', borderRadius: 12, background: '#FACC15', border: '1px solid #EAB308', boxShadow: '0 2px 10px rgba(234,179,8,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {planPaid ? (lang === 'ar' ? 'خطتك المدفوعة' : 'Your paid plan') : (lang === 'ar' ? 'الخطة المدفوعة متوقفة' : 'Paid plan paused')}
              {': '}{mobileSub.label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#78350F' }}>
              {(() => {
                const ms = new Date(mobileSub.expiryDate).getTime();
                if (!isFinite(ms)) return lang === 'ar' ? 'بانتظار المفتاح' : 'Waiting for key';
                const d = Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
                return lang === 'ar' ? `${d} يوم متبقٍ` : `${d} days left`;
              })()}
              {!planPaid && (
                <span style={{ display: 'block', color: '#78350F' }}>
                  {lang === 'ar' ? 'الإشارات مخفية في الوضع المجاني' : 'Signals hidden in free mode'}
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => { if (planPaid) returnToFreePlan(); else activatePaidPlan(); }}
            style={{ flexShrink: 0, padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, color: '#fff', background: planPaid ? '#111827' : '#065E46' }}
          >
            {planPaid ? (lang === 'ar' ? 'رجوع للمجانية' : 'Back to Free') : (lang === 'ar' ? 'تفعيل المدفوعة' : 'Activate Paid')}
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', overflowAnchor: 'none' }}>
        {tab === 'home' && <MobileHome fullSignals={fullSignals} lang={lang} onDetail={setDetail} onTrade={(s) => { setSelSym(s); goTab('trade'); }} onRemove={removeSignal} onRemoveAll={() => setFullSignals([])} autoTradeEnabled={auto} onAutoTradeToggle={setAutoBoth} radarOn={freshCount > 0} radarLabel={freshCount > 0 ? (lang === 'ar' ? `${freshCount} إشارة جديدة` : `${freshCount} new signals`) : null} radarProgress={radarProgress} signalsAllowed={canViewSignals} />}
        {tab === 'quotes' && isDev && <MobileQuotes quotes={quotes} onSelect={pickSymbol} />}
        {tab === 'positions' && <MobilePositions positions={positions} closed={closedTrades} onClose={closeTradeById} onSelect={(sym) => { setSelSym(sym); goTab('trade'); }} canTrade={isDev || isPlanClient} />}
        {tab === 'trade' && <MobileNewTrade quotes={quotes} defaultSymbol={selSym} lang={lang} balance={balance} signalFor={signalFor} onOpen={openTrade} canTrade={isDev || isPlanClient} />}
        {/* Desktop parity: a paid-plan client in paid mode gets Auto + Manual too. */}
        {tab === 'analysis' && canUseAnalysis && <MobileAnalysis lang={lang} />}
        {tab === 'manual' && canUseAnalysis && <MobileManualSheet lang={lang} onClose={goHome} onDone={runManual} />}
        {tab === 'transactions' && <TransactionsPage lang={lang} onBack={goHome} autoEmail={email} isDeveloper={isDev} onGoToStore={() => goTab('store')} onResumeSession={resumeStorePayment} />}
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
            key={(user?.uid || 'no-session') + (resumeSessionId ? `_${resumeSessionId}` : '')}
            isOpen={true}
            onClose={() => { setResumeSessionId(null); setStorePlan(null); setStoreBot(null); goTab('store'); }}
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
            currentPlanExpiry={mobileSub?.expiryDate ?? null}
            currentPlanLabel={mobileSub?.label ?? null}
            resumeSessionId={resumeSessionId}
            onBotPaid={() => { setResumeSessionId(null); setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onGoToStore={() => { setResumeSessionId(null); setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onGoToPlans={() => { setResumeSessionId(null); setStorePlan(null); setStoreBot(null); goTab('store'); }}
            onConfirm={completeStorePayment}
          />
        )}
        {tab === 'settings' && <MobileSettings autoTradeEnabled={auto} soundEnabled={sound} language={lang} onAutoTradeToggle={setAutoBoth} onSoundToggle={setSound} onLanguageChange={setLang} onClearCache={() => { setAlert('Cache cleared'); setTimeout(() => setAlert(null), 3000); }} version="3.1.0" savedAccounts={savedAccounts} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} />}
        {tab === 'profile' && <MobileProfile language={lang} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} isLoggedIn={!!(user?.email || email)} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} onProfileImageChange={onProfileImageChange} onLogoChange={onLogoChange} isFollowing={following} onFollowToggle={toggleFollowing} />}
        {tab === 'clients' && isDev && <MobileClientMonitor lang={lang} onClose={goHome} onCountChange={setClientCount} />}
        {children}
      </div>
      <MobileBottomNav
        activeTab={tab}
        onTabChange={(t) => {
          // The reasons screen is a full-page overlay on a phone. Choosing any
          // other tab must close it, otherwise the overlay stays on top and the
          // client cannot move between sections.
          setDetail(null);
          goTab(t);
        }}
        isDeveloper={isDev}
        hasPlan={canUseAnalysis}
        lang={lang}
      />
      {dialog && <MobileTradeDialog symbol={dialog.symbol} bid={dialog.bid} ask={dialog.ask} onOpen={(t, v) => { void executeDialogTrade(dialog.symbol, t, v); }} onClose={() => setDialog(null)} />}
      {detail && (isDev
        ? <MobileSignalDetail res={detail} lang={lang} onClose={() => setDetail(null)} />
        : <AnalysisDetailPage result={detail} onBack={() => setDetail(null)} lang={lang} isClient compact />)}
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
