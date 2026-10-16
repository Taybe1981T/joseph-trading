import React from 'react';
import { X } from 'lucide-react';

export interface MobilePosition {
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
}

export function MobilePositions({ positions, onClose }: MobilePositionsProps) {
  const totalProfit = positions.reduce((sum, p) => sum + p.profit, 0);

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">Open Positions ({positions.length})</div>

      {positions.length > 0 && (
        <div className="mt5-status-bar">
          <div className="mt5-status-item">
            <div className="mt5-status-label">Floating P/L</div>
            <div className={`mt5-status-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
              {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="mt5-status-item">
            <div className="mt5-status-label">Count</div>
            <div className="mt5-status-value">{positions.length}</div>
          </div>
        </div>
      )}

      {positions.length === 0 && (
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">💼</div>
          <div className="mt5-empty-title">No open positions</div>
          <div className="mt5-empty-subtitle">Open a trade from Quotes or New Trade</div>
        </div>
      )}

      {positions.map((p) => (
        <div key={p.id} className="mt5-position-card">
          <div className="mt5-position-info">
            <div className="mt5-position-symbol">{p.symbol}</div>
            <div className={`mt5-position-type ${p.type}`}>
              {p.type.toUpperCase()} {p.volume.toFixed(2)}
            </div>
            <div className="mt5-card-subtitle">
              {p.openPrice.toFixed(4)} → {p.currentPrice.toFixed(4)}
            </div>
          </div>
          <div>
            <div className={`mt5-position-profit ${p.profit >= 0 ? 'positive' : 'negative'}`}>
              {p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}
            </div>
            <div className="mt5-position-actions" style={{ marginTop: 8 }}>
              <button
                className="mt5-btn mt5-btn-danger"
                style={{ padding: '6px 14px', fontSize: 12 }}
                onClick={() => onClose(p.id)}
              >
                <X size={14} /> Close
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}