import React, { useState, useEffect, useCallback } from 'react';
import { MobileBottomNav, MobileTab } from './MobileBottomNav';
import { MobileHeader } from './MobileHeader';
import { MobileHome } from './MobileHome';
import { MobileQuotes, MobileQuote } from './MobileQuotes';
import { useLiveQuotes } from './useLiveQuotes';
import { MobilePositions, MobilePosition } from './MobilePositions';
import { MobileNewTrade } from './MobileNewTrade';
import { MobileSettings } from './MobileSettings';
import { MobileTradeDialog } from './MobileTradeDialog';
import { MobileSignalDetail } from './MobileSignalDetail';
import { Language } from '../../lib/i18n';
import { isDeveloperEmail, DEVELOPER_EMAILS } from '../../lib/clientIds';
import { useMobileMode, mobileT } from '../../lib/mobileMode';
import { MobileAnalysis } from './MobileAnalysis';
import { MobileManualSheet } from './MobileManualSheet';
import { MobileStore } from './MobileStore';
import { MobileClientMonitor } from './MobileClientMonitor';
import { MobileBulkPublish } from './MobileBulkPublish';
import TransactionsPage from '../TransactionsPage';
import { useMobileSignalAlert } from './useMobileSignalAlert';
import { AnalysisResult, SignalType } from '../../types';

interface MobileSignal {
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  change: number;
  changePercent: number;
}

const TITLES: Record<MobileTab, string> = {
  home: 'Joseph.Trading', quotes: 'Market Watch', positions: 'Open Positions', trade: 'Trading Platform',
  settings: 'Settings', analysis: 'Auto Analysis', manual: 'Manual Analysis', store: 'Store', clients: 'Clients', transactions: 'My Transactions',
};

export function MobileLayout({ children }: { children?: React.ReactNode }) {
  const quotes = useLiveQuotes();
  const [tab, setTab] = useState<MobileTab>('home');
  const [dialog, setDialog] = useState<MobileQuote | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('paper_trading_auto_trade') !== '0'; } catch { return true; } });
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
  const [balance, setBalance] = useState(10000);
  const [equity, setEquity] = useState(10000);
  const [selSym, setSelSym] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [isDev, setIsDev] = useState(false);
  const [email, setEmail] = useState('');
  const [clientCount, setClientCount] = useState(0);

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
  const loadAll = useCallback(() => {
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
      setFullSignals(full.slice(0, 40));
      setSignals(full.map((s: any) => ({
        symbol: String(s.symbol || ''),
        type: (String(s.signal || '').includes('sell') ? 'sell' : 'buy') as 'buy' | 'sell',
        price: Number(s.entryPrice ?? s.price ?? 0),
        change: Number(s.change ?? 0),
        changePercent: Number(s.changePercent ?? 0),
      })).filter((s) => s.symbol));
    } catch {}
    try {
      const raw = localStorage.getItem('paper_trading_data');
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.balance === 'number') setBalance(d.balance);
        if (typeof d.equity === 'number') setEquity(d.equity);
        if (Array.isArray(d.trades)) {
          setPositions(d.trades.filter((t: any) => t.status === 'open').map((t: any) => {
            const cur = Number(t.currentPrice ?? t.openPrice ?? 0);
            const op = Number(t.openPrice ?? 0);
            const dir = t.side === 'sell' ? -1 : 1;
            return {
              id: String(t.id ?? t.symbol + op), symbol: String(t.symbol),
              type: (t.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
              volume: Number(t.volume || 0.01), openPrice: op, currentPrice: cur,
              profit: (cur - op) * dir * Number(t.volume || 0.01) * 100,
            };
          }));
        }
      }
    } catch {}
  }, []);

  useEffect(() => { loadAll(); const iv = setInterval(loadAll, 5000); return () => clearInterval(iv); }, [loadAll]);

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
    try { window.dispatchEvent(new CustomEvent('mobile-open-trade', { detail: { symbol: sym, side: type, volume: vol } })); } catch {}
    ping(type === 'buy' ? 880 : 440);
    setAlert('Order sent: ' + type.toUpperCase() + ' ' + vol.toFixed(2) + ' ' + sym);
    setTimeout(() => setAlert(null), 4000);
    if (tab === 'trade') setTab('positions');
  };

  const pickSymbol = (s: string) => {
    const q = quotes.find((x) => x.symbol === s);
    if (q) setDialog(q); else { setSelSym(s); setTab('trade'); }
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
    setTab('home');
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
        onClientsClick={() => setTab('clients')}
        onNotificationsClick={() => setTab('home')} onProfileClick={() => setTab('settings')} />
      <div style={{ flex: 1, overflowY: 'auto', overflowAnchor: 'none' }}>
        {tab === 'home' && <MobileHome fullSignals={fullSignals} lang={lang} onDetail={setDetail} onTrade={(s) => { setSelSym(s); setTab('trade'); }} onRemove={removeSignal} autoTradeEnabled={auto} onAutoTradeToggle={(v) => { setAuto(v); try { localStorage.setItem('paper_trading_auto_trade', v ? '1' : '0'); } catch {} }} radarOn={freshCount > 0} radarLabel={freshCount > 0 ? (lang === 'ar' ? `${freshCount} إشارة جديدة` : `${freshCount} new signals`) : null} />}
        {tab === 'quotes' && <MobileQuotes quotes={quotes} onSelect={pickSymbol} />}
        {tab === 'positions' && <MobilePositions positions={positions} onClose={(id) => { try { window.dispatchEvent(new CustomEvent('mobile-close-trade', { detail: { id } })); } catch {} setPositions((p) => p.filter((x) => x.id !== id)); }} onSelect={(sym) => { setSelSym(sym); setTab('trade'); }} />}
        {tab === 'trade' && <MobileNewTrade quotes={quotes} defaultSymbol={selSym} lang={lang} balance={balance} signalFor={signalFor} onOpen={openTrade} />}
        {tab === 'analysis' && isDev && <MobileAnalysis lang={lang} onPublish={() => setShowPublish(true)} />}
        {tab === 'manual' && isDev && <MobileManualSheet lang={lang} onClose={() => setTab('home')} onDone={runManual} />}
        {tab === 'transactions' && <TransactionsPage lang={lang} onBack={() => setTab('home')} autoEmail={email} isDeveloper={isDev} />}
        {tab === 'store' && isDev && <MobileStore lang={lang} onClose={() => setTab('home')} />}
        {tab === 'settings' && <MobileSettings autoTradeEnabled={auto} soundEnabled={sound} language={lang} onAutoTradeToggle={(v) => { setAuto(v); try { localStorage.setItem('paper_trading_auto_trade', v ? '1' : '0'); } catch {} }} onSoundToggle={setSound} onLanguageChange={setLang} onClearCache={() => { setAlert('Cache cleared'); setTimeout(() => setAlert(null), 3000); }} version="3.1.0" />}
        {tab === 'clients' && isDev && <MobileClientMonitor lang={lang} onClose={() => setTab('home')} />}
        {showPublish && isDev && <MobileBulkPublish lang={lang} onClose={() => setShowPublish(false)} />}
        {children}
      </div>
      <MobileBottomNav activeTab={tab} onTabChange={setTab} isDeveloper={isDev} lang={lang} />
      {dialog && <MobileTradeDialog symbol={dialog.symbol} bid={dialog.bid} ask={dialog.ask} onOpen={(t, v) => openTrade(dialog.symbol, t, v)} onClose={() => setDialog(null)} />}
      {detail && <MobileSignalDetail res={detail} lang={lang} onClose={() => setDetail(null)} />}
      {alert && <div className="mt5-signal-alert">{alert}</div>}
    </div>
  );
}
