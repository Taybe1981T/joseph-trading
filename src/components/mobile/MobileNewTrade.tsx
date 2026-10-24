import React, { useState, useMemo, useEffect } from 'react';
import { Zap, BarChart2, RefreshCw, RotateCcw } from 'lucide-react';
import type { MobileQuote } from './MobileQuotes';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { MobileLotCalc } from './MobileLotCalc';
import { getMobileSymbolGroups } from '../../services/mobileAnalysisEngine';
import {
  isMobileAutoTradeOn,
  setMobileAutoTrade,
  openMobileManualTrade,
  detectMobileTradeCategory,
  mobileLivePrice,
  mobileTradeUser,
} from '../../services/mobileTradeBridge';
import { getTradeStore, calcPnl, START_BALANCE, getLivePrices } from '../../services/paperTradingService';
import { notionalInUSD, usdToPrice } from '../../lib/positionMath';
import { calcTrailingStop } from '../../lib/trailingStop';
import type { PaperTrade } from '../../services/paperTradingService';
import { baseQtyPerCategory } from '../../services/paperTradingService';
import TradingViewEmbed from '../TradingViewEmbed';

interface MobileNewTradeProps {
  quotes: MobileQuote[];
  defaultSymbol: string | null;
  lang: Language;
  balance: number;
  signalFor?: (sym: string) => AnalysisResult | undefined;
  onOpen: (sym: string, type: 'buy' | 'sell', volume: number) => void;
}

export function MobileNewTrade({ quotes, defaultSymbol, lang, balance, signalFor, onOpen }: MobileNewTradeProps) {
  const isAr = lang === 'ar';
  // Same categories/symbols as the Manual Analysis section (unified source, incl. future adds).
  const groups = useMemo(() => getMobileSymbolGroups(), []);
  const [category, setCategory] = useState<string>(() => {
    const g = defaultSymbol ? groups.find((x) => x.symbols.includes((defaultSymbol || '').toUpperCase())) : null;
    return g ? g.id : (groups[0]?.id || 'forex');
  });
  const [symbol, setSymbol] = useState(defaultSymbol || (groups[0]?.symbols[0] || quotes[0]?.symbol || ''));
  const [volume, setVolume] = useState(0.01);
  const [busy, setBusy] = useState(false);
  const [autoTrade, setAutoTrade] = useState<boolean>(() => isMobileAutoTradeOn());

  // Keep the selected symbol inside the chosen category (desktop parity: category → symbols).
  const catSymbols = useMemo(() => {
    const g = groups.find((x) => x.id === category);
    return g ? g.symbols : [];
  }, [groups, category]);
  useEffect(() => {
    if (catSymbols.length && !catSymbols.includes(symbol)) setSymbol(catSymbols[0]);
  }, [category, catSymbols]);

  // Keep the category pill in sync when arriving from a signal/position.
  useEffect(() => {
    if (!defaultSymbol) return;
    const g = groups.find((x) => x.symbols.includes(defaultSymbol.toUpperCase()));
    if (g && g.id !== category) setCategory(g.id);
    setSymbol(defaultSymbol.toUpperCase());
  }, [defaultSymbol]);

  const symbolUniverse = useMemo(() => {
    const set = new Set<string>();
    const flat = groups.map((g) => { g.symbols.forEach((s) => set.add(s)); return g; });
    const extra = quotes.map((q) => q.symbol).filter((s) => s && !set.has(s));
    if (extra.length) flat.push({ id: 'live', label: isAr ? 'أسعار حية' : 'Live', symbols: [...new Set(extra)] });
    if (symbol && !set.has(symbol)) flat.push({ id: 'current', label: isAr ? 'الحالي' : 'Current', symbols: [symbol] });
    return flat;
  }, [groups, quotes, symbol, isAr]);

  const current = quotes.find((q) => q.symbol === symbol);
  const sig = useMemo(() => (signalFor ? signalFor(symbol) : undefined), [signalFor, symbol]);

  // Open trade on this symbol (if any) → show its entry/SL/TP on the chart.
  const [openForSymbol, setOpenForSymbol] = useState<PaperTrade | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const store = getTradeStore(mobileTradeUser() as any);
        const all = await store.listTrades();
        const t = all.find((x) => x.status === 'open' && x.symbol === symbol) || null;
        if (alive) setOpenForSymbol(t as PaperTrade | null);
      } catch { if (alive) setOpenForSymbol(null); }
    })();
    const h = () => {
      (async () => {
        try {
          const store = getTradeStore(mobileTradeUser() as any);
          const all = await store.listTrades();
          const t = all.find((x) => x.status === 'open' && x.symbol === symbol) || null;
          if (alive) setOpenForSymbol(t as PaperTrade | null);
        } catch {}
      })();
    };
    try { window.addEventListener('mobile-trades-changed', h); } catch {}
    return () => { alive = false; try { window.removeEventListener('mobile-trades-changed', h); } catch {} };
  }, [symbol]);

  const chartSl = openForSymbol?.sl ?? sig?.stopLoss ?? null;
  const chartTp = openForSymbol?.tp ?? sig?.takeProfit ?? null;
  const chartEntry = openForSymbol?.entryPrice ?? sig?.entryPrice ?? null;
  const chartSide = openForSymbol?.side ?? null;
  // Live price for the chart's last-price line — needed below for trailing calc.
  const chartLivePrice = current?.bid ?? null;
  // Trailing-stop price drawn on the chart (USD-based, per-position settings).
  const chartCategory = openForSymbol?.category || detectMobileTradeCategory(symbol);
  let chartTrailingPrice: number | null = null;
  if (openForSymbol && openForSymbol.qty > 0 && openForSymbol.entryPrice > 0) {
    const live = chartLivePrice ?? openForSymbol.entryPrice;
    const pnl = calcPnl(openForSymbol, live);
    const tr = calcTrailingStop({
      qty: openForSymbol.qty,
      openPnlUSD: pnl,
      baseUnit: baseQtyPerCategory(chartCategory),
      baseActivationUSD: (openForSymbol as any).trailingActivationUSD ?? 5,
      baseStepUSD: (openForSymbol as any).trailingStepUSD ?? 2,
      activationLotStep: 2,
      stepLotStep: 1,
    });
    if (tr.active) {
      const isBuy = openForSymbol.side === 'buy';
      chartTrailingPrice = usdToPrice(symbol, tr.offsetUSD, openForSymbol.entryPrice, isBuy, openForSymbol.qty, chartCategory);
    }
  }

  // (chartLivePrice is computed above, before the trailing calculation.)

  // ── Account header: balance + equity + margin + margin level + floating P&L
  //    (desktop parity: TradeNowPage header — same live math, refresh + reset)
  const [acct, setAcct] = useState({ balance, equity: balance, margin: 0, free: balance, level: 0, floating: 0, leverage: 100 });
  const [acctBusy, setAcctBusy] = useState(false);
  const refreshAccount = async () => {
    setAcctBusy(true);
    try {
      const store = getTradeStore(mobileTradeUser() as any);
      const [a, all] = await Promise.all([store.getAccount(), store.listTrades().catch(() => [] as any[])]);
      const open = (all as any[]).filter((t) => t.status === 'open');
      // Fetch each open symbol's price ONCE in a single batched request
      // and reuse it for both the floating P&L and the margin calculation.
      const prices = new Map<string, number>();
      try {
        const syms = [...new Set(open.map((t: any) => t.symbol))];
        const fetched = await getLivePrices(syms);
        for (const [s, p] of fetched) if (p > 0) prices.set(s, p);
      } catch {
        // Fallback: per-symbol fetch (cached + deduplicated).
        await Promise.all(open.map(async (t: any) => {
          try {
            const p = await mobileLivePrice(t.symbol);
            if (p != null && p > 0) prices.set(t.symbol, p);
          } catch {}
        }));
      }
      let floating = 0;
      for (const t of open) {
        try {
          const cur = prices.get(t.symbol) ?? t.entryPrice;
          floating += calcPnl(t as any, cur);
        } catch {}
      }
      // Used margin = Σ notional / leverage (same formula as TradeNowPage).
      const lev = (a as any).leverage || 100;
      let margin = 0;
      for (const t of open) {
        try {
          const px = prices.get(t.symbol) ?? t.entryPrice;
          margin += notionalInUSD(t.category || detectMobileTradeCategory(t.symbol), t.symbol, px, t.qty) / lev;
        } catch {}
      }
      const bal = (a as any).balance ?? balance;
      const equity = bal + floating;
      const free = equity - margin;
      const level = margin > 0 ? (equity / margin) * 100 : 0;
      setAcct({ balance: bal, equity, margin, free, level, floating, leverage: lev });
    } catch {} finally { setAcctBusy(false); }
  };
  useEffect(() => { refreshAccount(); }, [balance]);
  useEffect(() => {
    refreshAccount();
    const iv = setInterval(refreshAccount, 15000);
    const onCh = () => refreshAccount();
    try {
      window.addEventListener('mobile-trades-changed', onCh);
      window.addEventListener('mobile-close-trade', onCh as any);
    } catch {}
    return () => {
      clearInterval(iv);
      try {
        window.removeEventListener('mobile-trades-changed', onCh);
        window.removeEventListener('mobile-close-trade', onCh as any);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resetBalance = async () => {
    if (!confirm(isAr ? 'إعادة تعيين الرصيد إلى $10,000 وحذف كل الصفقات؟' : 'Reset balance to $10,000 and clear all trades?')) return;
    try {
      const store = getTradeStore(mobileTradeUser() as any);
      await store.resetAccount(START_BALANCE);
      try { window.dispatchEvent(new CustomEvent('mobile-trades-changed', { detail: { action: 'reset' } })); } catch {}
      await refreshAccount();
    } catch {}
  };

  const toggleAuto = () => {
    const v = !autoTrade;
    setAutoTrade(v);
    setMobileAutoTrade(v);
  };

  const openSide = async (side: 'buy' | 'sell') => {
    if (!symbol || busy) return;
    setBusy(true);
    try {
      // Desktop parity: same store + live-price math, then the shared engine/layout refresh.
      await openMobileManualTrade(symbol, side, volume, sig || null);
    } catch {
      // fall through — layout alert reports the result below
    } finally {
      setBusy(false);
      onOpen(symbol, side, volume);
    }
  };
  return (
    <div className="mt5-page-container">
      {/* ── Account summary header (desktop parity: balance/equity/margin/level/floating) ── */}
      <div className="mt5-card" style={{ background: 'linear-gradient(135deg,#0d1f16,#0a0a0a)', borderColor: 'rgba(0,255,136,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>
            {isAr ? 'ملخص الحساب' : 'Account Summary'}
            <span style={{ marginRight: 6, fontSize: 11, color: '#666', fontWeight: 600 }}> 1:{acct.leverage}</span>
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={refreshAccount} disabled={acctBusy}
              title={isAr ? 'تحديث الرصيد' : 'Refresh balance'}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#00ff88', fontSize: 12, fontWeight: 800, cursor: acctBusy ? 'wait' : 'pointer', opacity: acctBusy ? 0.5 : 1 }}>
              <RefreshCw size={13} style={{ verticalAlign: -2 }} /> {acctBusy ? '...' : (isAr ? 'تحديث' : 'Refresh')}
            </button>
            <button type="button" onClick={resetBalance}
              title={isAr ? 'إعادة تعيين الرصيد' : 'Reset balance'}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,150,50,0.35)', background: 'rgba(255,150,50,0.08)', color: '#ffaa44', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
              <RotateCcw size={13} style={{ verticalAlign: -2 }} /> {isAr ? 'تجديد' : 'Reset'}
            </button>
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'الرصيد' : 'Balance'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#00ff88' }}>${acct.balance.toFixed(2)}</div>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'الحقوق (Equity)' : 'Equity'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>${acct.equity.toFixed(2)}</div>
          </div>
          <div style={{ background: '#0a0a0a', border: `1px solid ${acct.floating >= 0 ? 'rgba(0,255,136,0.3)' : 'rgba(255,51,51,0.3)'}`, borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'العائم (صفقات)' : 'Floating'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: acct.floating >= 0 ? '#00ff88' : '#ff5555' }}>
              {acct.floating >= 0 ? '+' : ''}{acct.floating.toFixed(2)}$
            </div>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'الهامش المستخدم' : 'Used Margin'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#ffaa44' }}>${acct.margin.toFixed(2)}</div>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'الهامش الحر' : 'Free Margin'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#60a5fa' }}>${acct.free.toFixed(2)}</div>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: '#888', fontWeight: 700 }}>{isAr ? 'مستوى الهامش' : 'Margin Level'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: acct.margin > 0 ? (acct.level < 100 ? '#ff5555' : '#00ff88') : '#888' }}>
              {acct.margin > 0 ? `${acct.level.toFixed(0)}%` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt5-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{isAr ? 'صفقة جديدة' : 'New Trade'}</span>
      </div>

      {/* Auto trading toggle — desktop parity (default ON, key paper_trading_auto_trade) */}
      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} style={{ color: autoTrade ? '#00ff88' : '#888' }} fill={autoTrade ? 'currentColor' : 'none'} />
            {isAr ? 'التداول التلقائي' : 'Auto Trading'}
          </div>
          <button type="button" className={`mt5-btn ${autoTrade ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
            style={{ padding: '8px 16px', fontSize: 13, minWidth: 72 }} onClick={toggleAuto}>
            {autoTrade ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="mt5-card-subtitle">
          {autoTrade
            ? (isAr ? 'مفعّل — يفتح الصفقات تلقائياً على إشارات الرئيسية' : 'ON — opens trades automatically on home signals')
            : (isAr ? 'متوقف — التداول يدوي فقط' : 'OFF — manual trading only')}
        </div>
      </div>

      {/* Category pills (same 4 markets as Manual Analysis) → symbols for that category */}
      <div className="mt5-card">
        <div className="mt5-card-title">{isAr ? 'الفئة' : 'Category'}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {groups.map((g) => {
            const on = category === g.id;
            return (
              <button key={g.id} type="button" onClick={() => setCategory(g.id)}
                style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid ' + (on ? '#00ff88' : '#2a2a2a'), background: on ? 'rgba(0,255,136,0.12)' : '#0a0a0a', color: on ? '#00ff88' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {g.label} ({g.symbols.length})
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt5-card">
        <div className="mt5-card-title">
          {isAr ? 'الرمز' : 'Symbol'}
          <span style={{ marginRight: 8, fontSize: 11, color: '#666', fontWeight: 600 }}>
            {detectMobileTradeCategory(symbol)}
          </span>
        </div>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={{
            width: '100%', background: '#1a1a1a', border: '1px solid #333',
            color: '#fff', borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 700,
          }}
        >
          <optgroup label={isAr ? 'رموز الفئة المختارة' : 'Selected category symbols'}>
            {catSymbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </optgroup>
          {symbolUniverse.filter((g) => g.id !== 'current').map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.symbols.filter((s) => !catSymbols.includes(s)).slice(0, 60).map((s) => (
                <option key={g.id + ':' + s} value={s}>{s}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Live candle chart with entry/SL/TP levels (desktop parity: drag to adjust) */}
      {symbol && (
        <div className="mt5-card">
          <div className="mt5-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart2 size={15} style={{ color: '#00ff88' }} />
            {symbol}
            {openForSymbol && (
              <span style={{ fontSize: 10, fontWeight: 800, color: openForSymbol.side === 'buy' ? '#00ff88' : '#ff5555', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '1px 7px' }}>
                {openForSymbol.side.toUpperCase()} {openForSymbol.qty.toFixed(2)}
              </span>
            )}
          </div>
          <div style={{ marginTop: 8, height: 320, borderRadius: 10, overflow: 'hidden' }}>
            <TradingViewEmbed symbol={symbol} interval="60" />
          </div>
        </div>
      )}
      {sig && sig.stopLoss && sig.takeProfit && (
        <MobileLotCalc symbol={symbol} stopLoss={sig.stopLoss} takeProfit={sig.takeProfit}
          entryPrice={sig.entryPrice} lang={lang} balance={balance} onPickLot={setVolume} />
      )}

      {current && (
        <div className="mt5-status-bar">
          <div className="mt5-status-item">
            <div className="mt5-status-label">Bid / Sell</div>
            <div className="mt5-status-value negative">
              {current.bid.toFixed(current.bid < 10 ? 4 : 2)}
            </div>
          </div>
          <div className="mt5-status-item">
            <div className="mt5-status-label">Spread</div>
            <div className="mt5-status-value">
              {((current.ask - current.bid) * (current.bid < 10 ? 10000 : 100)).toFixed(1)}
            </div>
          </div>
          <div className="mt5-status-item">
            <div className="mt5-status-label">Ask / Buy</div>
            <div className="mt5-status-value positive">
              {current.ask.toFixed(current.ask < 10 ? 4 : 2)}
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#888', fontWeight: 700 }}>{isAr ? 'الحجم' : 'Volume'}</span>
          <input
            type="number" min="0.01" step="0.01" value={volume}
            onChange={(e) => setVolume(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
            style={{
              flex: 1, background: '#1a1a1a', border: '1px solid #333', color: '#fff',
              borderRadius: 10, padding: 10, fontSize: 14, fontWeight: 700,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[0.01, 0.05, 0.1, 0.5, 1.0].map((v) => (
            <button
              key={v}
              type="button"
              className={`mt5-btn ${volume === v ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ flex: 1, padding: '8px 2px', fontSize: 12 }}
              onClick={() => setVolume(v)}
            >
              {v.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          className="mt5-btn-sell"
          style={{ flex: 1, opacity: busy || !symbol ? 0.5 : 1 }}
          disabled={busy || !symbol}
          onClick={() => openSide('sell')}
        >
          SELL
        </button>
        <button
          type="button"
          className="mt5-btn-buy"
          style={{ flex: 1, opacity: busy || !symbol ? 0.5 : 1 }}
          disabled={busy || !symbol}
          onClick={() => openSide('buy')}
        >
          BUY
        </button>
      </div>
    </div>
  );
}



