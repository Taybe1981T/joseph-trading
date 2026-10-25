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
import { isDeveloperEmail, DEVELOPER_EMAILS } from '../../lib/clientIds';
import { useMobileMode, mobileT } from '../../lib/mobileMode';
import { MobileAnalysis } from './MobileAnalysis';
import { MobileManualSheet } from './MobileManualSheet';
import { MobileStore } from './MobileStore';
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
import { auth } from '../../lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';

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
  const [alert, setAlert] = useState<string | null>(null);
  const [auto, setAuto] = useState(() => isMobileAutoTradeOn());
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
  const [isDev, setIsDev] = useState(false);
  const [email, setEmail] = useState('');
  const [clientCount, setClientCount] = useState(0);
  const [savedAccounts, setSavedAccounts] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('finalyze_saved_accounts') || '[]'); } catch { return []; }
  });
  const [customAvatar, setCustomAvatar] = useState(() => localStorage.getItem('finalyze_custom_avatar') || null);
  const [customLogo, setCustomLogo] = useState(() => localStorage.getItem('finalyze_custom_logo') || null);
  const [following, setFollowing] = useState(() => localStorage.getItem('finalyze_following') === 'true');

  const toggleFollowing = () => {
    const next = !following;
    setFollowing(next);
    try { localStorage.setItem('finalyze_following', String(next)); } catch {}
  };

  // Firebase auth state
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        const raw = localStorage.getItem('finalyze_user');
        const em = raw ? String(JSON.parse(raw)?.email || '').toLowerCase().trim() : '';
        setEmail(em);
        const devEmail = (localStorage.getItem('finalyze_dev_email') || DEVELOPER_EMAILS[0] || '').toLowerCase();
        setIsDev(!!em && (em === devEmail || isDeveloperEmail(em) || em.includes('dev')));
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
        try {
          localStorage.setItem('finalyze_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
          localStorage.setItem('finalyze_auth_user', JSON.stringify({ email: u.email.toLowerCase().trim(), uid: u.uid }));
        } catch {}
      }
      setLoadingAuth(false);
    });
    const t = setTimeout(() => setLoadingAuth(false), 3000);
    return () => { unsub(); clearTimeout(t); };
  }, []);

  // Login / logout helpers
  const doLogin = async (emailHint?: string) => {
    setLoadingAuth(true);
    try {
      const provider = new GoogleAuthProvider();
      if (emailHint) {
        provider.setCustomParameters({ login_hint: emailHint });
      }
      const result = await signInWithPopup(auth, provider);
      if (result?.user?.email) {
        const em = result.user.email.toLowerCase().trim();
        setSavedAccounts(prev => {
          if (prev.includes(em)) return prev;
          const next = [...prev, em];
          try { localStorage.setItem('finalyze_saved_accounts', JSON.stringify(next)); } catch {}
          return next;
        });
      }
    } catch (e) {
      console.error(e);
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
    } catch {}
    setUser(null);
    setEmail('');
    setIsDev(false);
    try { window.location.reload(); } catch {}
  };

  const onProfileImageChange = (url: string) => {
    setCustomAvatar(url);
    try { localStorage.setItem('finalyze_custom_avatar', url); } catch {}
  };

  const onLogoChange = (url: string) => {
    setCustomLogo(url);
    try { localStorage.setItem('finalyze_custom_logo', url); } catch {}
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
      // Auto radar signals (same as desktop AnalysisResults)
      try {
        const raw = localStorage.getItem('top_signals_persistent');
        const auto = raw ? JSON.parse(raw) : [];
        if (Array.isArray(auto)) {
          merged.push(...auto.filter((s: any) => s && s.signal !== 'neutral' && s.signal !== 'no_entry' && !s.isSideways).map((s: any) => ({ ...s, source: s.source || 'auto' })));
        }
      } catch {}
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
  }, []);

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
    const iv = setInterval(loadAll, 5000);
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
        onProfileClick={() => goTab('profile')} />
      {tab !== 'home' && (
        <button
          type="button"
          onClick={goBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#F59E0B', fontSize: 13, fontWeight: 800, cursor: 'pointer', padding: '8px 16px 0', alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={15} /> {lang === 'ar' ? 'عودة' : 'Back'}
        </button>
      )}
      <div style={{ flex: 1, overflowY: 'auto', overflowAnchor: 'none' }}>
        {tab === 'home' && <MobileHome fullSignals={fullSignals} lang={lang} onDetail={setDetail} onTrade={(s) => { setSelSym(s); goTab('trade'); }} onRemove={removeSignal} autoTradeEnabled={auto} onAutoTradeToggle={setAutoBoth} radarOn={freshCount > 0} radarLabel={freshCount > 0 ? (lang === 'ar' ? `${freshCount} إشارة جديدة` : `${freshCount} new signals`) : null} />}
        {tab === 'quotes' && isDev && <MobileQuotes quotes={quotes} onSelect={pickSymbol} />}
        {tab === 'positions' && <MobilePositions positions={positions} closed={closedTrades} onClose={closeTradeById} onSelect={(sym) => { setSelSym(sym); goTab('trade'); }} />}
        {tab === 'trade' && <MobileNewTrade quotes={quotes} defaultSymbol={selSym} lang={lang} balance={balance} signalFor={signalFor} onOpen={openTrade} />}
        {/* Desktop parity: dev-only sections never render for clients. */}
        {tab === 'analysis' && isDev && <MobileAnalysis lang={lang} />}
        {tab === 'manual' && isDev && <MobileManualSheet lang={lang} onClose={goHome} onDone={runManual} />}
        {tab === 'transactions' && <TransactionsPage lang={lang} onBack={goHome} autoEmail={email} isDeveloper={isDev} />}
        {tab === 'store' && isDev && <MobileStore lang={lang} onClose={goHome} />}
        {tab === 'settings' && <MobileSettings autoTradeEnabled={auto} soundEnabled={sound} language={lang} onAutoTradeToggle={setAutoBoth} onSoundToggle={setSound} onLanguageChange={setLang} onClearCache={() => { setAlert('Cache cleared'); setTimeout(() => setAlert(null), 3000); }} version="3.1.0" savedAccounts={savedAccounts} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} />}
        {tab === 'profile' && <MobileProfile language={lang} userEmail={user?.email || email || null} avatarUrl={customAvatar || user?.photoURL || null} isLoggedIn={!!(user?.email || email)} onLoginClick={() => setShowLoginModal(true)} onLogoutClick={() => doLogout()} onProfileImageChange={onProfileImageChange} onLogoChange={onLogoChange} isFollowing={following} onFollowToggle={toggleFollowing} />}
        {tab === 'clients' && isDev && <MobileClientMonitor lang={lang} onClose={goHome} />}
        {children}
      </div>
      <MobileBottomNav activeTab={tab} onTabChange={goTab} isDeveloper={isDev} lang={lang} />
      {dialog && <MobileTradeDialog symbol={dialog.symbol} bid={dialog.bid} ask={dialog.ask} onOpen={(t, v) => openTrade(dialog.symbol, t, v)} onClose={() => setDialog(null)} />}
      {detail && <MobileSignalDetail res={detail} lang={lang} onClose={() => setDetail(null)} />}
      {showLoginModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, color: '#fff' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>{lang === 'ar' ? 'تسجيل الدخول' : 'Login'}</h3>
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
            <button onClick={() => { doLogin(); setShowLoginModal(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px', background: '#4285F4', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', justifyContent: 'center' }}>
              <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" width="18" height="18" alt="Google" />
              {lang === 'ar' ? 'تسجيل الدخول بحساب Google' : 'Sign in with Google'}
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
