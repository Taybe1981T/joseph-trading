import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { closeMobileTrade, mobileLivePrice } from '../../services/mobileTradeBridge';

interface MobilePosition {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
}

interface MobilePositionsProps {
  positions: MobilePosition[];
  onClose: (id: string) => void;
  onSelect?: (symbol: string) => void;
}

export function MobilePositions({ positions, onClose, onSelect }: MobilePositionsProps) {
  const lang: Language = (() => { try { const s = localStorage.getItem('language'); return (s === 'ar' ? 'ar' : 'en') as Language; } catch { return 'en'; } })();
  const [live, setLive] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Live P&L from the SAME real quote path as desktop (getLivePrice → /api/quote).
  useEffect(() => {
    let alive = true;
    const syms = [...new Set(positions.map((p) => p.symbol))];
    if (!syms.length) return;
    const tick = async () => {
      for (const s of syms) {
        try {
          const p = await mobileLivePrice(s);
          if (alive && p != null) setLive((prev) => (prev[s] === p ? prev : { ...prev, [s]: p }));
        } catch {}
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [positions.map((p) => p.symbol).join('|')]);

  const doClose = async (id: string) => {
    setBusy(id);
    try { await closeMobileTrade(id); } catch {}
    try { window.dispatchEvent(new CustomEvent('mobile-close-trade', { detail: { id } })); } catch {}
    onClose(id);
    setBusy(null);
  };

  if (!positions.length) {
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
        {mobileT(lang, 'Open Positions (live)', 'الصفقات المفتوحة (مباشر)')} ({positions.length})
      </div>
      {positions.map((p) => {
        const cur = live[p.symbol] ?? p.currentPrice;
        const pnl = p.profit;
        return (
          <div key={p.id} className="mt5-position-card"
            onClick={() => onSelect?.(p.symbol)}
            style={{ cursor: onSelect ? 'pointer' : undefined }}
            title={onSelect ? (p.symbol + ' — tap to open chart') : undefined}>
            <div className="mt5-position-info">
              <div className="mt5-position-symbol">{p.symbol}</div>
              <div className={`mt5-position-type ${p.type}`}>
                {p.type.toUpperCase()} {p.volume.toFixed(2)}
              </div>
              <div className="mt5-card-subtitle">
                {p.openPrice.toFixed(4)} → {cur.toFixed(4)}
              </div>
            </div>
            <div>
              <div className={`mt5-position-profit ${pnl >= 0 ? 'positive' : 'negative'}`}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
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
