import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { closeMobileTrade, updateMobileTradeLevels, detectMobileTradeCategory } from '../../services/mobileTradeBridge';
import { subscribeQuoteBatch } from '../../services/paperTradingService';
import { slAmountUSD, usdToPrice } from '../../lib/positionMath';

export interface MobilePosition {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  // Full original-account details (desktop parity: TradeNowPage table).
  category?: string;
  sl?: number | null;
  tp?: number | null;
  openedAt?: number;
  source?: 'auto' | 'manual';
  exitPrice?: number | null;
  closedAt?: number | null;
  closeReason?: 'manual' | 'tp' | 'sl' | null;
}

interface ClosedPosition {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  exitPrice: number;
  profit: number;
  openedAt?: number;
  closedAt?: number;
  closeReason?: string | null;
  source?: 'auto' | 'manual';
}

interface MobilePositionsProps {
  positions: MobilePosition[];
  closed?: ClosedPosition[];
  onClose: (id: string) => void;
  onSelect?: (symbol: string) => void;
}

export function MobilePositions({ positions, closed, onClose, onSelect }: MobilePositionsProps) {
  const lang: Language = (() => { try { const s = localStorage.getItem('language'); return (s === 'ar' ? 'ar' : 'en') as Language; } catch { return 'en'; } })();
  const [live, setLive] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'history'>('open');
  // SL/TP/Trailing edit modal (desktop parity: pencil → modal → save).
  // Values are entered in USD and converted to/from price via positionMath.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSlUsd, setEditSlUsd] = useState('');
  const [editTpUsd, setEditTpUsd] = useState('');
  const [editTrailAct, setEditTrailAct] = useState('');
  const [editTrailStep, setEditTrailStep] = useState('');

  const loadTrailingDefaults = () => {
    const fallback = { baseActivationUSD: 5, baseStepUSD: 2 };
    try {
      const s = JSON.parse(localStorage.getItem('strategy_settings') || '{}');
      return {
        baseActivationUSD: (s as any).trailingBaseActivationUSD ?? fallback.baseActivationUSD,
        baseStepUSD: (s as any).trailingBaseStepUSD ?? fallback.baseStepUSD,
      };
    } catch { return fallback; }
  };

  // Live P&L from the SAME real quote path as desktop (getLivePrice → /api/quote).
  // Now driven by the shared quote hub: one batched request for the whole app
  // instead of a private timer issuing one request per position every 2s.
  // The batch subscription delivers ALL symbols in ONE callback, so the
  // component performs a single React state commit per tick.
  const syms = useMemo(() => [...new Set(positions.map((p) => p.symbol))], [positions]);
  const symKey = syms.join('|');
  useEffect(() => {
    if (!syms.length) return;
    const unsub = subscribeQuoteBatch(syms, (prices) => {
      setLive((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [s, price] of prices) {
          if (next[s] !== price) { next[s] = price; changed = true; }
        }
        return changed ? next : prev;
      });
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symKey]);

  const doClose = async (id: string) => {
    setBusy(id);
    try { await closeMobileTrade(id); } catch {}
    try { window.dispatchEvent(new CustomEvent('mobile-close-trade', { detail: { id } })); } catch {}
    onClose(id);
    setBusy(null);
  };

  const startEdit = (p: MobilePosition) => {
    try { window.alert('EDIT: ' + p.symbol); } catch (e) { console.error(e); }
    const category = p.category || detectMobileTradeCategory(p.symbol);
    const entry = p.openPrice;
    const qty = p.volume;
    setEditingId(p.id);
    // Convert current SL/TP prices to USD amounts for editing.
    setEditSlUsd(p.sl != null && entry > 0 && qty > 0
      ? slAmountUSD(p.symbol, Math.abs(entry - p.sl), qty, category).toFixed(2)
      : '');
    setEditTpUsd(p.tp != null && entry > 0 && qty > 0
      ? slAmountUSD(p.symbol, Math.abs(entry - p.tp), qty, category).toFixed(2)
      : '');
    const d = loadTrailingDefaults();
    setEditTrailAct(String(d.baseActivationUSD));
    setEditTrailStep(String(d.baseStepUSD));
  };

  const saveLevels = async (p: MobilePosition) => {
    const category = p.category || detectMobileTradeCategory(p.symbol);
    const entry = p.openPrice;
    const qty = p.volume;
    const slUsd = parseFloat(editSlUsd);
    const tpUsd = parseFloat(editTpUsd);
    const trailAct = parseFloat(editTrailAct);
    const trailStep = parseFloat(editTrailStep);

    let nextSl: number | null = null;
    let nextTp: number | null = null;
    if (isFinite(slUsd) && slUsd > 0 && entry > 0 && qty > 0) {
      nextSl = usdToPrice(p.symbol, slUsd, entry, p.type !== 'buy', qty, category);
    }
    if (isFinite(tpUsd) && tpUsd > 0 && entry > 0 && qty > 0) {
      nextTp = usdToPrice(p.symbol, tpUsd, entry, p.type === 'buy', qty, category);
    }

    setBusy(p.id);
    try {
      await updateMobileTradeLevels(p.id, nextSl, nextTp, {
        activationUSD: isFinite(trailAct) && trailAct > 0 ? trailAct : undefined,
        stepUSD: isFinite(trailStep) && trailStep > 0 ? trailStep : undefined,
      });
      p.sl = nextSl; p.tp = nextTp;
    } catch {}
    // Persist trailing defaults if changed (global fallback for the background manager).
    if (isFinite(trailAct) || isFinite(trailStep)) {
      try {
        const s = JSON.parse(localStorage.getItem('strategy_settings') || '{}');
        if (isFinite(trailAct) && trailAct > 0) s.trailingBaseActivationUSD = trailAct;
        if (isFinite(trailStep) && trailStep > 0) s.trailingBaseStepUSD = trailStep;
        localStorage.setItem('strategy_settings', JSON.stringify(s));
      } catch {}
    }
    setEditingId(null);
    setBusy(null);
  };

  const fmtDate = (ts?: number | null): string => {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const closedList = (closed || []).slice().sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const closedPnl = closedList.reduce((s, c) => s + (c.profit || 0), 0);

  if (!positions.length && !closedList.length) {
    return (
      <div className="mt5-page-container">
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">💼</div>
          <div className="mt5-empty-title">{mobileT(lang, 'No open positions', 'لا توجد صفقات مفتوحة')}</div>
          <div className="mt5-empty-subtitle">{mobileT(lang, 'Auto or manual trades will appear here', 'الصفقات التلقائية واليدوية ستظهر هنا')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">
        {mobileT(lang, 'Positions', 'الصفقات')} ({positions.length})
      </div>
      {/* Open / History tabs — desktop parity: Trade tab + History tab */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setTab('open')}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
            border: tab === 'open' ? '1px solid rgba(0,255,136,0.5)' : '1px solid #2a2a2a',
            background: tab === 'open' ? 'rgba(0,255,136,0.12)' : '#0a0a0a',
            color: tab === 'open' ? '#00ff88' : '#888',
          }}
        >
          {mobileT(lang, `Open (${positions.length})`, `مفتوحة (${positions.length})`)}
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
            border: tab === 'history' ? '1px solid rgba(96,165,250,0.5)' : '1px solid #2a2a2a',
            background: tab === 'history' ? 'rgba(96,165,250,0.12)' : '#0a0a0a',
            color: tab === 'history' ? '#60a5fa' : '#888',
          }}
        >
          {mobileT(lang, `History (${closedList.length})`, `السجل (${closedList.length})`)}
        </button>
      </div>

      {tab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12, fontWeight: 800 }}>
            <span style={{ color: '#888' }}>{mobileT(lang, 'Closed P&L', 'ربح/خسارة المغلقة')}</span>
            <span style={{ color: closedPnl >= 0 ? '#00ff88' : '#ff5555' }}>
              {closedPnl >= 0 ? '+' : ''}{closedPnl.toFixed(2)}$
            </span>
          </div>
          {closedList.length === 0 && (
            <div className="mt5-empty-state">
              <div className="mt5-empty-icon">📜</div>
              <div className="mt5-empty-title">{mobileT(lang, 'No closed trades yet', 'لا توجد صفقات مغلقة بعد')}</div>
            </div>
          )}
          {closedList.map((c) => {
            const dec = (c.exitPrice || c.openPrice) < 10 ? 4 : 2;
            return (
              <div key={c.id} className="mt5-position-card" style={{ alignItems: 'flex-start' }}>
                <div className="mt5-position-info" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="mt5-position-symbol">{c.symbol}</span>
                    <span className={`mt5-position-type ${c.type}`} style={{ fontSize: 11 }}>
                      {c.type.toUpperCase()} {c.volume.toFixed(2)}
                    </span>
                    {c.closeReason && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, borderRadius: 6, padding: '1px 7px',
                        color: c.closeReason === 'tp' ? '#00ff88' : c.closeReason === 'sl' ? '#ff5555' : '#888',
                        background: '#0a0a0a', border: '1px solid #2a2a2a',
                      }}>
                        {c.closeReason.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="mt5-card-subtitle" style={{ marginTop: 4, fontSize: 11 }}>
                    📅 {mobileT(lang, 'Opened', 'الفتح')}: {fmtDate(c.openedAt)} → {mobileT(lang, 'Closed', 'الإغلاق')}: {fmtDate(c.closedAt)}
                  </div>
                  <div className="mt5-card-subtitle" style={{ fontSize: 12, color: '#ccc' }}>
                    {c.openPrice.toFixed(dec)} → {c.exitPrice.toFixed(dec)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`mt5-position-profit ${c.profit >= 0 ? 'positive' : 'negative'}`}>
                    {c.profit >= 0 ? '+' : ''}{c.profit.toFixed(2)}$
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'open' && positions.map((p) => {
        const cur = live[p.symbol] ?? p.currentPrice;
        const pnl = p.profit;
        const dec = cur < 10 ? 4 : 2;
        const d = p.openedAt ? new Date(p.openedAt) : null;
        const dateStr = d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '—';
        return (
          <div key={p.id} className="mt5-position-card"
            onClick={(e) => {
              // Don't navigate to trade tab when tapping inner buttons (e.g. orange edit).
              if ((e.target as HTMLElement)?.closest?.('button')) return;
              onSelect?.(p.symbol);
            }}
            style={{ cursor: onSelect ? 'pointer' : undefined, alignItems: 'flex-start' }}
            title={onSelect ? (p.symbol + ' — tap to open chart') : undefined}>
            <div className="mt5-position-info" style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="mt5-position-symbol">{p.symbol}</span>
                <span className={`mt5-position-type ${p.type}`} style={{ fontSize: 11 }}>
                  {p.type.toUpperCase()} {p.volume.toFixed(2)}
                </span>
                {p.category && (
                  <span style={{ fontSize: 10, color: '#666', fontWeight: 700, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 6, padding: '1px 6px' }}>
                    {p.category}
                  </span>
                )}
                {p.source && (
                  <span style={{ fontSize: 10, color: p.source === 'auto' ? '#00ff88' : '#60a5fa', fontWeight: 700 }}>
                    {p.source === 'auto' ? (lang === 'ar' ? 'تلقائي' : 'AUTO') : (lang === 'ar' ? 'يدوي' : 'MANUAL')}
                  </span>
                )}
              </div>
              {/* Dates + prices — exactly like the original account table */}
              <div className="mt5-card-subtitle" style={{ marginTop: 4, fontSize: 11 }}>
                📅 {mobileT(lang, 'Opened', 'الفتح')}: {dateStr}
              </div>
              <div className="mt5-card-subtitle" style={{ fontSize: 12, color: '#ccc' }}>
                {mobileT(lang, 'Entry', 'الدخول')}: {p.openPrice.toFixed(dec)} → {mobileT(lang, 'Now', 'الحالي')}: {cur.toFixed(dec)}
              </div>
              {/* SL/TP viewer + edit button (desktop parity: pencil → modal in USD) */}
              <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 11, fontWeight: 700, alignItems: 'center' }}>
                <span style={{ color: '#ff8888' }}>SL: {p.sl != null ? Number(p.sl).toFixed(dec) : '—'}</span>
                <span style={{ color: '#88ffaa' }}>TP: {p.tp != null ? Number(p.tp).toFixed(dec) : '—'}</span>
               </div>

                <button
                  type="button" title={mobileT(lang, 'Edit SL/TP/Trailing (USD)', 'تعديل الوقف/الهدف/تريلنغ (دولار)')}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(p); }}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(p); }}
                  onTouchStart={(e) => { e.stopPropagation(); }}
                  onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); startEdit(p); }}
                  style={{ marginTop: 6, width: '100%', height: 30, borderRadius: 6, border: 'none', background: 'linear-gradient(90deg, #ffaa44, #ff8800)', position: 'relative', zIndex: 5, color: '#000', fontWeight: 800, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {mobileT(lang, 'Edit SL / TP / Trailing', 'تعديل الوقف / الهدف / التريلنغ')}
                </button>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={`mt5-position-profit ${pnl >= 0 ? 'positive' : 'negative'}`}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}$
              </div>
              <div className="mt5-position-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="mt5-btn mt5-btn-danger"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                  disabled={busy === p.id}
                  onClick={(e) => { e.stopPropagation(); doClose(p.id); }}
                >
                  <X size={14} /> {busy === p.id ? '...' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Edit modal: SL/TP in USD + Trailing defaults ──
  const editPos = editingId ? positions.find((p) => p.id === editingId) : null;
  if (editingId) {
    if (!editPos) {
      // fallback: reset editing state so we never get stuck
      setTimeout(() => setEditingId(null), 0);
      return createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0d1117', padding: 16, borderRadius: 12, color: '#fff' }}>
            Position not found. <button onClick={() => setEditingId(null)} style={{ marginLeft: 8 }}>Close</button>
          </div>
        </div>,
        document.body
      );
    }
    const category = editPos.category || detectMobileTradeCategory(editPos.symbol);
    const dec = editPos.openPrice < 10 ? 4 : 2;
    return createPortal(
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#0d1117', border: '1px solid #2a2a2a', borderRadius: 12,
          width: 'min(92vw, 380px)', padding: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: '#fff' }}>
            {mobileT(lang, 'Edit Levels', 'تعديل المستويات')} — {editPos.symbol}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#ff8888', fontWeight: 800 }}>
                SL ({mobileT(lang, 'USD', 'دولار')})
              </label>
              <input
                type="number" step="any" value={editSlUsd}
                onChange={(e) => setEditSlUsd(e.target.value)}
                style={{ width: '100%', background: '#0a0a0a', border: '1px solid rgba(255,51,51,0.4)',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
              />
              <span style={{ fontSize: 10, color: '#666' }}>
                {editPos.sl != null ? editPos.sl.toFixed(dec) : '—'} {mobileT(lang, 'current price', 'السعر الحالي')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#88ffaa', fontWeight: 800 }}>
                TP ({mobileT(lang, 'USD', 'دولار')})
              </label>
              <input
                type="number" step="any" value={editTpUsd}
                onChange={(e) => setEditTpUsd(e.target.value)}
                style={{ width: '100%', background: '#0a0a0a', border: '1px solid rgba(0,255,136,0.4)',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
              />
              <span style={{ fontSize: 10, color: '#666' }}>
                {editPos.tp != null ? editPos.tp.toFixed(dec) : '—'} {mobileT(lang, 'current price', 'السعر الحالي')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              <label style={{ fontSize: 11, color: '#ffaa44', fontWeight: 800 }}>
                {mobileT(lang, 'Trailing activation ($)', 'تفعيل التريلنغ ($)')}
              </label>
              <input
                type="number" step="any" value={editTrailAct}
                onChange={(e) => setEditTrailAct(e.target.value)}
                style={{ width: '100%', background: '#0a0a0a', border: '1px solid #ffaa44',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#ffaa44', fontWeight: 800 }}>
                {mobileT(lang, 'Trailing step ($)', 'خطوة التريلنغ ($)')}
              </label>
              <input
                type="number" step="any" value={editTrailStep}
                onChange={(e) => setEditTrailStep(e.target.value)}
                style={{ width: '100%', background: '#0a0a0a', border: '1px solid #ffaa44',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setEditingId(null); }}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a2a',
                  background: '#0a0a0a', color: '#888', cursor: 'pointer' }}
              >
                {mobileT(lang, 'Cancel', 'إلغاء')}
              </button>
              <button
                type="button"
                disabled={busy === editPos.id}
                onClick={(e) => { e.stopPropagation(); saveLevels(editPos); }}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: '#00ff88', color: '#000', fontWeight: 800, cursor: 'pointer' }}
              >
                {mobileT(lang, 'Save', 'حفظ')}
              </button>
            </div>
          </div>
        </div>
      </div>
    , document.body);
  }
}
