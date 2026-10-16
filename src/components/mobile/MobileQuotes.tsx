import React from 'react';

export interface MobileQuote {
  symbol: string;
  category: string;
  bid: number;
  ask: number;
  change: number;
  changePercent: number;
}

interface MobileQuotesProps {
  quotes: MobileQuote[];
  onSelect: (symbol: string) => void;
}

export function MobileQuotes({ quotes, onSelect }: MobileQuotesProps) {
  if (quotes.length === 0) {
    return (
      <div className="mt5-page-container">
        <div className="mt5-section-title">Market Watch</div>
        <div className="mt5-empty-state">
          <div className="mt5-empty-icon">📈</div>
          <div className="mt5-empty-title">No symbols</div>
          <div className="mt5-empty-subtitle">Market data will load here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt5-page-container" style={{ padding: 0 }}>
      <div className="mt5-section-title" style={{ padding: '12px 16px 0' }}>
        Market Watch ({quotes.length})
      </div>
      <div className="mt5-symbol-list" style={{ display: 'flex', flexDirection: 'column' }}>
        {quotes.map((q) => (
          <div
            key={q.symbol}
            className="mt5-signal-card"
            style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}
            onClick={() => onSelect(q.symbol)}
          >
            <div className="mt5-signal-info">
              <div className="mt5-signal-symbol">{q.symbol}</div>
              <div className="mt5-card-subtitle">{q.category}</div>
            </div>
            <div>
              <div className="mt5-signal-price">
                <span style={{ color: '#888', fontSize: 11, marginRight: 6 }}>B</span>
                {q.bid.toFixed(q.bid < 10 ? 4 : 2)}
              </div>
              <div className="mt5-signal-price" style={{ color: '#00ff88' }}>
                <span style={{ color: '#888', fontSize: 11, marginRight: 6 }}>A</span>
                {q.ask.toFixed(q.ask < 10 ? 4 : 2)}
              </div>
            </div>
            <div className={`mt5-signal-change ${q.change >= 0 ? 'positive' : 'negative'}`}>
              {q.change >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}