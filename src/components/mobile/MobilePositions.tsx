import React, { useState, useEffect, useMemo } from 'react';
import { X, Pencil, Check } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { closeMobileTrade, updateMobileTradeLevels } from '../../services/mobileTradeBridge';
import { subscribeQuoteBatch } from '../../services/paperTradingService';

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
  // SL/TP inline editor (desktop parity: pencil → inputs → save).
  const [editing, setEditing] = useState<string | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');

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
    setEditing(p.id);
    setEditSl(p.sl != null ? String(p.sl) : '');
    setEditTp(p.tp != null ? String(p.tp) : '');
  };

  const saveLevels = async (p: MobilePosition) => {
    const sl = editSl.trim() === '' ? null : Number(editSl);
    const tp = editTp.trim() === '' ? null : Number(editTp);
    if ((sl != null && !(sl > 0)) || (tp != null && !(tp > 0))) return;
    setBusy(p.id);
    try {
      await updateMobileTradeLevels(p.id, sl, tp);
      // Optimistic: update the row instantly (layout re-fetch confirms).
      p.sl = sl; p.tp = tp;
    } catch {}
    setEditing(null);
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
            onClick={() => onSelect?.(p.symbol)}
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
              {/* SL/TP viewer + inline editor (desktop parity: pencil → inputs → check) */}
              {editing === p.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: '#ff8888', fontWeight: 800 }}>SL
                    <input
                      type="number" step="any" value={editSl}
                      onChange={(e) => setEditSl(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 90, marginLeft: 4, background: '#0a0a0a', border: '1px solid rgba(255,51,51,0.4)', color: '#fff', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                    />
                  </label>
                  <label style={{ fontSize: 11, color: '#88ffaa', fontWeight: 800 }}>TP
                    <input
                      type="number" step="any" value={editTp}
                      onChange={(e) => setEditTp(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 90, marginLeft: 4, background: '#0a0a0a', border: '1px solid rgba(0,255,136,0.4)', color: '#fff', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                    />
                  </label>
                  <button
                    type="button" title={mobileT(lang, 'Save', 'حفظ')}
                    disabled={busy === p.id}
                    onClick={(e) => { e.stopPropagation(); saveLevels(p); }}
                    style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: '#00ff88', color: '#000', fontWeight: 800, cursor: 'pointer' }}
                  >
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 11, fontWeight: 700, alignItems: 'center' }}>
                  <span style={{ color: '#ff8888' }}>SL: {p.sl != null ? Number(p.sl).toFixed(dec) : '—'}</span>
                  <span style={{ color: '#88ffaa' }}>TP: {p.tp != null ? Number(p.tp).toFixed(dec) : '—'}</span>
                  <button
                    type="button" title={mobileT(lang, 'Edit SL/TP', 'تعديل الوقف/الهدف')}
                    onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                    style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#ffaa44', cursor: 'pointer' }}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              )}
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
}
