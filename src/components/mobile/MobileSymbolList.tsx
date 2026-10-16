import React from 'react';

interface SymbolItem {
  symbol: string;
  category: string;
  bid: number;
  ask: number;
  change: number;
  changePercent: number;
  onSelect: (symbol: string) => void;
}

interface MobileSymbolListProps {
  symbols: SymbolItem[];
}

export function MobileSymbolList({ symbols }: MobileSymbolListProps) {
  if (symbols.length === 0) {
    return (
      <div className="mt5-empty-state">
        <div className="mt5-empty-icon">📊</div>
        <div className="mt5-empty-title">No symbols available</div>
        <div className="mt5-empty-subtitle">No quotes or trades to display</div>
      </div>
    );
  }

  return (
    <div className="mt5-symbol-list">
      {symbols.map((s) => (
        <div
          key={s.symbol}
          className="mt5-symbol-item"
          onClick={() => s.onSelect(s.symbol)}
        >
          <div>
            <div className="mt5-symbol-name">{s.symbol}</div>
            <div className="mt5-symbol-category">{s.category}</div>
          </div>
          <div className="mt5-symbol-prices">
            <div className="mt5-symbol-bid">{s.bid.toFixed(4)}</div>
            <div className="mt5-symbol-ask">{s.ask.toFixed(4)}</div>
            <div className={`mt5-symbol-change ${s.change >= 0 ? 'mt5-change-up' : 'mt5-change-down'}`}>
              {s.change >= 0 ? '+' : ''}{s.change.toFixed(4)} ({s.changePercent.toFixed(2)}%)
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}