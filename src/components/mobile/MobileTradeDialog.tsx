import React, { useState } from 'react';

interface MobileTradeDialogProps {
  symbol: string;
  bid: number;
  ask: number;
  onOpen: (type: 'buy' | 'sell', volume: number) => void;
  onClose: () => void;
}

export function MobileTradeDialog({ symbol, bid, ask, onOpen, onClose }: MobileTradeDialogProps) {
  const [volume, setVolume] = useState(0.01);

  return (
    <div className="mt5-trade-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mt5-trade-panel">
        <div className="mt5-trade-title">New Order — {symbol}</div>

        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Sell (Bid)</span>
          <span className="mt5-trade-value" style={{ color: '#ff3333' }}>{bid.toFixed(bid < 10 ? 4 : 2)}</span>
        </div>
        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Buy (Ask)</span>
          <span className="mt5-trade-value" style={{ color: '#00ff88' }}>{ask.toFixed(ask < 10 ? 4 : 2)}</span>
        </div>
        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Volume (Lot)</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value) || 0.01)}
            style={{
              width: 90, textAlign: 'center', background: '#1a1a1a',
              border: '1px solid #333', color: '#fff', borderRadius: 8,
              padding: 8, fontSize: 15, fontWeight: 700,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {[0.01, 0.05, 0.10, 0.5, 1.0].map((v) => (
            <button
              key={v}
              className={`mt5-btn ${volume === v ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
              style={{ flex: 1, padding: '8px 4px', fontSize: 12 }}
              onClick={() => setVolume(v)}
            >
              {v.toFixed(2)}
            </button>
          ))}
        </div>

        <div className="mt5-trade-buttons">
          <button className="mt5-btn-sell" onClick={() => { onOpen('sell', volume); onClose(); }}>
            SELL
          </button>
          <button className="mt5-btn-buy" onClick={() => { onOpen('buy', volume); onClose(); }}>
            BUY
          </button>
        </div>

        <button className="mt5-btn-close" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}