import React, { useState, useEffect, useCallback } from 'react';
import { MobileBottomNav, MobileTab } from './MobileBottomNav';
import { MobileHeader } from './MobileHeader';
import { MobileHome, MobileSignal } from './MobileHome';
import { MobileQuotes, MobileQuote } from './MobileQuotes';
import { MobilePositions, MobilePosition } from './MobilePositions';
import { MobileNewTrade } from './MobileNewTrade';
import { MobileSettings } from './MobileSettings';
import { MobileTradeDialog } from './MobileTradeDialog';
import { Language } from '../../lib/i18n';

const TITLES: Record<MobileTab, string> = {
  home: 'Joseph.Trading', quotes: 'Market Watch', positions: 'Trade',
  trade: 'New Order', settings: 'Settings',
};

const QUOTES: MobileQuote[] = [
  { symbol: 'BTCUSD', category: 'Crypto', bid: 97240.5, ask: 97245.2, change: 1250.3, changePercent: 1.89 },
  { symbol: 'ETHUSD', category: 'Crypto', bid: 3450.2, ask: 3451.4, change: -45.2, changePercent: -1.29 },
  { symbol: 'XAUUSD', category: 'Metals', bid: 2650.15, ask: 2650.45, change: 8.75, changePercent: 0.33 },
  { symbol: 'EURUSD', category: 'Forex', bid: 1.0852, ask: 1.0854, change: -0.0012, changePercent: -0.11 },
  { symbol: 'GBPUSD', category: 'Forex', bid: 1.2654, ask: 1.2657, change: 0.0023, changePercent: 0.18 },
  { symbol: 'USDJPY', category: 'Forex', bid: 149.85, ask: 149.88, change: -0.12, changePercent: -0.08 },
  { symbol: 'US30', category: 'Indices', bid: 44210, ask: 44215, change: 120, changePercent: 0.27 },
  { symbol: 'NAS100', category: 'Indices', bid: 19250, ask: 19255, change: -45, changePercent: -0.23 },
];

export function MobileLayout({ children }: { children?: React.ReactNode }) {
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
  const [positions, setPositions] = useState<MobilePosition[]>([]);
  const [balance, setBalance] = useState(10000);
  const [equity, setEquity] = useState(10000);
  const [selSym, setSelSym] = useState<string | null>(null);

  const loadAll = useCallback(() => {
    try {
      const raw = localStorage.getItem('top_signals_persistent');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setSignals(arr.filter((s: any) => s && s.signal !== 'neutral' && s.signal !== 'no_entry' && !s.isSideways).slice(0, 30).map((s: any) => ({
            symbol: String(s.symbol || ''),
            type: (String(s.signal || '').includes('sell') ? 'sell' : 'buy') as 'buy' | 'sell',
            price: Number(s.entryPrice ?? s.price ?? 0),
            change: Number(s.change ?? 0),
            changePercent: Number(s.changePercent ?? 0),
          })).filter((s) => s.symbol));
        }
      }
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
    const q = QUOTES.find((x) => x.symbol === s);
    if (q) setDialog(q); else { setSelSym(s); setTab('trade'); }
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
        onNotificationsClick={() => setTab('home')} onProfileClick={() => setTab('settings')} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'home' && <MobileHome signals={signals} balance={balance} equity={equity} openCount={positions.length} autoTradeEnabled={auto} onSignalClick={pickSymbol} onAutoTradeToggle={(v) => { setAuto(v); try { localStorage.setItem('paper_trading_auto_trade', v ? '1' : '0'); } catch {} }} />}
        {tab === 'quotes' && <MobileQuotes quotes={QUOTES} onSelect={pickSymbol} />}
        {tab === 'positions' && <MobilePositions positions={positions} onClose={(id) => { try { window.dispatchEvent(new CustomEvent('mobile-close-trade', { detail: { id } })); } catch {} setPositions((p) => p.filter((x) => x.id !== id)); }} />}
        {tab === 'trade' && <MobileNewTrade quotes={QUOTES} defaultSymbol={selSym} onOpen={openTrade} />}
        {tab === 'settings' && <MobileSettings autoTradeEnabled={auto} soundEnabled={sound} language={lang} onAutoTradeToggle={(v) => { setAuto(v); try { localStorage.setItem('paper_trading_auto_trade', v ? '1' : '0'); } catch {} }} onSoundToggle={setSound} onLanguageChange={setLang} onClearCache={() => { setAlert('Cache cleared'); setTimeout(() => setAlert(null), 3000); }} version="3.1.0" />}
        {children}
      </div>
      <MobileBottomNav activeTab={tab} onTabChange={setTab} />
      {dialog && <MobileTradeDialog symbol={dialog.symbol} bid={dialog.bid} ask={dialog.ask} onOpen={(t, v) => openTrade(dialog.symbol, t, v)} onClose={() => setDialog(null)} />}
      {alert && <div className="mt5-signal-alert">{alert}</div>}
    </div>
  );
}