import React from 'react';
import { TrendingUp, TrendingDown, Zap, Bell } from 'lucide-react';

export interface MobileSignal {
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  change: number;
  changePercent: number;
}

interface MobileHomeProps {
  signals: MobileSignal[];
  balance: number;
  equity: number;
  openCount: number;
  autoTradeEnabled: boolean;
  onSignalClick: (symbol: string) => void;
  onAutoTradeToggle: (enabled: boolean) => void;
}

export function MobileHome({
  signals,
  balance,
  equity,
  openCount,
  autoTradeEnabled,
  onSignalClick,
  onAutoTradeToggle,
}: MobileHomeProps) {
  const pnl = equity - balance;
  const pnlPct = balance > 0 ? (pnl / balance) * 100 : 0;

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">Account Overview</div>

      <div className="mt5-status-bar">
        <div className="mt5-status-item">
          <div className="mt5-status-label">Balance</div>
          <div className="mt5-status-value">{balance.toFixed(2)}</div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">Equity</div>
          <div className="mt5-status-value">{equity.toFixed(2)}</div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">P/L</div>
          <div className={`mt5-status-value ${pnl >= 0 ? 'positive' : 'negative'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </div>
        </div>
        <div className="mt5-status-item">
          <div className="mt5-status-label">Open</div>
          <div className="mt5-status-value">{openCount}</div>
        </div>
      </div>

      <div className="mt5-card">
        <div className="mt5-card-header">
          <div className="mt5-card-title">Auto Mirror</div>
          <button
            className={`mt5-btn ${autoTradeEnabled ? 'mt5-btn-primary' : 'mt5-btn-secondary'}`}
            onClick={() => onAutoTradeToggle(!autoTradeEnabled)}
            style={{ padding: '8px 16px', fontSize: 12 }}
          >
            {autoTradeEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="mt5-card-subtitle">
          {autoTradeEnabled
            ? 'Developer trades open instantly on your account'
            : 'Tap ON to mirror developer signals automatically'}
        </div>
      </div>

      <div className="mt5-section-title">
        <Zap size={16} /> Live Signals ({signals.length})
      </div>

      {signals.length === 0 && (
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">📊</div>
          <div className="mt5-empty-title">No active signals</div>
          <div className="mt5-empty-subtitle">New opportunities will appear here</div>
        </div>
      )}

      {signals.map((s) => (
        <div
          key={s.symbol}
          className="mt5-signal-card"
          onClick={() => onSignalClick(s.symbol)}
        >
          <div className="mt5-signal-info">
            <div className="mt5-signal-symbol">{s.symbol}</div>
            <div className={`mt5-signal-type ${s.type}`}>
              {s.type === 'buy' ? 'BUY' : 'SELL'}
            </div>
          </div>
          <div>
            <div className="mt5-signal-price">{s.price.toFixed(4)}</div>
            <div className={`mt5-signal-change ${s.change >= 0 ? 'positive' : 'negative'}`}>
              {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)} ({s.changePercent.toFixed(2)}%)
            </div>
          </div>
          <div className={`mt5-signal-badge ${s.type}`}>
            {s.type === 'buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          </div>
        </div>
      ))}
    </div>
  );
}