import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, OAuthProvider, signOut, signInAnonymously } from 'firebase/auth';
import { auth, db } from './lib/firebase';
import { doc, getDoc, collection, addDoc, getDocs, updateDoc, deleteDoc, serverTimestamp, where, setDoc, query, orderBy, onSnapshot } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { playSuccess, playFail, playCompletion, playStart, playDrop, playCategoryChange, playMessengerPing, initAudio, getAudioContext } from './lib/audioEngine';
import { installUiClickSound } from './lib/uiClickSound';
import { trackPageView, trackClick } from './lib/tracking';
import { TrendingUp, Activity, ArrowLeft, Users, Shield } from 'lucide-react';
import Header from './components/Header';
import AnalysisForm from './components/AnalysisForm';
import AnalysisResultView from './components/AnalysisResultView';
import ConnectionStatus from './components/ConnectionStatus';
import LoginOverlay from './components/LoginOverlay';
import DevicePreview from './components/DevicePreview';
import SettingsModal from './components/SettingsModal';
import SidebarPanel from './components/SidebarPanel';
import TopSignals from './components/TopSignals';
import PortfolioPanel from './components/PortfolioPanel';
import ClientDashboard from './components/ClientDashboard';
import AnalysisDetailPage from './components/AnalysisDetailPage';

import { AnalysisResult, StrategySettings, AutoAnalysisSettings, MarketType, TradingStyle } from './types';
import { DEFAULT_STRATEGY_SETTINGS, DEFAULT_AUTO_SETTINGS, SYMBOL_CATEGORIES, ALL_SYMBOLS_DB, SYMBOL_GROUPS, FREE_SYMBOLS, STOCKS_BY_EXCHANGE } from './constants';
import { getOpenStockExchanges, exchangeLabel, StockExchangeKey, OpenExchange } from './lib/marketHours';
import { Language, translations } from './lib/i18n';
import { analyzeMarket } from './services/geminiService';
import { waitIfRateLimited } from './services/rateLimitTracker';
import { resolveConflicts } from './services/portfolioRiskService';
import ApiKeyModal from './components/ApiKeyModal';
import SubscriptionModal from './components/SubscriptionModal';
import PaymentModal from './components/PaymentModal';
import { getUnreadDevNotificationCount, getUnreadSiteRequestCount, fetchUserGrants, fetchUserGrantsForEmails, activateClientPlan, revokeClientPlanGrants, toMillis as grantTimeMillis } from './services/paymentRequests';
import ProfilePage from './components/ProfilePage';
import TransactionsPage from './components/TransactionsPage';
import AboutPage from './components/AboutPage';
import SuggestionsPage from './components/SuggestionsPage';
import TradeNowPage from './components/TradeNowPage';
import { AutoTradeEngine } from './services/autoTradeEngine';
import StorePage from './components/StorePage';
import SeoPricesPage from './pages/SeoPricesPage';
import StoreSettingsPage from './components/StoreSettingsPage';
import KeyPoolPanel from './components/KeyPoolPanel';
import { StoreBot, fetchStoreBots } from './services/storeService';
import { PaymentSession, getLastEmail } from './services/paymentSession';
import { ensureClientIdentity, silentClientLogin } from './services/clientIdentity';

/**
 * True when THIS client has a key of their own saved under their email(s).
 * Deliberately ignores the shared developer slots (finalyze_key1_value,
 * finalyze_user_groq_api_key) — a client must never inherit someone else's key.
 */
function hasAnyStoredKey(): boolean {
  try {
    return !!readClientOwnKeyForEmails(clientEmailsFor(currentUserEmail()));
  } catch { return false; }
}
import ClientMonitor from './components/ClientMonitor';
import SiteStatsPage from './components/SiteStatsPage';
import AdsManager from './components/AdsManager';
import { AdSlot } from './components/AdsManager';
import RadarSettingsPage from './components/RadarSettingsPage';
import MyPlanModal from './components/MyPlanModal';
import { StorePlan, fetchPlans, planLabel, planFeatures } from './services/storePlans';
import { clientDocId, isDeveloperEmail, DEVELOPER_EMAILS } from './lib/clientIds';
import { clientScopeKey, writeClientOwnKey, readClientOwnKey, clearClientOwnKey, rememberBuyerEmail, clientEmailsFor, readClientOwnKeyForEmails, applyRuntimeAnalysisKey, replaceClientOwnKey, forgetClientOwnKey, purgeOwnKeyForEmail, detectKeyProvider, setCurrentUserEmail, currentUserEmail } from './lib/clientScope';
import { isGoogleOrMicrosoftEmail, AuthProviderId } from './lib/authPolicy';


export type PageType = 'main' | 'settings' | 'apiKey' | 'plans' | 'radar' | 'paymentSettings' | 'clientMonitor' | 'profile' | 'about' | 'suggestions' | 'ads' | 'siteStats' | 'trade' | 'manualAnalysis' | 'manualResults' | 'store' | 'storeSettings' | 'transactions' | 'prices' | 'myPlan';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [redirectingProvider, setRedirectingProvider] = useState<AuthProviderId | null>(null);
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null);
  const [paymentPlan, setPaymentPlan] = useState<{ amount: number; label: string; durationDays: number; planUnit?: string; planUnits?: number } | null>(null);
  const [botPurchase, setBotPurchase] = useState<StoreBot | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(() => {
    return hasAnyStoredKey();
  });
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[] | null>(null);
  const [detailResult, setDetailResult] = useState<AnalysisResult | null>(null);
  const [clientDetailResult, setClientDetailResult] = useState<AnalysisResult | null>(null);
  const [clientSignals, setClientSignals] = useState<AnalysisResult[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('finalyze_client_signals') || '[]');
      return saved.filter((s: any) => !s.isSideways);
    } catch { return []; }
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>(() => {
    const stored = localStorage.getItem('language');
    return (stored === 'ar' || stored === 'en') ? (stored as Language) : 'en';
  });
  useEffect(() => {
    localStorage.setItem('language', lang);
  }, [lang]);
  // Cleanup old API key artifacts on mount
  useEffect(() => {
    try {
      const k1 = localStorage.getItem('finalyze_key1_value');
      const old = localStorage.getItem('finalyze_user_groq_api_key');
      if (old && old === k1) localStorage.removeItem('finalyze_user_groq_api_key');
      if (old && !old.startsWith('gsk_') && !old.startsWith('AIzaSy') && !old.startsWith('AQ.')) localStorage.removeItem('finalyze_user_groq_api_key');
      localStorage.removeItem('finalyze_key1_provider');
      localStorage.removeItem('finalyze_key2_value');
    } catch {}
  }, []);
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem('theme') !== 'light');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPWA, setIsPWA] = useState(false);
  const [newSuggestionsCount, setNewSuggestionsCount] = useState(0);
  const [paymentRequestsCount, setPaymentRequestsCount] = useState(0);
  const [siteRequestsCount, setSiteRequestsCount] = useState(0);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsPWA(standalone);
  }, []);
  const [freemiumDisabled, setFreemiumDisabled] = useState(() => localStorage.getItem('finalyze_freemium_disabled') === 'true');
  const [clientLoginRequired, setClientLoginRequired] = useState(() => localStorage.getItem('finalyze_client_login_required') === 'true');
  const [needsApiKey, setNeedsApiKeyState] = useState<string | null>(() => {
    try { return localStorage.getItem('finalyze_needs_api_key'); } catch { return null; }
  });
  const [pendingVerifyLink, setPendingVerifyLink] = useState<string | null>(localStorage.getItem('finalyze_verify_link') || null);
  const persistNeedsApiKey = (email: string | null) => {
    if (email) {
      // Safety net: never block registered clients (those already in finalyze_clients)
      const allClients: any[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
      if (email && allClients.some((c: any) => c.email === email)) {
        localStorage.removeItem('finalyze_needs_api_key');
        localStorage.removeItem('finalyze_needs_api_key_timestamp');
        setNeedsApiKeyState(null);
        return;
      }
      localStorage.setItem('finalyze_needs_api_key', email);
      localStorage.setItem('finalyze_needs_api_key_timestamp', Date.now().toString());
    } else {
      localStorage.removeItem('finalyze_needs_api_key');
      localStorage.removeItem('finalyze_needs_api_key_timestamp');
    }
    setNeedsApiKeyState(email);
  };

  const getPageFromHash = (): PageType => {
    const hash = window.location.hash.slice(1);
    if (['settings', 'apiKey', 'plans', 'radar', 'paymentSettings', 'clientMonitor', 'profile', 'about', 'suggestions', 'ads', 'siteStats', 'trade', 'manualAnalysis', 'manualResults', 'store', 'storeSettings', 'transactions', 'prices', 'myPlan'].includes(hash)) return hash as any;
    return 'main';
  };
  const [activePage, setActivePage] = useState<PageType>(getPageFromHash);
  const navStackRef = useRef<string[]>([]);

  const navigateTo = (page: PageType) => {
    if (page !== activePage) {
      navStackRef.current.push(activePage);
      setActivePage(page);
      if (!isDeveloperSession()) trackPageView(page).catch(() => {});
    }
  };

  const goBack = () => {
    if (navStackRef.current.length > 0) {
      const prev = navStackRef.current.pop()!;
      setActivePage(prev as PageType);
    } else {
      setActivePage('main');
    }
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && e.state.page) {
        setActivePage(e.state.page);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const [showForm, setShowForm] = useState(true);
  const [isScanningFinished, setIsScanningFinished] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('auto_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // If radar is enabled, start as "waiting" (yellow), not scanning (green)
        return parsed.isEnabled === true;
      }
    } catch {}
    return false;
  });
  const [foundAnyStrong, setFoundAnyStrong] = useState(false);
  const [newSignalAlert, setNewSignalAlert] = useState<string | null>(null);
  // CLIENT: Radar status from developer
  const [clientRadarRunning, setClientRadarRunning] = useState(false);
  const [showRadarComplete, setShowRadarComplete] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'phone' | 'tablet' | null>(null);
  const prevRadarRunningRef = useRef(false);
  const [activeSubscription, setActiveSubscription] = useState<{ label: string; amount: number; expiryDate: string; requestNo?: number; durationDays?: number; firstReleasedAt?: string; planUnit?: string; planUnits?: number } | null>(() => {
    try {
      const saved = localStorage.getItem('active_subscription');
      if (!saved) return null;
      const sub = JSON.parse(saved);
      if (new Date(sub.expiryDate) < new Date()) {
        localStorage.removeItem('active_subscription');
        return null;
      }
      return sub;
    } catch { return null; }
  });

  // When an active subscribed plan reaches its expiry, close the paid features
  // automatically and return to the free plan
  useEffect(() => {
    if (!activeSubscription?.expiryDate) return;
    const checkExpiry = () => {
      try {
        const saved = localStorage.getItem('active_subscription');
        if (!saved) return;
        const sub = JSON.parse(saved);
        if (sub?.expiryDate && new Date(sub.expiryDate).getTime() <= Date.now()) {
          console.log('[EXPIRY] Plan reached expiry time at', sub.expiryDate, '- removing active subscription');
          localStorage.removeItem('active_subscription');
          setActiveSubscription(null);
          setPaidMode(false);
          setFreeModeChosen(true);
        }
      } catch {}
    };
    checkExpiry();
    const t = setInterval(checkExpiry, 1000);
    return () => clearInterval(t);
  }, [activeSubscription?.expiryDate]);

  const DEV_EMAILS = DEVELOPER_EMAILS;

const isDeveloperSession = () => {
    if (!user) return false;
    const email = (user.email || '').toLowerCase().trim();
    return DEV_EMAILS.includes(email);
  };
  const DEV_ONLY_PAGES: PageType[] = ['clientMonitor', 'ads', 'siteStats', 'manualAnalysis'];
  const isAr = lang === 'ar';
  const cxn = clientScopeKey(user?.email || '', '');
  const cxnSigKey = `${cxn}__signals`;
  const cxnCustomKey = `${cxn}__custom_symbols`;
  const cxnHiddenKey = `${cxn}__hidden_symbols`;
  const cxnAutoKey = `${cxn}__auto_settings`;
  const cxnPaidKey = `${cxn}__paid_mode`;
  // freeModeChosen: the client explicitly chose "Return to Free Plan". It is a
  // PERSISTED opt-out, so the grants poll below stops re-activating paid mode
  // (that is exactly why the button used to do nothing). Cleared when the plan
  // is activated again or a new payment arrives.
  const cxnFreeKey = `${cxn}__free_mode`;
  const [freeModeChosen, setFreeModeChosen] = useState<boolean>(() => {
    try { return localStorage.getItem(cxnFreeKey) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(cxnFreeKey, freeModeChosen ? 'true' : 'false'); } catch {}
  }, [cxnFreeKey, freeModeChosen]);
  const freeModeOverride = () => {
    try { return localStorage.getItem(cxnFreeKey) === 'true'; } catch { return false; }
  };
  // Keep the signed-in identity in sync. When the account actually changes, the
  // previous email's leftover key is deleted so a stale browser key can never be
  // reused on the new account.
  const lastSignedInEmail = useRef<string | null>(null);
  useEffect(() => {
    const cur = (user?.email || '').toLowerCase().trim();
    const prev = lastSignedInEmail.current;
    if (prev && prev !== cur) forgetClientOwnKey(prev);
    lastSignedInEmail.current = cur || null;
    setCurrentUserEmail(cur);
  }, [user?.email]);
  // paidMode: whether the client currently USES the paid plan features. Owned plan
  // stays stored (activeSubscription) even in free mode until its period ends.
  const [paidMode, setPaidMode] = useState<boolean>(() => {
    try { return localStorage.getItem(cxnPaidKey) !== 'false'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(cxnPaidKey, paidMode ? 'true' : 'false'); } catch {}
  }, [cxnPaidKey, paidMode]);
  // ownsPaidPlan: the account OWNS a paid plan, whether or not it is currently in
  // use. Storage scoping keys off this so returning to free never orphans data.
  const ownsPaidPlan = !isDeveloperSession() && !!activeSubscription;
  // isPlanClient: paid features are CURRENTLY in use. It must include paidMode —
  // otherwise "Return to Free Plan" flips a flag nothing reads and the button
  // looks completely dead.
  const isPlanClient = ownsPaidPlan && paidMode;
  // A plan with an expiryDate that has already passed is EXPIRED: no paid
  // features at all, even if the client still has a saved key. A fresh payment
  // (with a new grant confirmed by the developer) is required to reopen them.
  const subscriptionActive = !!activeSubscription && (!activeSubscription.expiryDate || new Date(activeSubscription.expiryDate) > new Date());
  // Analysis runs on the developer's key pool, so a client needs NO key of their
  // own: an approved plan is released the moment you confirm it, and this flag
  // simply means "this account may run analysis right now".
  const planKeyed = isDeveloperSession() || subscriptionActive;
  const planClientActive = subscriptionActive && paidMode;
  // The dashboard plan row (and the My Plan page) exist ONLY while the plan is
  // actually running: not expired, and not in free mode. When free, the plan is
  // still owned and can be re-activated from the store's Plans section.
  const showPlanControls = subscriptionActive && paidMode;
  const openMyPlan = () => { if (showPlanControls) navigateTo('myPlan'); };
  const [showMyPlan, setShowMyPlan] = useState(false);
  const [autoAnalyzeToken, setAutoAnalyzeToken] = useState(0);
  const [myPlans, setMyPlans] = useState<StorePlan[]>([]);
  useEffect(() => { fetchPlans().then(setMyPlans).catch(() => {}); }, []);
  const myPlanFeatures = useMemo(() => {
    if (!activeSubscription) return [] as string[];
    const byLabel = myPlans.find((p) => planLabel(p, isAr) === activeSubscription.label);
    const byPrice = myPlans.find((p) => Number(p.priceUsd) === activeSubscription.amount);
    const p = byLabel || byPrice;
    return p ? planFeatures(p, isAr) : [];
  }, [myPlans, activeSubscription, isAr]);
  const returnToFreePlan = () => {
    // Persist the opt-out first: the grants poll must not switch paid mode back on.
    setFreeModeChosen(true);
    setPaidMode(false);
    setShowMyPlan(false);
    try {
      const saved = JSON.parse(localStorage.getItem('finalyze_client_signals') || '[]');
      setClientSignals(Array.isArray(saved) ? saved.filter((s: any) => !s.isSideways) : []);
    } catch {
      setClientSignals([]);
    }
    navigateTo('main');
  };
  const activatePaidPlan = () => {
    // Guard on OWNERSHIP, not on current mode: while in free mode isPlanClient is
    // false by design, and guarding on it made re-activation a silent no-op.
    if (!ownsPaidPlan) return;
    setFreeModeChosen(false);
    setPaidMode(true);
    setShowMyPlan(false);
    try {
      const saved = JSON.parse(localStorage.getItem(cxnSigKey) || '[]');
      setClientSignals(Array.isArray(saved) ? saved.filter((s: any) => !s.isSideways) : []);
    } catch {
      setClientSignals([]);
    }
    if (user?.email) {
      activateClientPlan(user.email, activeSubscription?.requestNo ?? null).catch(() => {});
    }
    navigateTo('main');
  };
  // Client deletes/cancels their plan (active OR pending-key). Revokes the plan
  // grants server-side (so the grants poll can't reactivate it), clears the
  // local subscription, and returns to free mode.
  const deleteClientPlan = async () => {
    if (user?.email) {
      await revokeClientPlanGrants(user.email).catch(() => {});
    }
    try { localStorage.removeItem('active_subscription'); } catch {}
    setActiveSubscription(null);
    setFreeModeChosen(false);
    setPaidMode(false);
    setShowMyPlan(false);
    navigateTo('main');
  };
  const effectivePage: PageType = (DEV_ONLY_PAGES.includes(activePage) && !isDeveloperSession() && !((activePage === 'manualAnalysis' || activePage === 'manualResults') && isPlanClient)) ? 'main' : activePage;

  const [storeVisited, setStoreVisited] = useState(false);
  useEffect(() => {
    if (effectivePage === 'store') setStoreVisited(true);
  }, [effectivePage]);

  // CLIENT: Mirror results from developer via Firestore ΓÇö poll collection every 10s, NO orderBy
  useEffect(() => {
    if (isDeveloperSession() || isPlanClient) return;
    // Allow if user is logged in OR if login is not required (guest mode)
    if (!user && clientLoginRequired) return;
    console.log('[CLIENT] Setting up Firestore polling for shared_results');

    const isFirstLoad = !localStorage.getItem('finalyze_client_signals');
    let hasPlayedFirstSound = false;

    const loadFromFirestore = async () => {
      try {
        console.log('[CLIENT] Polling shared_results collection...');
        const snap = await getDocs(collection(db, 'shared_results'));
        console.log(`[CLIENT] Found ${snap.size} docs in shared_results`);
        
        if (snap.empty) {
          console.warn('[CLIENT] shared_results collection is empty');
          setClientSignals([]);
          localStorage.removeItem('finalyze_client_signals');
          return;
        }
        
        // Find the latest doc by comparing timestamps (handle string, Date, Timestamp, number)
        let latestData: any = null;
        let latestTs = 0;
        
        snap.forEach(d => {
          const dta = d.data();
          let ts = 0;
          if (dta.timestamp) {
            if (typeof dta.timestamp === 'string') ts = new Date(dta.timestamp).getTime();
            else if (typeof dta.timestamp === 'object' && dta.timestamp.toMillis) ts = dta.timestamp.toMillis();
            else if (dta.timestamp instanceof Date) ts = dta.timestamp.getTime();
            else if (typeof dta.timestamp === 'number') ts = dta.timestamp;
          }
          if (ts >= latestTs) { latestTs = ts; latestData = dta; }
        });
        
        if (!latestData) {
          console.warn('[CLIENT] No docs with valid timestamp found');
          setClientSignals([]);
          localStorage.removeItem('finalyze_client_signals');
          return;
        }
        
        const results = latestData.results;
        if (!results || !Array.isArray(results) || results.length === 0) {
          console.warn('[CLIENT] Latest doc has no results array, clearing');
          setClientSignals([]);
          localStorage.removeItem('finalyze_client_signals');
          return;
        }
        
        const strongCount = results.filter((r: any) => r.signal === 'strong_buy' || r.signal === 'strong_sell').length;
        console.log(`[CLIENT] Setting ${results.length} signals (${strongCount} strong)`);
        
        // Alert for any new signal (any symbol not seen before)
        const currentSignals = JSON.parse(localStorage.getItem('finalyze_client_signals') || '[]');
        const currentSymbols = new Set(currentSignals.map((s: any) => s.symbol));
        const newSignals = results.filter((r: any) => !currentSymbols.has(r.symbol));
        const hasNewSignal = newSignals.length > 0;

        // Play sound on first load if signals exist
        if (isFirstLoad && !hasPlayedFirstSound && results.length > 0) {
          hasPlayedFirstSound = true;
          const symbols = results.map((r: any) => r.symbol).join(' ΓÇó ');
          setNewSignalAlert(lang === 'ar' ? `\u062a\u0646\u0628\u064a\u0647 \u0641\u0631\u0635\u0629 \u062c\u062f\u064a\u062f\u0629 \u2014 ${symbols}` : `New Opportunity Alert \u2014 ${symbols}`);
          setTimeout(() => setNewSignalAlert(null), 10000);
          try { playAudio('success'); } catch {}
        }
        // Play sound when any new opportunity arrives
        else if (hasNewSignal) {
          const newSymbols = newSignals.map((r: any) => r.symbol).join(' ΓÇó ');
          setNewSignalAlert(lang === 'ar' ? `\u062a\u0646\u0628\u064a\u0647 \u0641\u0631\u0635\u0629 \u062c\u062f\u064a\u062f\u0629 \u2014 ${newSymbols}` : `New Opportunity Alert \u2014 ${newSymbols}`);
          setTimeout(() => setNewSignalAlert(null), 10000);
          try { playAudio('success'); } catch {}
        }
        
        setClientSignals(results.filter((r: any) => !r.isSideways));
        localStorage.setItem('finalyze_client_signals', JSON.stringify(results.filter((r: any) => !r.isSideways)));
      } catch (e: any) {
        console.error('[CLIENT] Failed to load shared results:', e?.code || e?.message || e);
      }
    };
    
    // Initial fetch immediately
    loadFromFirestore();
    
    // Poll every 10 seconds
    const interval = setInterval(loadFromFirestore, 10000);
    
    return () => {
      console.log('[CLIENT] Cleaning up Firestore polling');
      clearInterval(interval);
    };
  }, [user, lang, isPlanClient]);

  // CLIENT PLAN: load per-client scoped signals & auto settings when the plan view is active
  // When in free mode, load developer shared signals
  useEffect(() => {
    if (isDeveloperSession()) return;
    if (isPlanClient) {
      try {
        const saved = JSON.parse(localStorage.getItem(cxnSigKey) || '[]');
        setClientSignals(Array.isArray(saved) ? saved.filter((s: any) => !s.isSideways) : []);
      } catch {
        setClientSignals([]);
      }
      try {
        const savedAuto = localStorage.getItem(cxnAutoKey);
        if (savedAuto) {
          const parsed = JSON.parse(savedAuto);
          if (parsed && typeof parsed === 'object') setAutoSettings((prev) => ({ ...prev, ...parsed }));
        }
      } catch {}
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('finalyze_client_signals') || '[]');
        setClientSignals(Array.isArray(saved) ? saved.filter((s: any) => !s.isSideways) : []);
      } catch {
        setClientSignals([]);
      }
    }
  }, [isPlanClient, cxnSigKey, cxnAutoKey]);

  // CLIENT: Sync freemium state from Firestore
  useEffect(() => {
    if (isDeveloperSession()) return;
    if (!user && clientLoginRequired) return;
    const syncFreemium = async () => {
      try {
        const snap = await getDoc(doc(db, 'shared_settings', 'freemium'));
        if (snap.exists()) {
          const data = snap.data();
          const disabled = data.disabled === true;
          setFreemiumDisabled(disabled);
          localStorage.setItem('finalyze_freemium_disabled', disabled ? 'true' : 'false');
          console.log('[CLIENT] Freemium state synced from Firestore:', disabled);
        }
      } catch (e) {
        console.warn('[CLIENT] Failed to sync freemium state:', e);
      }
    };
    syncFreemium();
    const interval = setInterval(syncFreemium, 10000);
    return () => clearInterval(interval);
  }, [user]);

  // CLIENT: Sync clientLoginRequired state from Firestore
  useEffect(() => {
    const syncClientLogin = async () => {
      try {
        const snap = await getDoc(doc(db, 'shared_settings', 'clientLogin'));
        if (snap.exists()) {
          const data = snap.data();
          const required = data.required === true;
          setClientLoginRequired(required);
          localStorage.setItem('finalyze_client_login_required', required ? 'true' : 'false');
          console.log('[SYNC] Client login state synced from Firestore:', required);
        }
      } catch (e) {
        console.warn('[SYNC] Failed to sync client login state:', e);
      }
    };
    syncClientLogin();
    const interval = setInterval(syncClientLogin, 10000);
    return () => clearInterval(interval);
  }, []);

  // CLIENT: Poll radar status from developer — only when in Free Mode!
  useEffect(() => {
    if (isDeveloperSession() || isPlanClient) return;
    if (!user && clientLoginRequired) return;
    let prevRunning = false;

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
        if (!latestData) return;
        const running = latestData.isRunning === true;
        setClientRadarRunning(running);

        // Radar just finished: play sound + show green banner
        if (prevRunning && !running) {
          try { initAudio(); } catch {}
          playAudio('completion');
          setShowRadarComplete(true);
          setTimeout(() => setShowRadarComplete(false), 30000);
        }
        prevRunning = running;
      } catch (e) {
        console.warn('[CLIENT] Failed to check radar status:', e);
      }
    };

    checkRadarStatus();
    const interval = setInterval(checkRadarStatus, 10000);
    return () => clearInterval(interval);
  }, [user]);

  const hasActivePlan = useMemo((): boolean => {
    if (isDeveloperSession()) return true;
    // A paid-plan client has an active plan when they're in paid mode AND own an
    // active (started) subscription. Whether their key is entered OR pending, the
    // analysis UI must not stay locked once a real paid plan is live — so if the
    // plan is started (real future expiryDate) treat it as active whether or not
    // the key was entered yet. If the plan is pending-key (no expiry), only the
    // gate / key flows unlock it.
    if (planClientActive) return true;
    // The client entered THEIR OWN key: the analysis UI is unlocked (they own an
    // active or granted plan attached to an email that holds a key).
    if (planKeyed) return true;
    if (activeSubscription && paidMode && activeSubscription.expiryDate && new Date(activeSubscription.expiryDate) > new Date()) return true;
    if (freemiumDisabled) return true;
    if (localStorage.getItem('finalyze_freemium_disabled') === 'true') return true;
    return false;
  }, [user, activeSubscription, freemiumDisabled, planClientActive, paidMode, planKeyed]);
  
  
  interface ClientRecord {
    id: string;
    email: string;
    uid: string;
    status: 'verified' | 'pending' | 'banned';
    plan: 'free' | 'paid';
    planExpiry: string | null;
    registeredAt: any;
    rank: number;
  }
  const [clients, setClients] = useState<ClientRecord[]>([]);

  const isNewClient = useMemo(() => {
    try {
      const localClients = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
      if (!user || !user.email) return false;
      const email = user.email.toLowerCase();
      const inClients = clients.some((c: any) => c.email?.toLowerCase() === email);
      const inLocal = localClients.some((c: any) => c.email?.toLowerCase() === email);
      return !inClients && !inLocal;
    } catch (e) {
      return false;
    }
  }, [clients, user]);

  const fetchClients = async () => {
    // Merge Firestore clients with localStorage fallback
    const localClients: ClientRecord[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
    try {
      const q = query(collection(db, 'clients'), orderBy('rank', 'asc'));
      const snap = await getDocs(q);
      const fsClients = snap.docs.map(d => ({ id: d.id, ...d.data() } as ClientRecord));
      const fsEmails = new Set(fsClients.map(c => c.email));
      const merged = [...fsClients, ...localClients.filter(c => !fsEmails.has(c.email))];
      // Sync localStorage with merged data so all clients persist locally
      localStorage.setItem('finalyze_clients', JSON.stringify(merged));
      setClients(merged);
    } catch (e) {
      console.warn('Failed to fetch clients from Firestore, using local cache:', e);
      setClients(localClients);
    }
  };

  // One-time repair for duplicate rows of the same customer. It covers BOTH
  // stores the Monitor shows: Firestore (stray random ids from before the
  // email-keyed ids) and the localStorage cache the table is fed from. It runs
  // ONLY from your signed-in session, is idempotent, and deletes a row only
  // after its data is on the surviving copy.
  const mergeDuplicateClients = async (): Promise<{ merged: number; removed: number }> => {
    let merged = 0;
    let removed = 0;
    const score = (r: any) =>
      (r.status === 'verified' ? 4 : 0) + (r.plan === 'paid' ? 2 : 0) + (r.uid ? 1 : 0);
    const key = (e: any) => String(e || '').toLowerCase().trim();
    const group = (rows: any[]) => {
      const byEmail = new Map<string, any[]>();
      for (const r of rows) {
        const e = key(r.email);
        if (!e || !e.includes('@')) continue;
        if (!byEmail.has(e)) byEmail.set(e, []);
        byEmail.get(e)!.push(r);
      }
      return byEmail;
    };

    // 1) Firestore: collapse every stray id onto the email-keyed document.
    try {
      const snap = await getDocs(query(collection(db, 'clients'), orderBy('rank', 'asc')));
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      for (const [, list] of group(rows)) {
        const canonicalId = clientDocId(list[0].email);
        const canonical = list.find((r) => r.id === canonicalId);
        const others = list.filter((r) => r.id !== canonicalId);
        if (!others.length) continue;
        const best = [...list].sort((a, b) => score(b) - score(a))[0];
        if (canonical) {
          const patch: any = {};
          for (const k of Object.keys(best)) {
            if (k !== 'id' && canonical[k] === undefined) patch[k] = best[k];
          }
          if (Object.keys(patch).length) {
            await setDoc(doc(db, 'clients', canonicalId), patch, { merge: true });
          }
        } else {
          const { id: _drop, ...rest } = best;
          await setDoc(doc(db, 'clients', canonicalId), rest);
        }
        merged++;
        for (const r of others) {
          await deleteDoc(doc(db, 'clients', r.id));
          removed++;
        }
      }
    } catch (e) {
      console.warn('merge firestore clients failed:', e);
    }

    // 2) localStorage cache — where the table's rows live today.
    try {
      const local: ClientRecord[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
      const deduped: ClientRecord[] = [];
      for (const [, list] of group(local)) {
        if (list.length > 1) {
          merged++;
          removed += list.length - 1;
        }
        deduped.push([...list].sort((a, b) => score(b) - score(a))[0]);
      }
      if (deduped.length !== local.length) {
        localStorage.setItem('finalyze_clients', JSON.stringify(deduped));
      }
    } catch (e) {
      console.warn('merge local clients failed:', e);
    }

    await fetchClients();
    return { merged, removed };
  };

  const saveClientRecord = async (uid: string, email: string) => {
    try {
      const id = clientDocId(email);
      // Read ONLY this client's own document. A client is not allowed to list
      // the collection, so the row's rank/status/plan are never recomputed here —
      // an existing record is left exactly as the developer set it.
      const snap = await getDoc(doc(db, 'clients', id));
      if (!snap.exists()) {
        await setDoc(doc(db, 'clients', id), {
          email, uid, status: 'inactive', plan: 'free', planExpiry: null,
          registeredAt: serverTimestamp(), rank: 0,
        });
      } else if (!snap.data()?.uid) {
        await setDoc(doc(db, 'clients', id), { uid }, { merge: true });
      }
    } catch (e) {
      console.warn('Failed to save client record:', e);
    }
  };

  const updateClientStatus = async (uid: string, status: 'active' | 'inactive' | 'banned') => {
    try {
      const snap = await getDocs(query(collection(db, 'clients'), where('uid', '==', uid)));
      if (!snap.empty) {
        await updateDoc(doc(db, 'clients', snap.docs[0].id), { status });
        fetchClients();
      }
    } catch (e) { console.warn('Failed to update client status:', e); }
  };

  const isBannedEmail = (email: string): boolean => {
    const banned: string[] = JSON.parse(localStorage.getItem('finalyze_banned_emails') || '[]');
    return banned.includes(email.toLowerCase().trim());
  };

  const banClient = async (clientId: string) => {
    const target = clients.find(c => c.id === clientId);
    if (!target) return;
    const email = target.email.toLowerCase().trim();
    // Add to banned emails list
    const banned: string[] = JSON.parse(localStorage.getItem('finalyze_banned_emails') || '[]');
    if (!banned.includes(email)) {
      banned.push(email);
      localStorage.setItem('finalyze_banned_emails', JSON.stringify(banned));
    }
    // Update Firestore
    try { await updateDoc(doc(db, 'clients', clientId), { status: 'banned' }); } catch (e) { console.warn('Firestore ban failed:', e); }
    // Update localStorage clients
    const localClients: ClientRecord[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
    localStorage.setItem('finalyze_clients', JSON.stringify(localClients.map(c => c.id === clientId ? { ...c, status: 'banned' as const } : c)));
    fetchClients();
  };

  const deleteClientRecord = async (clientId: string) => {
    const target = clients.find(c => c.id === clientId);
    // Remove from Firestore
    try { await deleteDoc(doc(db, 'clients', clientId)); } catch (e) { console.warn('Firestore delete failed:', e); }
    // Remove from localStorage clients
    const localClients: ClientRecord[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
    localStorage.setItem('finalyze_clients', JSON.stringify(localClients.filter(c => c.id !== clientId)));
    // Remove from banned list (delete = unban + make email available again)
    if (target) {
      const banned: string[] = JSON.parse(localStorage.getItem('finalyze_banned_emails') || '[]');
      localStorage.setItem('finalyze_banned_emails', JSON.stringify(banned.filter(e => e !== target.email.toLowerCase().trim())));
    }
    fetchClients();
  };

  const deleteClientByEmail = async (email: string) => {
    const lowerEmail = email.toLowerCase().trim();
    // Remove from Firestore
    try {
      const snap = await getDocs(query(collection(db, 'clients'), where('email', '==', lowerEmail)));
      snap.docs.forEach(async (d) => { await deleteDoc(doc(db, 'clients', d.id)); });
    } catch (e) { console.warn('Firestore delete by email failed:', e); }
    // Remove from localStorage clients
    const localClients: ClientRecord[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
    localStorage.setItem('finalyze_clients', JSON.stringify(localClients.filter(c => c.email.toLowerCase() !== lowerEmail)));
    // Remove from client emails list
    const clientEmails: any[] = JSON.parse(localStorage.getItem('finalyze_client_emails') || '[]');
    localStorage.setItem('finalyze_client_emails', JSON.stringify(clientEmails.filter((c: any) => c.email.toLowerCase() !== lowerEmail)));
    // Remove from banned list
    const banned: string[] = JSON.parse(localStorage.getItem('finalyze_banned_emails') || '[]');
    localStorage.setItem('finalyze_banned_emails', JSON.stringify(banned.filter(e => e !== lowerEmail)));
    // Delete the client's OWN api key, so a deleted client comes back as a brand
    // new customer: no analysis until they buy a plan and save a fresh key.
    purgeOwnKeyForEmail(lowerEmail);
    fetchClients();
  };

  const [settings, setSettings] = useState<StrategySettings>(() => {
    const saved = localStorage.getItem('strategy_settings');
    if (saved) {
      try {
        const raw: any = JSON.parse(saved);
        const merged: any = { ...DEFAULT_STRATEGY_SETTINGS, ...raw };
        // Migrate legacy default thresholds (10/20/30 pips) to the new
        // ATR-normalized defaults (15/20/30 %). We only override when the
        // stored value exactly equals the old default, so a user who
        // intentionally set a specific pip value keeps their choice.
        if (merged.candleMatchDailyThreshold === 10) merged.candleMatchDailyThreshold = 15;
        if (merged.candleMatchWeeklyThreshold === 20) merged.candleMatchWeeklyThreshold = 20;
        if (merged.candleMatchMonthlyThreshold === 30) merged.candleMatchMonthlyThreshold = 30;
        // ── One-time migration: Reversal Guard (1W+1M) is a baseline safety guard and must be ON by default.
        // Legacy installs have {useCandleMatch:false, candleDirectionFilter:false/undefined} because the default used to be OFF.
        // We auto-correct once and set a flag, so afterwards the user's manual OFF is respected.
        const MIGRATION_KEY = 'reversalGuardMigrated_v2';
        let needsPersist = false;
        if (!localStorage.getItem(MIGRATION_KEY)) {
          if (merged.useCandleMatch !== true) { merged.useCandleMatch = true; needsPersist = true; }
          if (merged.candleDirectionFilter !== true) { merged.candleDirectionFilter = true; needsPersist = true; }
          // Ensure daily/weekly/monthly enables are ON as well (they default to true)
          if (merged.candleMatchDailyEnabled === false && raw.candleMatchDailyEnabled === undefined) { merged.candleMatchDailyEnabled = true; needsPersist = true; }
          if (merged.candleMatchWeeklyEnabled === false && raw.candleMatchWeeklyEnabled === undefined) { merged.candleMatchWeeklyEnabled = true; needsPersist = true; }
          if (merged.candleMatchMonthlyEnabled === false && raw.candleMatchMonthlyEnabled === undefined) { merged.candleMatchMonthlyEnabled = true; needsPersist = true; }
          if (needsPersist) { try { localStorage.setItem('strategy_settings', JSON.stringify(merged)); } catch {} }
          try { localStorage.setItem(MIGRATION_KEY, '1'); } catch {}
        } else {
          // After migration, keep parent in sync: if direction filter is ON, guard must be ON
          if (merged.candleDirectionFilter === true && merged.useCandleMatch !== true) merged.useCandleMatch = true;
        }
        return merged;
      } catch (e) { return DEFAULT_STRATEGY_SETTINGS; }
    }
    return DEFAULT_STRATEGY_SETTINGS;
  });

  const [autoSettings, setAutoSettings] = useState<AutoAnalysisSettings>(() => {
    const saved = localStorage.getItem('auto_settings');
    let base = DEFAULT_AUTO_SETTINGS;
    if (saved) {
      try { base = { ...base, ...JSON.parse(saved) }; } catch (e) { base = DEFAULT_AUTO_SETTINGS; }
    }
    // Migrate old split stock categories into the single merged "stocks" category
    if (base.category && base.category !== 'all') {
      const parts = base.category.split(',').map((x: string) => x.trim());
      const normalized = parts.map((x: string) =>
        (x === 'stocks_us' || x === 'stocks_eu' || x === 'stocks_jp') ? 'stocks' : x
      );
      base = { ...base, category: [...new Set(normalized)].join(',') };
    }
    return base;
  });

  const [cardColor, setCardColor] = useState<string>(() => {
    return localStorage.getItem('card_color') || '#F59E0B';
  });

  useEffect(() => {
    localStorage.setItem('card_color', cardColor);
    const r = parseInt(cardColor.slice(1, 3), 16);
    const g = parseInt(cardColor.slice(3, 5), 16);
    const b = parseInt(cardColor.slice(5, 7), 16);
    document.documentElement.style.setProperty('--card-bg', `${r},${g},${b}`);
    document.documentElement.style.setProperty('--card-bg-active', `${r},${g},${b}`);
  }, [cardColor]);

  useEffect(() => {
    localStorage.setItem('auto_settings', JSON.stringify(autoSettings));
  }, [autoSettings]);
  const autoSettingsRef = useRef(autoSettings);
  useEffect(() => {
    autoSettingsRef.current = autoSettings;
  }, [autoSettings]);

  // A click tick on every button, icon, page link and section that gets pressed.
  useEffect(() => installUiClickSound(), []);

  // Web Audio API — keep unlocking on EVERY user gesture until the context is
  // truly running. The old one-shot unlock could miss entirely on
  // mobile/desktop: a locked context silently swallows ALL later programmatic
  // playback (including the developer notification pings).
  useEffect(() => {
    let done = false;
    const unlock = () => {
      if (done) return;
      try { initAudio(); } catch {}
      const ac = getAudioContext();
      if (ac && ac.state === 'running') {
        done = true;
        window.removeEventListener('click', unlock, true);
        window.removeEventListener('touchstart', unlock, true);
        window.removeEventListener('mousedown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('click', unlock, { capture: true, passive: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    window.addEventListener('mousedown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true } as any);
    return () => {
      window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
      window.removeEventListener('mousedown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // Sync URL hash with activePage so refreshes keep the same page
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if ((hash || 'main') !== activePage) {
      window.location.hash = activePage === 'main' ? '' : activePage;
    }
  }, [activePage]);

  useEffect(() => {
    const VALID_PAGES = ['settings', 'apiKey', 'plans', 'radar', 'paymentSettings', 'clientMonitor', 'profile', 'about', 'suggestions', 'ads', 'siteStats', 'trade', 'manualAnalysis', 'manualResults', 'store', 'storeSettings', 'transactions', 'prices', 'myPlan'];
    const DEV_ONLY_PAGES = ['clientMonitor', 'ads', 'siteStats', 'manualAnalysis', 'manualResults', 'storeSettings'];
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (!VALID_PAGES.includes(hash)) { setActivePage('main'); return; }
      if (DEV_ONLY_PAGES.includes(hash) && !isDeveloperSession() && !((hash === 'manualAnalysis' || hash === 'manualResults') && isPlanClient)) { setActivePage('main'); return; }
      setActivePage(hash as any);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [user]);

  const [progress, setProgress] = useState<{ current: string, total: number, index: number, failed?: number, exchange?: string } | null>(null);
  // Radar (auto-analysis) progress is tracked SEPARATELY from manual-analysis
  // progress. Both used to share `progress`, so running a manual analysis lit
  // the "auto analysis" icon in the Header by mistake. The radar writes here;
  // the Header reads from here. Manual analysis keeps using `progress` only.
  const [radarProgress, setRadarProgress] = useState<{ current: string, total: number, index: number, failed?: number, exchange?: string } | null>(null);
  const [topSignals, setTopSignals] = useState<AnalysisResult[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('top_signals_persistent') || '[]');
      // Filter out neutral signals on page load
      return stored.filter((s: AnalysisResult) => s.signal !== 'neutral' && s.signal !== 'no_entry');
    } catch { return []; }
  });
  const [lastSyncStatus, setLastSyncStatus] = useState<{ ok: boolean; count?: number; error?: string; time: number } | null>(null);

  // Web Audio API ΓÇö no unlock needed

  const playAudio = (type?: 'success' | 'fail' | 'completion' | 'start' | 'drop') => {
    const vol = Math.max(0, Math.min(1, autoSettings.volume || 0.5));
    if (type === 'success') playSuccess(vol);
    else if (type === 'completion') playCompletion(vol);
    else if (type === 'start') playStart(vol);
    else if (type === 'drop') playDrop(vol);
    else playFail(vol);
  };

  // Strip undefined values recursively (Firestore rejects undefined)
  const cleanForFirestore = (obj: any): any => {
    if (obj === undefined || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(cleanForFirestore);
    if (typeof obj === 'object') {
      const clean: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) clean[k] = cleanForFirestore(v);
      }
      return clean;
    }
    return obj;
  };

  // Track the most up-to-date signals instantly to avoid stale closures
  const signalsRef = useRef(topSignals);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Global auto-trade engine ──────────────────────────────────────────
  // Runs while the app is open, on ANY page (not just the trade page), so a
  // strong signal is opened the moment it appears and re-opened after an
  // auto-close while its signal is still shown. Started once; fed the latest
  // signals/leverage on every change. Only acts when the user has auto-trade
  // ON (localStorage AUTO_TRADE_KEY) — otherwise it stays idle.
  const autoEngineRef = useRef<AutoTradeEngine | null>(null);
  // Same-tab auto-trade switch generation. The engine-feeding useEffect below
  // depends on [topSignals, user] only, so flipping the toggle on the trade
  // page (same tab — no `storage` event fires) would otherwise leave a
  // running engine alive. Bumping this state forces a re-run that starts or
  // stops the engine immediately.
  const [autoTradeGen, setAutoTradeGen] = useState(0);
  useEffect(() => {
    const onAutoTrade = (e: Event) => {
      const on = (e as CustomEvent)?.detail?.on;
      if (typeof on === 'boolean' && !on) {
        // Switch OFF: stop instantly, don't wait for any re-render.
        autoEngineRef.current?.stop();
        autoEngineRef.current = null;
      }
      setAutoTradeGen((n) => n + 1);
    };
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key || ev.key === 'paper_trading_auto_trade') {
        try {
          if (localStorage.getItem('paper_trading_auto_trade') === '0') {
            autoEngineRef.current?.stop();
            autoEngineRef.current = null;
          }
        } catch { /* ignore */ }
        setAutoTradeGen((n) => n + 1);
      }
    };
    try { window.addEventListener('finalyze-auto-trade-changed', onAutoTrade as EventListener); } catch {}
    try { window.addEventListener('storage', onStorage); } catch {}
    return () => {
      try { window.removeEventListener('finalyze-auto-trade-changed', onAutoTrade as EventListener); } catch {}
      try { window.removeEventListener('storage', onStorage); } catch {}
    };
  }, []);
  useEffect(() => {
    // Auto-trade mirrors the trade page's own toggle: it defaults to ON and only
    // runs when the user has NOT explicitly turned it OFF (which writes '0').
    // This must match TradeNowPage's AUTO_TRADE_KEY semantics (`!== '0'`), else
    // the engine would never start for a user who left the toggle at its default.
    const isAutoOn = (() => { try { return localStorage.getItem('paper_trading_auto_trade') !== '0'; } catch { return true; } })();
    if (!isAutoOn) {
      autoEngineRef.current?.stop();
      autoEngineRef.current = null;
      return;
    }
    // Read the account's real leverage so margin checks are accurate (not a
    // hardcoded 100).
    let currentLeverage = 100;
    try {
      const raw = JSON.parse(localStorage.getItem('paper_trading_data') || 'null');
      if (raw && typeof raw.leverage === 'number' && raw.leverage > 0) currentLeverage = raw.leverage;
    } catch { /* keep default */ }
    if (!autoEngineRef.current) {
      autoEngineRef.current = new AutoTradeEngine({
        user,
        leverage: currentLeverage,
        signals: topSignals.map((s) => ({ symbol: s.symbol, signal: s.signal })),
      });
      autoEngineRef.current.start();
    } else {
      autoEngineRef.current.updateConfig({
        user,
        leverage: currentLeverage,
        signals: topSignals.map((s) => ({ symbol: s.symbol, signal: s.signal })),
      });
    }
  }, [topSignals, user, autoTradeGen]);

  useEffect(() => () => { autoEngineRef.current?.stop(); autoEngineRef.current = null; }, []);

  useEffect(() => {
    signalsRef.current = topSignals;
    localStorage.setItem('top_signals_persistent', JSON.stringify(topSignals));

    // Debounced synchronization to Firestore ΓÇö only the latest state wins
    if (isDeveloperSession()) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => {
        setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
          results: topSignals,
          timestamp: new Date().toISOString(),
          developerEmail: user?.email || '',
        })).then(() => {
          console.log('Top signals synced to Firestore successfully, count:', topSignals.length);
          setLastSyncStatus({ ok: true, count: topSignals.length, time: Date.now() });
        }).catch(e => {
          console.warn('Failed to sync top signals to Firestore:', e);
          setLastSyncStatus({ ok: false, error: String(e), time: Date.now() });
        });
      }, 300);
    }
  }, [topSignals, user]);

  // DEVELOPER: Force sync on startup — ensures signals are always in Firestore
  useEffect(() => {
    if (!isDeveloperSession() || !user) return;
    const current = signalsRef.current;
    if (current.length === 0) return;
    console.log('[DEV] Startup sync — pushing', current.length, 'signals to Firestore');
    setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
      results: current,
      timestamp: new Date().toISOString(),
      developerEmail: user?.email || '',
    })).then(() => {
      console.log('[DEV] Startup sync successful');
      setLastSyncStatus({ ok: true, count: current.length, time: Date.now() });
    }).catch(e => {
      console.warn('[DEV] Startup sync failed:', e);
      setLastSyncStatus({ ok: false, error: String(e), time: Date.now() });
    });
  }, [user]);

  // DEVELOPER: Sync radar status to Firestore so clients see banners
  useEffect(() => {
    if (!isDeveloperSession() || !user) return;
    const isRunning = !isScanningFinished && autoSettings.isEnabled;
    setDoc(doc(db, 'shared_status', 'latest'), {
      isRunning,
      timestamp: new Date().toISOString(),
      developerEmail: user?.email || '',
    }).catch(e => console.warn('[DEV] Failed to sync radar status:', e));
  }, [isScanningFinished, autoSettings.isEnabled, user]);

  useEffect(() => {
    localStorage.setItem('language', lang);
    document.body.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (isDark) document.body.classList.remove('light');
    else document.body.classList.add('light');
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('strategy_settings', JSON.stringify(settings));
  }, [settings]);

  const saveStrategySettings = () => {
    localStorage.setItem('strategy_settings', JSON.stringify(settings));
  };
  const saveAutoSettings = async () => {
    localStorage.setItem('auto_settings', JSON.stringify(autoSettings));
    if (ownsPaidPlan) localStorage.setItem(cxnAutoKey, JSON.stringify(autoSettings));
    // Developer: save to Firestore so clients get the alert settings
    if (isDeveloperSession()) {
      try {
        await setDoc(doc(db, 'shared_alerts', 'latest'), {
          autoSettings,
          strategySettings: settings,
          timestamp: new Date().toISOString(),
        });
      } catch (e) { console.warn('Failed to save alerts to Firestore:', e); }
    }
  };

  const updateTopSignals = (results: AnalysisResult[]) => {
    try {
    let changed = false;
    let hasBrandNewSymbol = false;
    const now = Date.now();

    // ΓöÇΓöÇ TIMEFRAME-BASED HOLD PERIODS ΓöÇΓöÇ
    const getHoldPeriods = (tf: string) => {
      switch (tf) {
        case '1d': return { minHold: 24 * 3600 * 1000, maxAge: 72 * 3600 * 1000 };
        case '4h': return { minHold: 4 * 3600 * 1000, maxAge: 12 * 3600 * 1000 };
        case '1h': return { minHold: 1 * 3600 * 1000, maxAge: 3 * 3600 * 1000 };
        case '15m': return { minHold: 30 * 60 * 1000, maxAge: 60 * 60 * 1000 };
        case '5m': return { minHold: 15 * 60 * 1000, maxAge: 30 * 60 * 1000 };
        default: return { minHold: 4 * 3600 * 1000, maxAge: 12 * 3600 * 1000 };
      }
    };

    // ΓöÇΓöÇ SIGNAL RANK ΓöÇΓöÇ
    const signalRank: Record<string, number> = {
      'strong_buy': 5, 'strong_sell': 5, 'buy': 4, 'sell': 4, 'neutral': 2, 'no_entry': 1
    };

    // ΓöÇΓöÇ CHECK IF MARKET DATA ACTUALLY CHANGED ΓöÇΓöÇ
    const hasRealMarketChange = (oldRes: AnalysisResult, newRes: AnalysisResult): boolean => {
      // RSI crossed boundaries
      const oldRsi = oldRes.technicalScore;
      const newRsi = newRes.technicalScore;
      if ((oldRsi <= 70 && newRsi > 70) || (oldRsi >= 30 && newRsi < 30)) return true;
      // Direction flipped
      if (oldRes.direction && newRes.direction && oldRes.direction !== newRes.direction) return true;
      // Confidence dropped drastically (more than 30 points)
      if (oldRes.confidence - newRes.confidence > 30) return true;
      // Signal rank changed
      if ((signalRank[oldRes.signal] || 0) > (signalRank[newRes.signal] || 0)) return true;
      return false;
    };

    // Purge signals that exceeded max age
    let updated = signalsRef.current.filter(s => {
      const { maxAge } = getHoldPeriods(s.timeframe);
      const age = now - new Date(s.timestamp).getTime();
      if (age >= maxAge) {
        changed = true;
        return false;
      }
      return true;
    });

    results.forEach(res => {
      if (res.signal === 'neutral' || res.signal === 'no_entry') return; // neutral hidden
      if (res.isSideways) return; // sideways signals completely hidden

      // ── PULLBACK ENTRY NOTE (no longer a hard hide) ──
      // The signal is ALWAYS surfaced to the box (we never leave it empty). The
      // pullback strategy's real protection is applied upstream in the engine:
      //   • entryPrice is anchored at the retrace zone (better entry, not a chase)
      //   • stopLoss is widened to 3× ATR so the normal 3-5 candle pullback that
      //     used to stop you out no longer touches it.
      // We keep the computed pullbackReadyForEntry flag on the result so the
      // chart / UI can *annotate* how ready it is, but it never removes the card.
      if (res.entryMode === 'pullback' && res.pullbackReadyForEntry === false) {
        // Soft note only — the signal still shows; nothing is hidden here.
      }

      const existing = updated.find(s => s.symbol === res.symbol);
      const { minHold } = getHoldPeriods(res.timeframe);
      const existingAge = existing ? now - new Date(existing.timestamp).getTime() : Infinity;
      const withinMinHold = existingAge < minHold;

      if (existing) {
        // ΓöÇΓöÇ RULE: Within min hold ΓåÆ NEVER remove or downgrade unless 2+ primary conditions collapsed ΓöÇΓöÇ
        if (withinMinHold) {
          const oldPrimary = existing.primaryMetCount ?? 4;
          const newPrimary = res.primaryMetCount ?? 4;
          const primaryDrop = oldPrimary - newPrimary;

          // Allow UPGRADE always (strong_buy > buy)
          const newRank = signalRank[res.signal] || 0;
          const oldRank = signalRank[existing.signal] || 0;
          if (newRank > oldRank) {
            updated = updated.map(s => s.symbol === res.symbol ? res : s);
            changed = true;
          }
          // Allow downgrade ONLY if 2+ primary conditions collapsed AND market data actually changed
          else if (primaryDrop >= 2 && hasRealMarketChange(existing, res)) {
            updated = updated.map(s => s.symbol === res.symbol ? res : s);
            changed = true;
          }
          // Otherwise: keep existing signal untouched
          return;
        }

        // ΓöÇΓöÇ Past min hold: allow normal signal evolution ΓöÇΓöÇ
        // Still require market data change for downgrade
        const oldPrimary = existing.primaryMetCount ?? 4;
        const newPrimary = res.primaryMetCount ?? 4;
        const primaryDrop = oldPrimary - newPrimary;
        const newRank = signalRank[res.signal] || 0;
        const oldRank = signalRank[existing.signal] || 0;

        if (newRank >= oldRank) {
          // Upgrade or same: always apply
          updated = updated.map(s => s.symbol === res.symbol ? res : s);
          changed = true;
        } else if (primaryDrop >= 2 && hasRealMarketChange(existing, res)) {
          // Downgrade: only if 2+ primary collapsed AND data changed
          updated = updated.map(s => s.symbol === res.symbol ? res : s);
          changed = true;
        }
        // else: no meaningful change ΓåÆ keep existing
      } else {
        // ΓöÇΓöÇ Brand new symbol: add to top signals ΓöÇΓöÇ
        updated.unshift(res);
        changed = true;
        hasBrandNewSymbol = true;
      }
    });

    if (changed) {
      const previousMap = new Map(signalsRef.current.map(s => [s.symbol, s]));
      const resolved = resolveConflicts(updated);
      const resolvedSet = new Set(resolved.map(s => s.symbol));

      // BUG FIX: Restore signals that were previously visible but removed by
      // resolveCorrelationConflicts when new correlated symbols appeared
      for (const [sym, prevSig] of previousMap) {
        if (!resolvedSet.has(sym)) {
          const currentSig = updated.find(u => u.symbol === sym);
          if (currentSig) resolved.push(currentSig);
        }
      }

      // Separate strong and regular signals (exclude sideways)
      const strong = resolved.filter(s => (s.signal === 'strong_buy' || s.signal === 'strong_sell') && !s.isSideways);
      const regular = resolved.filter(s => (s.signal === 'buy' || s.signal === 'sell') && !s.isSideways);
      
      // Pass all signals - TopSignals component handles category-based display
      // Each category independently shows its strong signals + top 3 regular
      const published = [...strong, ...regular];
      setTopSignals(published);

      // ── DIRECT ENGINE KICK (same-tick auto-open) ──
      // Why: the global AutoTradeEngine is fed through a useEffect on
      // [topSignals, user]. That effect fires AFTER this render commits, and
      // the trade page's own list only refreshes on mount — so a signal that
      // just appeared could sit visible-but-unopened until a manual refresh.
      // Kicking the engine synchronously right where the signals are
      // published guarantees the trade opens the moment the signal shows,
      // with zero dependence on effect timing. Uses the ref directly (and
      // falls back to a custom event for any listener) — never waits.
      try {
        const eng = (autoEngineRef as any)?.current;
        if (eng && typeof eng.scanNow === 'function') {
          eng.updateConfig?.({ signals: published.map((s: any) => ({ symbol: s.symbol, signal: s.signal })) });
          eng.scanNow();
        } else {
          try { window.dispatchEvent(new CustomEvent('finalyze-signals-published', { detail: { count: published.length } })); } catch {}
        }
      } catch { /* engine kick is best-effort */ }

      if (hasBrandNewSymbol) {
        setNewSignalAlert(lang === 'ar' ? '✅ لقد تم رصد فرصة تداول قوية جديدة!' : '✅ New strong trading opportunity detected!');
        setTimeout(() => setNewSignalAlert(null), 8000);
        setTimeout(() => {
          try { initAudio(); } catch {}
          playAudio('success');
        }, 400);
      }
    }
    } catch (e) { console.warn('[updateTopSignals] Error:', e); }
  };

  const removeSignal = async (symbol: string) => {
    const updated = signalsRef.current.filter(s => s.symbol !== symbol);
    setTopSignals(updated);
    if (isDeveloperSession()) {
      try {
        await setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
          results: updated,
          timestamp: new Date().toISOString(),
          developerEmail: user?.email || '',
        }));
      } catch (e) { console.warn('[removeSignal] Firestore sync failed:', e); }
    }
  };

  const handleClearAll = async () => {
    setTopSignals([]);
    if (isDeveloperSession()) {
      try {
        const resetToken = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
        await setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
          results: [],
          resetToken,
          timestamp: new Date().toISOString(),
          developerEmail: user?.email || '',
        }));
        console.log('Clear synced to Firestore, token:', resetToken);
      } catch (e) {
        console.warn('Failed to clear Firestore shared_results:', e);
      }
    }
  };

  const removeClientSignal = (symbol: string) => {
    setClientSignals(prev => {
      const updated = prev.filter(s => s.symbol !== symbol);
      if (isPlanClient) {
        localStorage.setItem(cxnSigKey, JSON.stringify(updated));
      } else {
        localStorage.setItem('finalyze_client_signals', JSON.stringify(updated));
      }
      return updated;
    });
  };

  const handleClearClientSignals = () => {
    setClientSignals([]);
    if (isPlanClient) {
      localStorage.removeItem(cxnSigKey);
    } else {
      localStorage.removeItem('finalyze_client_signals');
    }
  };

  const removeAnalysisResult = (symbol: string) => {
    if (!analysisResults) return;
    const updated = analysisResults.filter(r => r.symbol !== symbol);
    setAnalysisResults(updated.length > 0 ? updated : null);
    if (isPlanClient) {
      removeClientSignal(symbol);
    }
  };

  const handleClearAnalysisResults = () => {
    setAnalysisResults(null);
    if (isPlanClient) {
      handleClearClientSignals();
    }
  };

  const handleSelectSignal = (result: AnalysisResult) => {
    setAnalysisResults([result]);
    setShowForm(false);
  };

  const isMarketOpen = (category: string) => {
    if (category === 'crypto') return true;
    const day = new Date().getUTCDay();
    // Strictly closed on Saturday (6) and Sunday (0)
    if (day === 0 || day === 6) return false;
    return true;
  };

  // AUTO-CLEAR STALE SIGNALS AT START OF NEW TRADING DAY
  const lastPurgeDateRef = useRef<string>('');
  useEffect(() => {
    const checkAndPurgeNewDay = async () => {
      const today = new Date().toISOString().slice(0, 10);
      if (lastPurgeDateRef.current === today) return;
      const lastPurgeStored = localStorage.getItem('finalyze_last_purge_date');
      if (lastPurgeStored === today) {
        lastPurgeDateRef.current = today;
        return;
      }

      const day = new Date().getUTCDay();
      const isWeekend = day === 0 || day === 6;
      const allCryptos = ALL_SYMBOLS_DB.crypto || [];

      if (!isDeveloperSession()) {
        const today2 = new Date().toISOString().slice(0, 10);
        const clientLastDate = localStorage.getItem('finalyze_client_results_date');
        if (clientLastDate !== today2) {
          setClientSignals([]);
          localStorage.removeItem('finalyze_client_signals');
          localStorage.setItem('finalyze_client_results_date', today2);
        }
        lastPurgeDateRef.current = today;
        localStorage.setItem('finalyze_last_purge_date', today);
        return;
      }

      const current = signalsRef.current;
      let filtered: AnalysisResult[];
      if (isWeekend) {
        filtered = current.filter(s => {
          const sym = s.symbol.toUpperCase();
          return allCryptos.includes(sym) || sym.includes('-USD') || sym.endsWith('USD');
        });
      } else {
        filtered = [];
      }

      lastPurgeDateRef.current = today;
      localStorage.setItem('finalyze_last_purge_date', today);
      localStorage.setItem('top_signals_persistent', JSON.stringify(filtered));
      setTopSignals(filtered);

      try {
        const resetToken = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
        await setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
          results: filtered,
          resetToken,
          timestamp: new Date().toISOString(),
          developerEmail: user?.email || '',
        }));
        console.log('Automated new trading day purge executed. Remaining:', filtered.length);
      } catch (e) {
        console.warn('[purgeNewDay] Firestore purge failed:', e);
      }
    };

    checkAndPurgeNewDay();
    const interval = setInterval(checkAndPurgeNewDay, 5 * 60 * 1000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, [user]);

  // RADAR - Developer only, never auto-starts on page load
  const radarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runRadarScan = useCallback(async () => {
    const s = autoSettingsRef.current;
    if (!s.isEnabled) return;
    // A free account never runs analysis: the server refuses its requests, so we
    // stop it here instead of burning the shared keys on guaranteed failures.
    if (!isDeveloperSession() && !isPlanClient) {
      setAutoSettings((prev) => ({ ...prev, isEnabled: false }));
      return;
    }

    // Ensure audio is unlocked (may be called before first user click if radar auto-starts)
    try { initAudio(); } catch {}

    // Play start alert sound
    try { playAudio('start'); } catch {}

    const cats = s.category === 'all'
      ? Object.keys(SYMBOL_CATEGORIES) as (keyof typeof SYMBOL_CATEGORIES)[]
      : (s.category || 'all').split(',') as (keyof typeof SYMBOL_CATEGORIES)[];

    // Expand "stocks" into only the exchanges that are OPEN right now.
    // Each job carries the region + label so the UI can show which exchange is being scanned.
    const openJobs: { cat: string; region?: StockExchangeKey; exchange?: OpenExchange }[] = [];
    for (const cat of cats) {
      if (cat === 'stocks') {
        for (const ex of getOpenStockExchanges()) {
          openJobs.push({ cat, region: ex.key, exchange: ex });
        }
      } else if (isMarketOpen(cat)) {
        openJobs.push({ cat, region: undefined, exchange: undefined });
      }
    }
    if (openJobs.length === 0) return;

    setIsScanningFinished(false);

    let hidden: string[] = [];
    let custom: string[] = [];
    try {
      hidden = JSON.parse(localStorage.getItem(ownsPaidPlan ? cxnHiddenKey : 'finalyze_hidden_symbols') || '[]');
      custom = JSON.parse(localStorage.getItem(ownsPaidPlan ? cxnCustomKey : 'finalyze_custom_symbols') || '[]');
    } catch {}

    // Track ALL results from this scan directly (not via batched React state)
    const scanResults: AnalysisResult[] = [];
    let scanFailed = 0;

    for (let jobIdx = 0; jobIdx < openJobs.length; jobIdx++) {
      if (!autoSettingsRef.current.isEnabled) break;
      const { cat, region, exchange } = openJobs[jobIdx];
      // Alert 3: Category complete and beginning of next category analysis
      if (jobIdx > 0) {
        try { initAudio(); } catch {}
        try { playCategoryChange(autoSettingsRef.current.volume || 0.6); } catch {}
      }

      const mt = cat === 'crypto' ? MarketType.CRYPTO :
                 cat.startsWith('stocks') ? MarketType.STOCKS :
                 cat === 'metals' ? MarketType.METALS : MarketType.FOREX;

      const regional = new Set<string>(region ? (STOCKS_BY_EXCHANGE[region] || []) : []);

      const syms = hasActivePlan
        ? (() => {
            const g = SYMBOL_GROUPS[cat]?.flatMap(x => x.symbols) || [];
            const gFiltered = region ? g.filter(x => regional.has(x)) : g;
            const c = custom.filter(x =>
              (ALL_SYMBOLS_DB[cat] || []).includes(x) && !g.includes(x) &&
              (!region || regional.has(x))
            );
            return [...gFiltered, ...c].filter(x => !hidden.includes(x));
          })()
        : (() => {
            const free = FREE_SYMBOLS[cat] || [];
            return region ? free.filter(x => regional.has(x)) : free;
          })();

      for (const sym of syms) {
        if (!autoSettingsRef.current.isEnabled) break;

          setRadarProgress({ current: sym, total: syms.length, index: scanResults.length, failed: scanFailed, exchange: exchange ? exchangeLabel(exchange.key, lang) : undefined });

        let lastError: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!autoSettingsRef.current.isEnabled) break;
          await waitIfRateLimited();
          try {
            const r = await Promise.race([
              analyzeMarket({
                symbol: sym, type: mt,
                timeframe: s.timeframe,
                tradingStyle: s.tradingStyle,
                settings, lang
              }),
              new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000))
            ]);
            if (r && !(r as any).error) {
              const sig = r.signal || '';
              // Do NOT publish signals to topSignals incrementally here. The
              // auto-trade engine consumes topSignals, and publishing mid-scan
              // would open trades on a single symbol BEFORE the whole category
              // is analyzed and the best-per-category filter runs. topSignals
              // is written once, authoritatively, at the end of the scan.
              if (sig && sig !== 'no_entry' && sig !== 'neutral' && !r.isSideways) {
                scanResults.push(r);
                setClientSignals(prev => {
                  const u = [...prev.filter(x => x.symbol !== r.symbol), r];
                  localStorage.setItem(ownsPaidPlan ? cxnSigKey : 'finalyze_client_signals', JSON.stringify(u.slice(-100)));
                  return u.slice(-100);
                });
                if (isPlanClient) {
                  const isStrong = sig === 'strong_buy' || sig === 'strong_sell';
                  setNewSignalAlert(lang === 'ar' ? (isStrong ? `✅ لقد تم رصد فرصة تداول قوية جديدة! — ${r.symbol}` : `✅ لقد تم رصد فرصة تداول جديدة! — ${r.symbol}`) : (isStrong ? `✅ New strong trading opportunity detected! — ${r.symbol}` : `✅ New trading opportunity detected! — ${r.symbol}`));
                  setTimeout(() => setNewSignalAlert(null), 8000);
                  try { playAudio('success'); } catch {}
                }
              }
              lastError = null;
              break;
            }
          } catch (e: any) {
            lastError = e;
            const isTimeout = e?.message === 'timeout';
            const isRateLimit = e?.message?.includes('429') || e?.message?.includes('rate');
            if (isRateLimit) {
              await new Promise(r => setTimeout(r, 15000));
              continue;
            }
            if (isTimeout && attempt === 0) {
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
            break;
          }
        }
        if (lastError) {
          console.error(`Radar Error [${sym}]:`, lastError.message);
          scanFailed++;
        setRadarProgress({ current: sym, total: syms.length, index: scanResults.length, failed: scanFailed, exchange: exchange ? exchangeLabel(exchange.key, lang) : undefined });
          await new Promise(r => setTimeout(r, 3000));
        } else {
          // Paced between symbols so a scan never hammers the shared key pool.
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    }

    // Publish the whole scan to topSignals ONCE, here, after every open
    // category finished and the best-per-category / conflict-resolution inside
    // updateTopSignals has run. This is the SAME pipeline the manual-analysis
    // path uses (it calls updateTopSignals on its results too), so radar and
    // manual now produce identical results for the same category. It also feeds
    // the global auto-trade engine, which reads ONLY topSignals — without this
    // call the radar's signals never reached topSignals, so (a) radar results
    // never showed in the signals box and (b) auto-trade never opened a trade.
    updateTopSignals(scanResults);

    // Save results to Firestore for clients ΓÇö only if there are results
    if (!isPlanClient) {
    try {
      const merged = signalsRef.current || [];
      if (merged.length > 0) {
        await Promise.race([
          setDoc(doc(db, 'shared_results', 'latest'), cleanForFirestore({
            results: merged.slice(-100),
            timestamp: new Date().toISOString(),
            developerEmail: user?.email || '',
          })),
          new Promise<null>((_, rej) => setTimeout(() => rej(new Error('shared_results timeout')), 15000))
        ]);
        setLastSyncStatus({ ok: true, count: merged.length, time: Date.now() });
        console.log('Radar scan synced to Firestore, count:', merged.length);
      }
    } catch (e) {
      console.warn('Firestore sync failed:', e);
      setLastSyncStatus({ ok: false, error: String(e), time: Date.now() });
    }
    }

    // Save alerts to Firestore for clients
    if (!isPlanClient) {
    try {
      await Promise.race([
        setDoc(doc(db, 'shared_alerts', 'latest'), {
          autoSettings: s,
          strategySettings: settings,
          timestamp: new Date().toISOString(),
        }),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error('shared_alerts timeout')), 15000))
      ]);
    } catch (e) {
      console.warn('Firestore save failed:', e);
    }
    }

    // Clear radar progress (manual analysis keeps its own `progress` state)
    setRadarProgress(null);
  }, [settings, lang, hasActivePlan, user, isPlanClient]);

  // Radar lifecycle: start on toggle-ON, stop on toggle-OFF
  const prevRadarEnabledRef = useRef(false);
  const radarFirstRenderRef = useRef(true);

  useEffect(() => {
    if (!isDeveloperSession() && !planClientActive) return;

    const isOn = autoSettings.isEnabled;
    const wasOn = prevRadarEnabledRef.current;
    prevRadarEnabledRef.current = isOn;

    // Turned OFF: cancel timer, stop
    if (wasOn && !isOn) {
      if (radarTimerRef.current) {
        clearTimeout(radarTimerRef.current);
        radarTimerRef.current = null;
      }
      return;
    }

    if (!isOn) return;

    // Shared scan loop
    const loop = async () => {
      try {
        await runRadarScan();
      } catch (e) {
        console.error('Radar error:', e);
      }       finally {
        // Save UTC timestamp so catch-up works after tab throttling
        const nowTs = Date.now();
        try {
          setAutoSettings(prev => {
            const next = { ...prev, lastFinishedAt: nowTs };
            localStorage.setItem('auto_settings', JSON.stringify(next));
            if (ownsPaidPlan) localStorage.setItem(cxnAutoKey, JSON.stringify(next));
            return next;
          });
        } catch {}

        setIsScanningFinished(true);
        setFoundAnyStrong(signalsRef.current.length > 0);
        try { initAudio(); } catch {}
        playAudio('completion');
        setShowRadarComplete(true);
        setTimeout(() => setShowRadarComplete(false), 30000);

        if (autoSettingsRef.current.isEnabled) {
          const ms = (autoSettingsRef.current.interval || 15) * 60000;
          radarTimerRef.current = setTimeout(() => {
            radarTimerRef.current = null;
            setIsScanningFinished(false);
            loop();
          }, ms);
        }
      }
    };

    // First render: check UTC-based catch-up, or schedule after interval
    if (radarFirstRenderRef.current) {
      radarFirstRenderRef.current = false;
      const ms = (autoSettings.interval || 15) * 60000;
      const lastTs = autoSettings.lastFinishedAt || 0;
      const elapsed = lastTs ? Date.now() - lastTs : Infinity;
      if (elapsed >= ms) {
        // Overdue — scan immediately
        setIsScanningFinished(false);
        loop();
      } else {
        // Schedule with remaining time
        setIsScanningFinished(true);
        radarTimerRef.current = setTimeout(() => {
          radarTimerRef.current = null;
          setIsScanningFinished(false);
          loop();
        }, ms - elapsed);
      }
      return;
    }

    // Toggled from OFF to ON — scan immediately
    if (!wasOn) {
      loop();
    }

    // Catch up on missed scans when tab becomes visible again
    const onVisibilityChange = () => {
      if (document.hidden || !autoSettingsRef.current.isEnabled) return;
      if (radarTimerRef.current) return;
      const lastTs = autoSettingsRef.current.lastFinishedAt || 0;
      const ms = (autoSettingsRef.current.interval || 15) * 60000;
      const elapsed = lastTs ? Date.now() - lastTs : Infinity;
      if (elapsed >= ms) {
        setIsScanningFinished(false);
        loop();
      } else {
        setIsScanningFinished(true);
        radarTimerRef.current = setTimeout(() => {
          radarTimerRef.current = null;
          setIsScanningFinished(false);
          loop();
        }, ms - elapsed);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [autoSettings.isEnabled, user]);

  // Build version check: force cache bust on new deploy
  useEffect(() => {
    try {
      const currentVersion = __BUILD_VERSION__;
      const storedVersion = localStorage.getItem('finalyze_build_version');
      if (storedVersion && storedVersion !== currentVersion) {
        console.log('New version detected. Old:', storedVersion, 'New:', currentVersion, '— clearing caches and reloading.');
        // Clear browser caches
        if ('caches' in window) {
          caches.keys().then(names => names.forEach(name => caches.delete(name)));
        }
        // Clear stale client data
        localStorage.removeItem('finalyze_client_signals');
        localStorage.removeItem('finalyze_client_results_date');
        localStorage.removeItem('finalyze_client_reset_token');
        localStorage.removeItem('top_signals_persistent');
        localStorage.removeItem('finalyze_client_alerts');
        localStorage.removeItem('finalyze_custom_logo');
        // Save new version then hard reload
        localStorage.setItem('finalyze_build_version', currentVersion);
        window.location.reload();
        return;
      }
      localStorage.setItem('finalyze_build_version', currentVersion);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.removeItem('finalyze_verify_link');
    setLoginError(null);
    setRedirecting(false);
  }, []);

  useEffect(() => {
    // 1. Check if we have a persistent custom session
    const savedUserJson = localStorage.getItem('finalyze_auth_user');
    const savedTimestampStr = localStorage.getItem('finalyze_auth_timestamp');

    if (savedUserJson && savedTimestampStr) {
      try {
        const savedUser = JSON.parse(savedUserJson) as User;
        const savedTimestamp = parseInt(savedTimestampStr, 10);
        const email = savedUser.email || '';

        // Check if the user is a developer:
        const activeDevEmail = localStorage.getItem('finalyze_dev_email') || DEVELOPER_EMAILS[0];
        const isDeveloper = email === activeDevEmail ||
                            isDeveloperEmail(email) ||
                            email.includes('dev');

        if (isDeveloper) {
          // Keep developer session active forever
          setUser(savedUser);
          setHasApiKey(true);
          persistNeedsApiKey(null);
          setLoading(false);
          return;
        } else {
          // Regular client session expires after 3 days (3 * 24 * 60 * 60 * 1000 ms)
          const elapsed = Date.now() - savedTimestamp;
          const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
          if (elapsed < threeDaysInMs) {
            setUser(savedUser);
            const localKey = (() => {
              const k1 = localStorage.getItem('finalyze_key1_value');
              if (k1 && localStorage.getItem('finalyze_key1_enabled') !== 'false') return k1;
              return localStorage.getItem('finalyze_user_groq_api_key') || '';
            })();
            if (localKey) {
              setHasApiKey(true);
            } else {
              setHasApiKey(false);
            }
            persistNeedsApiKey(null);
            setLoading(false);
            return;
          } else {
            // Session expired! Clear custom keys
            localStorage.removeItem('finalyze_auth_user');
            localStorage.removeItem('finalyze_auth_timestamp');
          }
        }
      } catch (e) {
        console.error("Failed to restore persistent custom session:", e);
      }
    }

    // 2. Standard Firebase Auth listener
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      // A cached session must never mask the LIVE Firebase identity: after a
      // purchase registers this browser under the payment address, the cached
      // copy can go stale — the real signed-in account wins (localStorage is
      // trivially forgeable, an idToken is not). The developer's own cached
      // session is still respected so the tools keep working.
      const cachedRaw = localStorage.getItem('finalyze_auth_user');
      if (cachedRaw) {
        let cachedEmail = '';
        try { cachedEmail = String(JSON.parse(cachedRaw)?.email || '').toLowerCase().trim(); } catch {}
        const liveEmail = (u?.email || '').toLowerCase().trim();
        const cachedIsDev = DEVELOPER_EMAILS.includes(cachedEmail) || cachedEmail.includes('dev');
        const stale = !!liveEmail && liveEmail !== cachedEmail && !cachedIsDev;
        if (!stale) {
          setLoading(false);
          return;
        }
        localStorage.removeItem('finalyze_auth_user');
        localStorage.removeItem('finalyze_auth_timestamp');
      }
      
      if (u) {
        setUser(u);
        const email = u.email || '';
        const activeDevEmail = localStorage.getItem('finalyze_dev_email') || DEVELOPER_EMAILS[0];
        const isDeveloper = email === activeDevEmail || isDeveloperEmail(email) || email.includes('dev');

        // Fetch clients list for developer session
        if (isDeveloper) {
          fetchClients();
        }
        
        // Cache Firebase session in custom storage for 3-day / permanent benefits
        const mockCompactUser = {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName || 'User',
          photoURL: u.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150',
          emailVerified: u.emailVerified,
        };
        localStorage.setItem('finalyze_auth_user', JSON.stringify(mockCompactUser));
        localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
        const localKey = readClientOwnKeyForEmails(clientEmailsFor(u.email));
        if (localKey) {
          applyRuntimeAnalysisKey(localKey);
          setHasApiKey(true);
        } else {
          try {
            const userDoc = await getDoc(doc(db, 'users', u.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              if (data?.groqApiKey || data?.geminiApiKey) {
                const ak = data.groqApiKey || data.geminiApiKey;
                // Store under THIS account's email only — never in the shared
                // slots, which belong to the developer.
                writeClientOwnKey(ak, u.email || null);
                setHasApiKey(true);
              } else {
                setHasApiKey(false);
              }
            } else {
              setHasApiKey(false);
            }
          } catch (err) {
            console.error("Failed to load user API key from Firestore:", err);
            setHasApiKey(false);
          }
        }
      } else {
        setUser(null);
        setHasApiKey(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ── Automatic customer sign-in ───────────────────────────────────────────
  // The free plan itself needs NO login — a visitor walks straight in. What
  // restores itself is the BUYER: their purchase saved a random password in
  // this browser only, and it signs them back in silently on every visit, so
  // the plan, the key and the notifications always resolve to their own email.
  // A restored session with no real Firebase identity behind it would be given
  // no private data by the rules, so it is repaired here — or dropped, which
  // puts the visitor back to a normal free session instead of a broken one.
  useEffect(() => {
    if (loading) return;
    let savedEmail = '';
    try {
      const saved = JSON.parse(localStorage.getItem('finalyze_auth_user') || 'null');
      savedEmail = String(saved?.email || '').toLowerCase().trim();
    } catch {}

    const authEmail = (auth.currentUser?.email || '').toLowerCase().trim();

    if (savedEmail) {
      if (DEVELOPER_EMAILS.includes(savedEmail)) return;
      if (authEmail === savedEmail) return;
      (async () => {
        const ok = await ensureClientIdentity(savedEmail);
        const nowAuthed = (auth.currentUser?.email || '').toLowerCase().trim();
        if (!ok && !nowAuthed) {
          localStorage.removeItem('finalyze_auth_user');
          localStorage.removeItem('finalyze_auth_timestamp');
          setUser(null);
          setLoading(false);
        }
      })().catch(() => {});
      return;
    }

    if (user) return;
    (async () => {
      const ok = await silentClientLogin();
      if (ok) return;
      const paid = getLastEmail();
      if (paid) await ensureClientIdentity(paid);
    })().catch(() => {});
  }, [loading, user]);

  // Load clients from localStorage on mount (always, regardless of auth state)
  useEffect(() => {
    const localClients = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
    if (localClients.length > 0) {
      setClients(localClients);
    }
    // Also try Firestore in background
    fetchClients();
  }, []);

  // Redirect non-dev users away from dev-only pages
  useEffect(() => {
    const canOpenManual = (activePage === 'manualAnalysis' || activePage === 'manualResults') && isPlanClient;
    if (!loading && !isDeveloperSession() && DEV_ONLY_PAGES.includes(activePage) && !canOpenManual) {
      setActivePage('main');
      window.location.hash = '';
    }
  }, [loading, user, activePage, isPlanClient]);

  // Load custom audios from IndexedDB on startup
  useEffect(() => {
    const loadSavedAudios = async () => {
      try {
        const { getAudioBlob } = await import('./lib/db');
        const { loadCustomAudio } = await import('./lib/audioEngine');
        
        const successBlob = await getAudioBlob('custom_success');
        if (successBlob) await loadCustomAudio('custom_success', successBlob);
        
        const failBlob = await getAudioBlob('custom_fail');
        if (failBlob) await loadCustomAudio('custom_fail', failBlob);
        
        const completionBlob = await getAudioBlob('custom_completion');
        if (completionBlob) await loadCustomAudio('custom_completion', completionBlob);
        
        console.log('Saved custom audios loaded into audio engine successfully.');
      } catch (e) {
        console.warn('Failed to load saved custom audios from IndexedDB:', e);
      }
    };
    loadSavedAudios();

    // Hot-reload when custom audios are updated from Settings
    const handleAudioUpdate = () => {
      loadSavedAudios();
    };
    window.addEventListener('custom-audio-updated', handleAudioUpdate);
    return () => window.removeEventListener('custom-audio-updated', handleAudioUpdate);
  }, []);

  // Sync freemium state from localStorage (when PaymentModal toggles it)
  useEffect(() => {
    const sync = () => setFreemiumDisabled(localStorage.getItem('finalyze_freemium_disabled') === 'true');
    window.addEventListener('freemium-toggle', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('freemium-toggle', sync); window.removeEventListener('storage', sync); };
  }, []);

  // The "Enable / Disable Plans for Clients" switch is gone: the store always
  // sells. Any flag left by an older session is forced off, and the developer
  // clears the shared setting once so clients can never load a hidden state.
  useEffect(() => {
    localStorage.setItem('finalyze_freemium_disabled', 'false');
    localStorage.setItem('finalyze_hide_plans', 'false');
    setFreemiumDisabled(false);
    if (isDeveloperSession()) {
      setDoc(doc(db, 'shared_settings', 'freemium'), { disabled: false, updatedAt: Date.now() }).catch(() => {});
    }
  }, []);

  // Redirect away from plans page when freemium is ON (full free access)
  useEffect(() => {
    if (activePage === 'plans' && freemiumDisabled && !isDeveloperSession()) {
      setActivePage('main');
    }
  }, [activePage, freemiumDisabled]);

  // Handle email verification from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vEmail = params.get('email');
    const vToken = params.get('token');
    const isVerify = params.get('verify') === 'true';

    if (isVerify && vEmail && vToken) {
      (async () => {
        try {
          const snap = await getDocs(query(collection(db, 'clients'), where('email', '==', vEmail), where('verifyToken', '==', vToken)));
          if (!snap.empty) {
            const docRef = doc(db, 'clients', snap.docs[0].id);
            await updateDoc(docRef, { status: 'verified', verifyToken: '' });
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname);
            // Auto sign-in anonymously and redirect to API key setup
            localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: vEmail, placeholder: true }));
            localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
            localStorage.removeItem('active_subscription');
            const cred = await signInAnonymously(auth);
            const mockUser = {
              uid: cred.user.uid, email: vEmail,
              displayName: 'Client',
              photoURL: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150',
              emailVerified: true,
            } as User;
            setUser(mockUser);
            persistNeedsApiKey(null);
          } else {
            alert(lang === 'ar' ? '\u26a0\ufe0f \u0631\u0628\u0637 \u0627\u0644\u062a\u062d\u0642\u0642 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d \u0623\u0648 \u0645\u0646\u062a\u0647\u064a.' : '\u26a0\ufe0f Invalid or expired verification link.');
            window.history.replaceState({}, '', window.location.pathname);
          }
        } catch (e) {
          console.error('Verification error:', e);
          window.history.replaceState({}, '', window.location.pathname);
        }
      })();
    }
  }, [loading]);

  const processGoogleUser = async (email: string, displayName?: string, photoURL?: string) => {
    // Developer emails ΓåÆ sign in directly
    if (isDeveloperEmail(email) || email.includes('dev')) {
      localStorage.setItem('finalyze_auth_user', JSON.stringify({ uid: 'dev_' + email.replace(/[^a-zA-Z0-9]/g, ''), email, displayName: 'Developer', emailVerified: true }));
      localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
      setUser({ uid: 'dev_' + email.replace(/[^a-zA-Z0-9]/g, ''), email, displayName: 'Developer', emailVerified: true } as User);
      setHasApiKey(true);
      persistNeedsApiKey(null);
      fetchClients();
      return;
    }

    try {
      // Site sign-in is unrestricted: direct Google login, exactly as before.
      // The Google/Microsoft restriction applies ONLY to buying a paid plan.
      // Read this client's OWN record by its deterministic id — a client is not
      // allowed to run a collection query, and must never see another row.
      const existingSnap = await getDoc(doc(db, 'clients', clientDocId(email)));
      const existing = existingSnap.exists() ? existingSnap.data() : null;
      // Bind this Google/Microsoft login to the payment email if it differs, so
      // the plan, its key and My Plan resolve to the same identity from now on.
      rememberBuyerEmail(email, email);

      if (existing?.groqApiKey && !hasAnyStoredKey()) {
        // Restore THIS client's own key, scoped to their email. Writing it into
        // the shared slots would hand one customer's key to the next.
        writeClientOwnKey(existing.groqApiKey, email);
      }

      if (isBannedEmail(email) || existing?.status === 'banned') {
        setLoginError(lang === 'ar' ? '\u062d\u0635\u0631 \u0627\u0644\u062d\u0633\u0627\u0628 \u0645\u062d\u0638\u0648\u0638. \u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644.' : 'This account is banned. You cannot log in.');
        setRedirecting(false);
        return;
      }

      // Set session via localStorage FIRST
      localStorage.setItem('finalyze_auth_user', JSON.stringify({ uid: email, email, displayName: displayName || 'Client', photoURL: photoURL || '', emailVerified: true }));
      localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());

      // Set user in state
      setUser({ uid: email, email, displayName: displayName || 'Client', photoURL: photoURL || '', emailVerified: true } as User);
      setHasApiKey(hasAnyStoredKey());
      persistNeedsApiKey(null);

      const clientEmails: any[] = JSON.parse(localStorage.getItem('finalyze_client_emails') || '[]');
      if (!clientEmails.some((c: any) => c.email === email)) {
        clientEmails.push({ email, registeredAt: new Date().toISOString(), uid: email });
        localStorage.setItem('finalyze_client_emails', JSON.stringify(clientEmails));
      }

      try {
        // Deterministic id + get, never a collection query: a client may only
        // touch their own record. plan/planExpiry are NOT written on login —
        // only the developer (or a payment) sets them, so signing in can never
        // wipe a running plan.
        const cid = clientDocId(email);
        const existing = await getDoc(doc(db, 'clients', cid));
        if (existing.exists()) {
          await setDoc(doc(db, 'clients', cid), { status: 'verified' }, { merge: true });
        } else {
          await setDoc(doc(db, 'clients', cid), {
            email, status: 'verified', plan: 'free', planExpiry: null,
            registeredAt: serverTimestamp(), rank: 0,
          });
        }
      } catch (e) { console.warn('Firestore save on login failed:', e); }

      const localClients: any[] = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
      if (!localClients.some((c: any) => c.email?.toLowerCase() === email.toLowerCase())) {
        localClients.push({
          id: 'local_' + Date.now(),
          email,
          status: 'verified',
          plan: 'free',
          planExpiry: null,
          registeredAt: new Date().toISOString(),
          rank: 0,
        });
        localStorage.setItem('finalyze_clients', JSON.stringify(localClients));
        fetchClients();
      }
    } catch (innerErr) {
      console.error('Non-critical error during client setup:', innerErr);
      localStorage.setItem('finalyze_auth_user', JSON.stringify({ uid: email, email, displayName: displayName || 'Client', photoURL: photoURL || '', emailVerified: true }));
      localStorage.setItem('finalyze_auth_timestamp', Date.now().toString());
      setUser({ uid: email, email, displayName: displayName || 'Client', photoURL: photoURL || '', emailVerified: true } as User);
      setHasApiKey(hasAnyStoredKey());
      persistNeedsApiKey(null);
    }
  };

  // Developer notification sounds. Fires a Messenger-style ping when any header
  // bell count GROWS (a brand-new suggestion / payment request / site request).
  // Ref-based so the interval/listener logic never depends on the counts and can
  // never loop on itself. Skipped during the very first snapshot of each stream
  // so opening the site does not ping for already-seen items.
  const notifCountsRef = useRef({ suggestions: 0, payments: 0, sites: 0 });
  const notifPrimedRef = useRef({ suggestions: false, payments: false, sites: false });
  // Watch the signed-in address explicitly (deps): the first render's `user` is
  // usually null, and a [] closure would freeze that and never ping afterwards.
  const devEmail = (user?.email || '').toLowerCase().trim();
  // Pending pings: when a bell grows while AudioContext is still locked (no
  // user gesture yet), the browser swallows sound silently. The ping is parked
  // here and replayed on the next unlock gesture, so it is never truly lost.
  const pendingPingRef = useRef(false);
  const firePing = useCallback(() => {
    try { initAudio(); } catch {}
    const ac = getAudioContext();
    if (ac && ac.state === 'running') {
      pendingPingRef.current = false;
      try { playMessengerPing(0.6); } catch {}
      return true;
    }
    pendingPingRef.current = true;
    try { playMessengerPing(0.6); } catch {}
    return false;
  }, []);
  // Replay a parked ping on any gesture (the context-opening listeners above
  // unlock the context itself; this one rings the bell left waiting).
  useEffect(() => {
    const retry = () => {
      if (!pendingPingRef.current) return;
      firePing();
    };
    window.addEventListener('click', retry, { capture: true, passive: true });
    window.addEventListener('touchstart', retry, { capture: true, passive: true });
    window.addEventListener('mousedown', retry, { capture: true, passive: true });
    window.addEventListener('keydown', retry, { capture: true, passive: true } as any);
    return () => {
      window.removeEventListener('click', retry, true);
      window.removeEventListener('touchstart', retry, true);
      window.removeEventListener('mousedown', retry, true);
      window.removeEventListener('keydown', retry, true);
    };
  }, [firePing]);
  const devPing = useCallback((kind: 'suggestions' | 'payments' | 'sites', next: number) => {
    const prevCounts = notifCountsRef.current;
    const primed = notifPrimedRef.current;
    const prev = prevCounts[kind];
    prevCounts[kind] = next;
    if (!isDeveloperSession()) {
      if (!primed[kind] && next > 0) primed[kind] = true;
      return;
    }
    if (!primed[kind]) { primed[kind] = true; return; }
    if (next > prev) firePing();
  }, [devEmail, firePing]);

  // Fetch new suggestions count for developer notifications — LIVE listener so
  // the red badge appears the instant a client posts, even if the developer
  // logs in AFTER the page loaded (the old fetch-once effect silently stayed 0).
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const recompute = async (overrideIds?: string[]) => {
      try {
        if (!isDeveloperSession()) return;
        // Load the hidden set (stored in shared_settings — open read, no auth).
        // NOTE: we must NOT do `total - hiddenIds.length` — hidden IDs are kept
        // forever while deleted suggestions shrink `total`, so that subtraction
        // eventually clamps the badge to 0 permanently. Count by ID instead.
        const hidden = new Set<string>();
        const seen = new Set<string>();
        try {
          const { getDoc: fsGetDoc, doc: fsDoc } = await import('firebase/firestore');
          const [hiddenSnap, seenSnap] = await Promise.all([
            fsGetDoc(fsDoc(db, 'shared_settings', 'dev_hidden_suggestions')),
            fsGetDoc(fsDoc(db, 'shared_settings', 'dev_seen_suggestions')),
          ]);
          if (hiddenSnap.exists()) {
            ((hiddenSnap.data().hiddenIds || []) as string[]).forEach((id) => hidden.add(id));
          }
          // "seen" = the developer already opened the Suggestions page. Treating it
          // as read (not just hidden) is what makes the red badge stay gone after a
          // refresh instead of snapping back.
          if (seenSnap.exists()) {
            ((seenSnap.data().seenIds || []) as string[]).forEach((id) => seen.add(id));
          }
        } catch {}
        const ids = overrideIds
          ?? (await getDocs(query(collection(db, 'analysisResults'), where('_type', '==', 'suggestion')))).docs.map((d) => d.id);
        const next = ids.reduce((n, id) => (hidden.has(id) || seen.has(id) ? n : n + 1), 0);
        setNewSuggestionsCount(next);
        devPing('suggestions', next);
      } catch {}
    };
    try {
      unsub = onSnapshot(
        query(collection(db, 'analysisResults'), where('_type', '==', 'suggestion')),
        (snap) => { void recompute(snap.docs.map((d) => d.id)); },
        () => { void recompute(); },
      );
    } catch {}
    // Safety net for a dropped listener: re-check every minute.
    timer = setInterval(() => { void recompute(); }, 60000);
    // Re-run when the session resolves so a developer logging in late still gets
    // the count and the priming (no ping for old items).
    void recompute();
    return () => {
      if (unsub) { try { unsub(); } catch {} unsub = null; }
      if (timer) clearInterval(timer);
    };
  }, [user?.email, devPing]);

  // Developer: unread payment request notifications — LIVE listener so the red
  // badge + ping fire the instant a payment poller or client creates a
  // pending request, not up to 30s later.
  useEffect(() => {
    if (!user) return;
    let unsubDev: (() => void) | null = null;
    let unsubSite: (() => void) | null = null;
    let stopped = false;
    const refresh = async () => {
      if (!isDeveloperSession()) return;
      const [payCount, siteCount] = await Promise.all([
        getUnreadDevNotificationCount(),
        getUnreadSiteRequestCount(),
      ]);
      if (stopped) return;
      setPaymentRequestsCount(payCount);
      setSiteRequestsCount(siteCount);
      devPing('payments', payCount);
      devPing('sites', siteCount);
    };
    const attach = () => {
      try {
        unsubDev = onSnapshot(
          query(collection(db, 'payment_requests'), where('status', '==', 'pending')),
          (snap) => { if (!isDeveloperSession() || stopped) return; const c = snap.size; setPaymentRequestsCount(c); devPing('payments', c); },
          () => { void refresh(); },
        );
      } catch {}
      try {
        unsubSite = onSnapshot(
          // Single filter on purpose: _type+read together would demand a
          // composite index and fail silently on fresh projects — filter `read`
          // in memory instead.
          query(collection(db, 'analysisResults'), where('_type', '==', 'siteRequest')),
          (snap) => {
            if (!isDeveloperSession() || stopped) return;
            const c = snap.docs.filter((d) => (d.data() as any)?.read !== true).length;
            setSiteRequestsCount(c);
            devPing('sites', c);
          },
          () => { void refresh(); },
        );
      } catch {}
    };
    attach();
    void refresh();
    const interval = setInterval(refresh, 60000);
    return () => {
      stopped = true;
      clearInterval(interval);
      if (unsubDev) { try { unsubDev(); } catch {} unsubDev = null; }
      if (unsubSite) { try { unsubSite(); } catch {} unsubSite = null; }
    };
  }, [user, activePage, devPing]);

  // Client: pick up a developer-approved plan grant and activate the subscription.
  // Runs on login and when returning to the app so a release works even if the
  // site was closed while the developer approved it.
  useEffect(() => {
    if (!user?.email || isDeveloperSession()) return;
    let stopped = false;
    const checkGrant = async () => {
      try {
        const grants = await fetchUserGrants(user.email!);
        if (stopped) return;
        // An active plan grant may or may not have started yet. A grant WITHOUT
        // expiryDate is a legacy row from before approval released plans
        // automatically; the server recomputes its calendar on the next approval.
        const planGrants = grants.filter((g) => g.kind === 'plan' && g.status === 'active');
        if (!planGrants.length) return;
const started = planGrants
          .filter((g) => g.expiryDate && !isNaN(new Date(g.expiryDate).getTime()) && new Date(g.expiryDate) > new Date())
          .sort((a, b) => new Date(b.expiryDate!).getTime() - new Date(a.expiryDate!).getTime());
        const pendingKey = planGrants.filter((g) => !g.expiryDate || isNaN(new Date(g.expiryDate).getTime()));
        const best = started[0] || pendingKey[0];
        if (!best) return;
        // Every period the developer approved is kept, so the first release is the
        // earliest start and the visible end is the latest expiry (stacking).
        // Dates arrive as ISO strings, epoch numbers or Firestore Timestamps, so
        // they are normalised before being compared.
        const starts = planGrants
          .map((g) => grantTimeMillis(g.activatedAt || g.releasedAt))
          .filter((n) => isFinite(n) && n > 0);
        const firstReleaseIso = starts.length
          ? new Date(Math.min(...starts)).toISOString()
          : (best.createdAt ? new Date(grantTimeMillis(best.createdAt) || Date.now()).toISOString() : new Date().toISOString());
        const subs = {
          label: best.planLabel || 'Plan',
          amount: best.amountUsd || 0,
          // The client's FIRST release is the earliest activatedAt across every
          // approved period, while the end date is the LATEST one — that is what
          // makes renewals stack instead of replacing each other.
          activatedAt: firstReleaseIso,
          firstReleasedAt: firstReleaseIso,
          expiryDate: best.expiryDate || '',
          requestNo: best.requestNo,
          durationDays: best.durationDays,
          planUnit: best.planUnit,
          planUnits: best.planUnits,
        };
        setActiveSubscription((prev) => {
          // The grant list is the only truth: keep the FURTHEST end date so a
          // renewal is never shortened by a poll landing on an older grant, but
          // never keep a date the server no longer reports (an expired plan must
          // disappear instead of lingering for years from local storage).
          const prevEnd = prev && prev.expiryDate ? new Date(prev.expiryDate).getTime() : 0;
          const thisEnd = subs.expiryDate ? new Date(subs.expiryDate).getTime() : 0;
          if (!thisEnd) {
            try { localStorage.removeItem('active_subscription'); } catch {}
            return null;
          }
          const merged = prevEnd > thisEnd && prev
            ? { ...subs, expiryDate: prev.expiryDate, label: prev.label || subs.label, firstReleasedAt: subs.firstReleasedAt || prev.firstReleasedAt }
            : subs;
          try { localStorage.setItem('active_subscription', JSON.stringify(merged)); } catch {}
          if (!freeModeOverride()) setPaidMode(true);
          return merged;
        });
      } catch {}
    };
    checkGrant();
    const interval = setInterval(checkGrant, 60000);
    return () => { stopped = true; clearInterval(interval); };
  }, [user?.email]);

  const handleLogin = async (which: AuthProviderId = 'google') => {
    setActivePage('main');
    setPaymentPlan(null);
    setAnalysisResults(null);
    setIsSidebarOpen(false);
    setLoginError(null);
    setManualAuthUrl(null);
    setRedirecting(true);
    setRedirectingProvider(which);
    try {
      const provider = which === 'microsoft' ? new OAuthProvider('microsoft.com') : new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const email = result?.user?.email || result?.user?.providerData?.[0]?.email || '';
      if (!email) { throw new Error('no_email'); }
      // Site sign-in is direct and unrestricted. The Google/Microsoft rule is
      // enforced only when a paid plan is purchased (see PaymentModal).
      await processGoogleUser(email, result.user.displayName || undefined, result.user.photoURL || undefined);
    } catch (error: any) {
      console.error("=== OAuth sign-in ERROR ===", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('\u0644\u0642\u062f \u0623\u063a\u0644\u0642\u062a \u0646\u0627\u0641\u0630\u0629 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644. \u062a\u0639\u064a\u062f \u0644\u0644\u0645\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.');
      } else if (error.code === 'auth/unauthorized-domain') {
        setLoginError(`\u062d\u0635\u0631 \u0627\u0644\u0645\u0646\u0637\u0642\u0629 (${window.location.hostname}) \u063a\u064a\u0631 \u0645\u0635\u063a\u0651\u064a\u0631 \u0639\u0644\u0649 Firebase.`);
      } else if (error.message === 'no_email') {
        setLoginError('\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u062d\u0635\u0648\u0644 \u0639\u0644\u0649 \u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a \u0627\u0644\u0645\u0631\u0636\u064a \u0628\u0647. \u062a\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.');
      } else {
        setLoginError(`Sign-in error: ${error.code || error.message}`);
      }
    } finally {
      setRedirecting(false);
      setRedirectingProvider(null);
    }
  };

  const handleLogout = async () => {
    signOut(auth).catch(() => {});
    localStorage.removeItem('finalyze_auth_user');
    localStorage.removeItem('finalyze_auth_timestamp');
    localStorage.removeItem('finalyze_verify_link');
    localStorage.removeItem('finalyze_geo');
    localStorage.removeItem('finalyze_build_version');
    localStorage.removeItem('finalyze_client_signals');
    localStorage.removeItem('finalyze_client_results_date');
    localStorage.removeItem('finalyze_client_reset_token');
    localStorage.removeItem('top_signals_persistent');
    localStorage.removeItem('finalyze_client_alerts');
    localStorage.removeItem('active_subscription');
    sessionStorage.clear();
    window.location.href = '/';
  };

  const t = translations[lang];

  // Track initial page view (skip for developer)
  useEffect(() => {
    if (!isDeveloperSession()) trackPageView('main').catch(() => {});
  }, [user]);

  // Auto sign-in anonymously when clientLoginRequired is false
  useEffect(() => {
    if (!clientLoginRequired && !user && !loading) {
      console.log('[AUTH] Client login disabled, entering as guest (no auth needed)');
      // No auth needed — Firestore rules allow unauthenticated reads
    }
  }, [clientLoginRequired, user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg relative">
      {/* Analysis Detail Page Overlay */}
      {detailResult && (
        <AnalysisDetailPage
          result={detailResult}
          onBack={() => setDetailResult(null)}
          lang={lang}
          isClient={false}
        />
      )}
      {clientDetailResult && (
        <AnalysisDetailPage
          result={clientDetailResult}
          onBack={() => setClientDetailResult(null)}
          lang={lang}
          isClient={true}
        />
      )}

      <AnimatePresence>
        {newSignalAlert && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-4"
          >
            <div className="bg-emerald-500/20 backdrop-blur-md border border-emerald-500/40 rounded-2xl p-4 flex items-center justify-between shadow-2xl shadow-emerald-500/20">
              <span className="text-emerald-400 text-xs font-black uppercase tracking-widest">
                {newSignalAlert}
              </span>
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!user && !loading && clientLoginRequired && (
          <LoginOverlay 
            onLogin={handleLogin} 
            lang={lang}
            onLangChange={setLang}
            loginError={loginError}
            onClearError={() => { setLoginError(null); setPendingVerifyLink(null); }}
            redirecting={redirecting}
            redirectingProvider={redirectingProvider}
            manualAuthUrl={manualAuthUrl}
          />
        )}
      </AnimatePresence>

      {/* CLIENT PLAN: no gate and no key. The developer's approval releases the
          plan immediately and analysis runs on the shared key pool. */}

      <Header 
        user={user} onLogin={handleLogin} onLogout={handleLogout} 
        isDark={isDark} toggleTheme={() => setIsDark(!isDark)}
        lang={lang} onLangChange={setLang}
        showBack={!!analysisResults} onBack={() => { setAnalysisResults(null); setAnalysisError(null); goBack(); }}
        autoSettings={autoSettings} onAutoSettingsChange={setAutoSettings}
        isWaiting={isScanningFinished}
        hasApiKey={hasApiKey || isDeveloperSession()}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isDeveloper={isDeveloperSession()}
        planClient={isPlanClient}
        hasActivePlan={ownsPaidPlan && subscriptionActive}
        isPaidMode={paidMode}
        onActivatePaidPlan={activatePaidPlan}
        onReturnToFreePlan={returnToFreePlan}
        onOpenMyPlan={() => setShowMyPlan(true)}
        onStartClientAutoAnalysis={() => {
          try { initAudio(); } catch {}
          setAutoSettings(prev => ({ ...prev, isEnabled: !prev.isEnabled }));
          setIsSidebarOpen(false);
        }}
        lastSyncStatus={lastSyncStatus}
        // radarProgress = auto-analysis (radar) only. Manual analysis writes to
        // `progress`, so it can never light the auto-analysis icon again.
        analysisProgress={radarProgress}
        isAnalyzing={isAnalyzing}
        newSuggestionsCount={effectivePage === 'suggestions' ? 0 : newSuggestionsCount}
        onNavigateSuggestions={() => navigateTo('suggestions')}
        paymentRequestsCount={effectivePage === 'storeSettings' ? 0 : paymentRequestsCount + siteRequestsCount}
        onNavigatePaymentRequests={() => navigateTo('storeSettings')}
        clientRadarRunning={!isDeveloperSession() && clientRadarRunning}
        showRadarComplete={!isDeveloperSession() && showRadarComplete}
        onPreview={isDeveloperSession() ? (device) => setPreviewDevice(device) : undefined}
        isPWA={isPWA || window.self !== window.top}
        onNavigatePage={(page) => { navigateTo(page); setIsSidebarOpen(false); }}
        freemiumDisabled={freemiumDisabled}
        storeVisited={storeVisited}
        compact={effectivePage === 'trade'}
      />

      {/* Sidebar Panel - dropdown below menu icon */}
      <AnimatePresence>
        {isSidebarOpen && !isPWA && window.self === window.top && (
          <SidebarPanel
            lang={lang}
            onClose={() => setIsSidebarOpen(false)}
            onNavigate={(page) => { navigateTo(page); setIsSidebarOpen(false); }}
            isDeveloper={isDeveloperSession()}
            freemiumDisabled={freemiumDisabled}
            onPreview={isDeveloperSession() ? (device) => setPreviewDevice(device) : undefined}
            user={user}
            customAvatar={localStorage.getItem('finalyze_custom_avatar')}
            onLogin={handleLogin}
            onLogout={handleLogout}
            planClient={isPlanClient}
            onStartClientAutoAnalysis={() => {
              try { initAudio(); } catch {}
              setAutoSettings(prev => ({ ...prev, isEnabled: !prev.isEnabled }));
              setIsSidebarOpen(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Device Preview Overlay */}
      <DevicePreview
        isOpen={!!previewDevice}
        onClose={() => setPreviewDevice(null)}
        device={previewDevice || 'phone'}
      />

      <AnimatePresence>
        {isScanningFinished && !foundAnyStrong && autoSettings.isEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-brand-alt border-b border-red-500/20 py-2 text-center"
          >
            <span className="text-red-500 text-[10px] font-black uppercase tracking-widest">
              {lang === 'ar' ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0625\u0634\u0627\u0631\u0627\u062a \u0642\u0648\u064a\u0629 \u062d\u0627\u0644\u064a\u0627\u064b' : 'No strong signals currently'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      
      <main className={`flex-grow w-full relative transition-all duration-300 ${effectivePage === 'trade' ? 'pt-[104px] md:pt-[132px] pb-3 px-0 max-w-none' : 'max-w-7xl mx-auto px-4 pt-[144px] md:pt-[340px] pb-8'}`}>
        {/* Dedicated pages (from dashboard) */}
        {effectivePage !== 'main' && (!needsApiKey || effectivePage === 'store' || effectivePage === 'plans' || effectivePage === 'storeSettings' || effectivePage === 'paymentSettings' || effectivePage === 'prices' || effectivePage === 'myPlan' || (effectivePage as string) === 'manualResults' || ((effectivePage === 'manualAnalysis' || (effectivePage as string) === 'manualResults') && isPlanClient) || (effectivePage === 'radar' && isPlanClient)) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

             {effectivePage === 'settings' && (
               <SettingsModal
                key={user?.uid || 'no-session'}
                isOpen={true}
                onClose={goBack}
                settings={settings}
                onSettingsChange={(s) => { setSettings(s); }}
                onSave={saveStrategySettings}
                user={user}
                asPage
                lang={lang}
                onDeleteClientResults={handleClearAll}
                planClient={isPlanClient}
                planKeyEntered={planKeyed}
              />
            )}

            {effectivePage === 'myPlan' && showPlanControls && activeSubscription && (
              <MyPlanModal
                asPage
                lang={lang}
                plan={activeSubscription}
                features={myPlanFeatures}
                paidMode={paidMode}
                onClose={() => navigateTo('main')}
                onReturnToFree={returnToFreePlan}
                onActivate={activatePaidPlan}
                onDeletePlan={deleteClientPlan}
                email={user?.email || clientEmailsFor(user?.email)[0] || ''}
              />
            )}

            {effectivePage === 'apiKey' && (
              <ApiKeyModal
                key={user?.uid || 'no-session'}
                isOpen={true}
                onClose={goBack}
                isBlocking={false}
                lang={lang}
                user={user}
                onSaved={(key) => { setHasApiKey(!!key); goBack(); }}
                onLogout={handleLogout}
                asPage
              />
            )}

            {effectivePage === 'plans' && !paymentPlan && !botPurchase && !(freemiumDisabled && !isDeveloperSession()) && (
              <SubscriptionModal
                key={user?.uid || 'no-session'}
                isOpen={true}
                onClose={goBack}
                onSelectPlan={(amount, label, durationDays) => { navigateTo('plans'); setPaymentPlan({ amount, label, durationDays }); }}
                asPage
              />
            )}

            {effectivePage === 'plans' && paymentPlan && (botPurchase || !(freemiumDisabled && !isDeveloperSession())) && (
              <PaymentModal
                key={user?.uid || 'no-session'}
                isOpen={true}
                onClose={() => { setResumeSessionId(null); setPaymentPlan(null); setBotPurchase(null); goBack(); }}
                planLabel={paymentPlan?.label || ''}
                amount={paymentPlan?.amount || 0}
                asPage
                lang={lang}
                botPurchase={botPurchase}
                sectionTab={botPurchase ? 'bot' : 'plan'}
                buyerEmail={
                  isGoogleOrMicrosoftEmail(user?.email)
                    ? (user?.email || '')
                    : ''
                }
                buyerName={user?.displayName || ''}
                planDurationDays={paymentPlan?.durationDays}
                planUnit={paymentPlan?.planUnit}
                planUnits={paymentPlan?.planUnits}
                resumeSessionId={resumeSessionId}
                onBotPaid={() => { setResumeSessionId(null); setBotPurchase(null); setPaymentPlan(null); goBack(); }}
                onGoToStore={() => { setResumeSessionId(null); setPaymentPlan(null); setBotPurchase(null); navigateTo('store'); }}
                onGoToPlans={() => { setResumeSessionId(null); setPaymentPlan(null); setBotPurchase(null); navigateTo('plans'); }}
                onConfirm={async (grantInfo?: { expiryDate?: string; requestNo?: number }) => {
                  const plan = paymentPlan!;
                  const buyerEmail = user?.email || '';
                  // Use the server-computed expiryDate from the grant if available;
                  // fall back to a local calculation only when no grant info is passed.
                  const serverExpiry = grantInfo?.expiryDate ? new Date(grantInfo.expiryDate) : null;
                  // Without a grant the period is still the plan's own: one hour
                  // must never fall back to a thirty-day month.
                  const fallbackDays = Number(plan.durationDays) > 0 ? Number(plan.durationDays) : 30;
                  const subExpiry = serverExpiry ?? new Date(Date.now() + fallbackDays * 86400000);
                  const firstReleaseIso = new Date().toISOString();
                  if (buyerEmail) {
                    // A successful payment REGISTERS the client on the site under
                    // their payment email: this becomes their identity, so the
                    // plan, the key gate and My Plan all resolve to one account.
                    rememberBuyerEmail(buyerEmail, buyerEmail);
                    setCurrentUserEmail(buyerEmail);
                    // Make the client visible in Client Monitor with a running paid
                    // plan (the crown tag), whether this is their first purchase
                    // or a renewal. Without this the buyer would only get a
                    // localStorage subscription and never show up as a client.
                    try {
                      // Deterministic id: the payer writes ONLY their own record.
                      const payload = {
                        status: 'verified',
                        plan: 'paid',
                        planExpiry: subExpiry.toISOString(),
                        autoRegistered: true,
                        updatedAt: serverTimestamp(),
                      };
                      await setDoc(doc(db, 'clients', clientDocId(buyerEmail)), {
                        email: buyerEmail.toLowerCase().trim(),
                        ...payload,
                        registeredAt: serverTimestamp(),
                        rank: 0,
                      }, { merge: true });
                      fetchClients();
                    } catch (e) { console.warn('Auto client registration on payment failed:', e); }
                  }
                  const sub = {
                    label: plan.label,
                    amount: plan.amount,
                    activatedAt: firstReleaseIso,
                    firstReleasedAt: firstReleaseIso,
                    expiryDate: subExpiry.toISOString(),
                    requestNo: grantInfo?.requestNo,
                    durationDays: plan.durationDays,
                    planUnit: plan.planUnit,
                    planUnits: plan.planUnits,
                  };
                  localStorage.setItem('active_subscription', JSON.stringify(sub));
                  setActiveSubscription(sub);
                  // A new payment reopens paid mode immediately.
                  setPaidMode(true);
                  setFreeModeChosen(false);
                  setResumeSessionId(null);
                  setPaymentPlan(null);
                  navigateTo('main');
                }}
              />
            )}

            {effectivePage === 'radar' && (
              <RadarSettingsPage
                key={user?.uid || 'no-session'}
                autoSettings={autoSettings}
                onAutoSettingsChange={setAutoSettings}
                onSave={saveAutoSettings}
                isWaiting={isScanningFinished}
                lang={lang}
                hasActivePlan={hasActivePlan}
                onUpgrade={() => navigateTo('plans')}
                isDeveloper={isDeveloperSession()}
              />
            )}

            {effectivePage === 'clientMonitor' && isDeveloperSession() && (
              <ClientMonitor
                key={user?.uid || 'no-session'}
                clients={clients}
                lang={lang}
                onRefresh={fetchClients}
                onMergeDuplicates={mergeDuplicateClients}
                onBan={banClient}
                onDelete={deleteClientRecord}
                onDeleteByEmail={deleteClientByEmail}
                freemiumDisabled={freemiumDisabled}
                onFreemiumToggle={(v: boolean) => { setFreemiumDisabled(v); localStorage.setItem('finalyze_freemium_disabled', v ? 'true' : 'false'); setDoc(doc(db, 'shared_settings', 'freemium'), { disabled: v, updatedAt: Date.now() }).catch(console.warn); }}
                clientLoginRequired={clientLoginRequired}
                onClientLoginToggle={(v: boolean) => { setClientLoginRequired(v); localStorage.setItem('finalyze_client_login_required', v ? 'true' : 'false'); setDoc(doc(db, 'shared_settings', 'clientLogin'), { required: v, updatedAt: Date.now() }).catch(console.warn); }}
              />
            )}

            {effectivePage === 'ads' && isDeveloperSession() && (
              <AdsManager lang={lang} onBack={() => goBack()} />
            )}

            {effectivePage === 'siteStats' && isDeveloperSession() && (
              <SiteStatsPage lang={lang} />
            )}

            {effectivePage === 'profile' && (
              <ProfilePage
                user={user}
                lang={lang}
                onBack={goBack}
                isDeveloper={isDeveloperSession()}
                autoEmail={user?.email || ''}
                onResumeSession={(session) => {
                  if (session.kind === 'bot') {
                    fetchStoreBots().then((bots) => {
                      const bot = bots.find((b) => b.id === session.botId) || null;
                      if (bot) setBotPurchase(bot);
                      else setBotPurchase(null);
                      setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                      setResumeSessionId(session.id);
                      navigateTo('plans');
                    }).catch(() => {
                      setBotPurchase(null);
                      setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                      setResumeSessionId(session.id);
                      navigateTo('plans');
                    });
                  } else {
                    setBotPurchase(null);
                    setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                    setResumeSessionId(session.id);
                    navigateTo('plans');
                  }
                }}
              />
            )}

            {effectivePage === 'about' && (
              <AboutPage
                lang={lang}
                onBack={goBack}
                onGoToSuggestions={() => navigateTo('suggestions')}
              />
            )}

            {effectivePage === 'transactions' && (
              <TransactionsPage
                lang={lang}
                onBack={goBack}
                autoEmail={user?.email || ''}
                isDeveloper={isDeveloperSession()}
                onGoToStore={() => navigateTo('store')}
                onResumeSession={(session) => {
                  if (session.kind === 'bot') {
                    fetchStoreBots().then((bots) => {
                      const bot = bots.find((b) => b.id === session.botId) || null;
                      if (bot) setBotPurchase(bot);
                      else setBotPurchase(null);
                      setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                      setResumeSessionId(session.id);
                      navigateTo('plans');
                    }).catch(() => {
                      setBotPurchase(null);
                      setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                      setResumeSessionId(session.id);
                      navigateTo('plans');
                    });
                  } else {
                    setBotPurchase(null);
                    setPaymentPlan({ amount: session.amountUsd, label: session.planLabel || '', durationDays: session.durationDays || 0, planUnit: session.planUnit, planUnits: session.planUnits });
                    setResumeSessionId(session.id);
                    navigateTo('plans');
                  }
                }}
              />
            )}

            {effectivePage === 'prices' && (
              <SeoPricesPage lang={lang} onBack={goBack} />
            )}

            {effectivePage === 'suggestions' && (
              <SuggestionsPage
                lang={lang}
                onBack={() => navigateTo('about')}
                userName={user?.displayName || user?.email || ''}
                userUid={user?.uid || ''}
                userEmail={user?.email || currentUserEmail() || getLastEmail() || ''}
                isDeveloper={isDeveloperSession()}
                onClearCount={() => setNewSuggestionsCount(0)}
                onHideCount={(n) => setNewSuggestionsCount(prev => Math.max(0, prev - n))}
              />
            )}

            {/* Trade page: mounted ALWAYS (hidden when not active) so the
                auto-open engine keeps scanning displayed signals and the
                trailing/monitor loop keeps protecting open trades even while
                the user browses other pages. Opening a trade no longer requires
                sitting on the trade page. */}
            <div className={effectivePage === 'trade' ? 'contents' : 'hidden'} aria-hidden={effectivePage !== 'trade'}>
              <TradeNowPage lang={lang} user={user} signals={topSignals} />
            </div>

            {effectivePage === 'store' && (
              <StorePage
                lang={lang}
                onBack={goBack}
                isDark={isDark}
                userName={user?.displayName || ''}
                userEmail={user?.email || ''}
                onBuyBot={(bot) => {
                  setResumeSessionId(null);
                  setBotPurchase(bot);
                  setPaymentPlan({ amount: bot.price / 100, label: '', durationDays: 0 });
                  navigateTo('plans');
                }}
                onBuyPlan={(plan) => {
                  setResumeSessionId(null);
                  setBotPurchase(null);
                  setPaymentPlan({ amount: plan.priceUsd, label: (isAr ? plan.labelAr : plan.labelEn) || plan.key, durationDays: plan.durationDays, planUnit: plan.planUnit, planUnits: plan.planUnits });
                  navigateTo('plans');
                }}
                customerPlan={activeSubscription}
                planKeyEntered={planKeyed}
                paidMode={paidMode}
                onCustomerEnterKey={() => { setPaidMode(true); }}
                onCustomerUseFree={() => setPaidMode(false)}
                onCustomerUsePaid={() => { setPaidMode(true); }}
                onCustomerDeletePlan={() => { deleteClientPlan(); }}
              />
            )}

            {effectivePage === 'storeSettings' && isDeveloperSession() && (
              <div className="max-w-4xl mx-auto px-4 space-y-10">
                <StoreSettingsPage
                  lang={lang}
                  onBack={goBack}
                  freemiumDisabled={freemiumDisabled}
                  onFreemiumToggle={(v: boolean) => { setFreemiumDisabled(v); localStorage.setItem('finalyze_freemium_disabled', v ? 'true' : 'false'); setDoc(doc(db, 'shared_settings', 'freemium'), { disabled: v, updatedAt: Date.now() }).catch(console.warn); }}
                />
                <KeyPoolPanel lang={lang} />
              </div>
            )}

            {effectivePage === 'manualAnalysis' && (isDeveloperSession() || isPlanClient) && (
              <div className="max-w-4xl mx-auto px-4 py-8">
                <h2 className="text-2xl font-black text-brand-text mb-6 text-center">
                  {lang === 'ar' ? 'التحليل اليدوي' : 'Manual Analysis'}
                </h2>
                <AnalysisForm
                  user={user} lang={lang} settings={settings}
                  hasActivePlan={hasActivePlan}
                  onUpgrade={() => navigateTo('plans')}
                  autoStartToken={isPlanClient ? autoAnalyzeToken : 0}
                  onAutoStartConsumed={() => setAutoAnalyzeToken(0)}
                  onBegin={() => {
                    setIsAnalyzing(true);
                    setAnalysisError(null);
                    try { initAudio(); } catch {}
                    try { playAudio('start'); } catch {}
                    navigateTo('manualResults');
                  }}
                  onProgress={(current, total, index, failed) => setProgress({ current, total, index, failed })}
                  onResult={(results) => {
                    const day = new Date().getUTCDay();
                    const allCryptos = ALL_SYMBOLS_DB.crypto || [];
                    const filtered = (day === 0 || day === 6)
                      ? results.filter(r => {
                          const sym = r.symbol.toUpperCase();
                          return allCryptos.includes(sym) || sym.includes('-USD') || sym.endsWith('USD');
                        })
                      : results;
                    setAnalysisResults(filtered);
                    setIsAnalyzing(false);
                    setAnalysisError(null);
                    setProgress(null);
                    updateTopSignals(filtered);
                    if (isPlanClient) {
                      setClientSignals(prev => {
                        const nonSideways = filtered.filter(r => !r.isSideways && r.signal !== 'no_entry' && r.signal !== 'neutral');
                        const map = new Map<string, AnalysisResult>();
                        prev.forEach(s => map.set(s.symbol, s));
                        nonSideways.forEach(s => map.set(s.symbol, s));
                        const combined = Array.from(map.values()).slice(-100);
                        localStorage.setItem(cxnSigKey, JSON.stringify(combined));
                        return combined;
                      });
                    }
                    // Same end-of-scan notification as the developer account:
                    // completion tone, then a "new opportunity" alert + success tone
                    // only when a strong signal (strong_buy/strong_sell) was found.
                    const strong = filtered.filter(r => r.signal === 'strong_buy' || r.signal === 'strong_sell');
                    const regular = filtered.filter(r => r.signal === 'buy' || r.signal === 'sell');
                    if (strong.length > 0) {
                      const alerted = strong.map(r => r.symbol).join(' · ');
                      setNewSignalAlert(lang === 'ar' ? `✅ تنبيه فرصة قوية جديدة — ${alerted}` : `✅ New strong trading opportunity detected! — ${alerted}`);
                      setTimeout(() => setNewSignalAlert(null), 8000);
                      try { playAudio('success'); } catch {}
                      setTimeout(() => {
                        try { playAudio('completion'); } catch {}
                      }, 1200);
                    } else if (regular.length > 0) {
                      const alerted = regular.slice(0, 3).map(r => r.symbol).join(' · ');
                      setNewSignalAlert(lang === 'ar' ? `✅ تنبيه فرصة تداول جديدة — ${alerted}` : `✅ New trading opportunity detected! — ${alerted}`);
                      setTimeout(() => setNewSignalAlert(null), 8000);
                      try { playAudio('success'); } catch {}
                      setTimeout(() => {
                        try { playAudio('completion'); } catch {}
                      }, 1200);
                    } else {
                      try { playAudio('completion'); } catch {}
                    }
                  }}
                  onError={(errMsg, allFailed) => { setAnalysisResults(null); setAnalysisError(errMsg || null); setIsAnalyzing(false); setProgress(null); try { playAudio('fail'); } catch {} }}
                />
                <ConnectionStatus lang={lang} />
              </div>
            )}

            {effectivePage === 'manualResults' && (
              <div className="max-w-4xl mx-auto px-4 py-8">
                {isAnalyzing ? (
                  <div className="flex flex-col items-center justify-center p-8 space-y-8 min-h-[50vh]">
                    <div className="relative w-24 h-24">
                      <div className="absolute inset-0 border-b-2 border-primary rounded-full animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center text-primary">
                        <TrendingUp size={32} />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <h2 className="text-2xl font-bold text-brand-text">{t.analyzing}</h2>
                      {progress && (
                        <div className="text-primary font-black animate-pulse">
                          {progress.current} ({progress.index + 1}/{progress.total})
                        </div>
                      )}
                    </div>
                  </div>
                ) : analysisResults ? (
                  <>
                    <h2 className="text-2xl font-black text-brand-text mb-2 text-center">
                      {lang === 'ar' ? 'نتائج التحليل اليدوي' : 'Manual Analysis Results'}
                    </h2>
                    {!analysisResults.some(r => r.signal === 'strong_buy' || r.signal === 'strong_sell') && (
                      <div className="bg-brand-alt border border-red-500/20 py-2 px-4 mb-6 text-center rounded-xl">
                        <span className="text-red-500 text-[10px] font-black uppercase tracking-widest">
                          {lang === 'ar' ? 'لا توجد إشارات قوية حالياً' : 'No strong signals currently'}
                        </span>
                      </div>
                    )}
                    {analysisError && (
                      <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <p className="text-amber-400 text-sm font-medium">{analysisError}</p>
                      </div>
                    )}
                    <AnalysisResultView
                      results={analysisResults}
                      lang={lang}
                      settings={settings}
                      onDetail={(r) => { setAnalysisResults(null); setDetailResult(r); }}
                      onTrade={(sym) => { try { sessionStorage.setItem('joseph_session_ui', JSON.stringify({ symbol: sym })); } catch {} navigateTo('trade'); }}
                      onRemove={removeAnalysisResult}
                      onClearAll={handleClearAnalysisResults}
                    />
                  </>
                ) : null}
              </div>
            )}
          </motion.div>
        )}

        {/* Subscription Banner - developer main page */}
        {!analysisResults && !isAnalyzing && effectivePage === 'main' && !!needsApiKey && isDeveloperSession() && activeSubscription && (() => {
          const daysLeft = Math.ceil((new Date(activeSubscription.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return (
            <div className="max-w-4xl mx-auto px-4 mt-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-sm font-bold text-emerald-400">{activeSubscription.label} Plan Active</span>
                  <span className="text-xs text-slate-500 mr-3">{daysLeft} days remaining</span>
                </div>
                <button
                  onClick={() => { localStorage.removeItem('active_subscription'); setActiveSubscription(null); }}
                  className="text-[10px] text-red-400 hover:text-red-300 underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        {/* Top Signals - developer main page - always visible */}
        {effectivePage === 'main' && isDeveloperSession() && !isAnalyzing && (
          <div className="max-w-7xl mx-auto px-4">
            <TopSignals 
              signals={topSignals} onRemove={removeSignal} 
              onSelect={handleSelectSignal} onDetail={setDetailResult} onClearAll={handleClearAll}
              lang={lang} 
              onTrade={(sym) => { try { sessionStorage.setItem('joseph_session_ui', JSON.stringify({ symbol: sym })); } catch {} navigateTo('trade'); }}
            />
            <div className="w-full bg-[#D1FAE5]/40 backdrop-blur-xl rounded-full h-3 border border-[#D1FAE5]/60 shadow-[0_0_25px_rgba(209,250,229,0.3)]" />
          </div>
        )}

        {/* Ads for all users */}
        <AdSlot position="inline" lang={lang} />
        <AdSlot position="between" lang={lang} />
        <AdSlot position="popup" lang={lang} />

        {/* CLIENT DASHBOARD - shows for non-developers on main page */}
        {!isDeveloperSession() && !analysisResults && !isAnalyzing && effectivePage === 'main' && (
          <div className="max-w-7xl mx-auto px-4">
            <AdSlot position="header" lang={lang} />
            <ClientDashboard
              results={clientSignals}
              lang={lang}
              hasActivePlan={hasActivePlan}
              onDetail={setClientDetailResult}
              showPlanActions={showPlanControls}
              freeModeChosen={freeModeChosen}
              onActivatePaidPlan={activatePaidPlan}
              autoAnalysisOn={autoSettings.isEnabled}
              onOpenMyPlan={openMyPlan}
              onNavigateManual={() => navigateTo('manualAnalysis')}
              onNavigateRadar={() => navigateTo('radar')}
              onToggleAutoAnalysis={() => { initAudio(); setAutoSettings({ ...autoSettings, isEnabled: !autoSettings.isEnabled }); }}
              onTrade={(sym) => { try { sessionStorage.setItem('joseph_session_ui', JSON.stringify({ symbol: sym })); } catch {} navigateTo('trade'); }}
              onRemove={removeClientSignal}
              onClearAll={handleClearClientSignals}
            />
          </div>
        )}

        {/* Loading view - separate, no overlap with form. On the dedicated
            manualResults page the same progress UI is rendered inline instead. */}
        {isAnalyzing && effectivePage !== 'manualResults' && (
          <div className="flex flex-col items-center justify-center p-8 space-y-8 min-h-[60vh]">
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 border-b-2 border-primary rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-primary">
                <TrendingUp size={32} />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-brand-text">{t.analyzing}</h2>
              {progress && (
                <div className="text-primary font-black animate-pulse">
                  {progress.current} ({progress.index + 1}/{progress.total})
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results - main page (developer / auto-analysis results). Manual analysis
            results render on their own dedicated `manualResults` page instead. */}
        {analysisResults && !isAnalyzing && effectivePage === 'main' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {analysisError && (
              <div className="max-w-4xl mx-auto mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-amber-400 text-sm font-medium">{analysisError}</p>
                <button onClick={() => { setAnalysisResults(null); setAnalysisError(null); }} className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline">
                  {lang === 'ar' ? '\u062a\u0639\u064a\u062f \u0644\u0644\u0645\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649' : 'Try again'}
                </button>
              </div>
            )}
            <AnalysisResultView results={analysisResults} lang={lang} settings={settings} onDetail={setDetailResult} onTrade={(sym) => { try { sessionStorage.setItem('joseph_session_ui', JSON.stringify({ symbol: sym })); } catch {} navigateTo('trade'); }} />
          </motion.div>
        )}

        {/* Floating back button - always visible on all pages */}
        {(effectivePage !== 'main' || detailResult || analysisResults) && (
          <button
            onClick={() => { if (detailResult) { setDetailResult(null); } else if (analysisResults) { setAnalysisResults(null); setAnalysisError(null); } goBack(); }}
            className="fixed bottom-6 right-6 z-[90] flex items-center gap-3 bg-[#F59E0B] hover:bg-[#d97706] transition-all rounded-2xl px-5 py-4 shadow-2xl shadow-[#F59E0B]/30 active:scale-95 group"
          >
            <ArrowLeft size={22} className="text-black group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm font-black text-black">{lang === 'ar' ? '\u0639\u0648\u062f\u0629 \u0644\u0644\u062e\u0644\u0641' : 'Go back'}</span>
          </button>
        )}
      </main>

      {/* Footer ads with green bar - from Ads Manager */}
      <AdSlot position="footer" lang={lang} />

      <footer className="py-8 border-t border-white/5 bg-brand-alt/30">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-[10px] font-black uppercase tracking-widest">
          <p>┬⌐ {new Date().getFullYear()} Joseph.Trading. {t.allRightsReserved}.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-primary transition-colors">{t.privacyPolicy}</a>
            <a href="#" className="hover:text-primary transition-colors">{t.termsOfUse}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}




