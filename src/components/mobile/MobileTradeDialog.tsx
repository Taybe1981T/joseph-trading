import React from 'react';

interface MobileTradeDialogProps {
  symbol: string;
  bid: number;
  ask: number;
  onOpen: (type: 'buy' | 'sell', volume: number) => void;
  onClose: () => void;
}

export function MobileTradeDialog({ symbol, bid, ask, onOpen, onClose }: MobileTradeDialogProps) {
  const [volume, setVolume] = React.useState(0.01);

  const handleBuy = () => {
    onOpen('buy', volume);
    onClose();
  };

  const handleSell = () => {
    onOpen('sell', volume);
    onClose();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value) || 0.01);
  };

  return (
    <div className="mt5-trade-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mt5-trade-panel">
        <div className="mt5-trade-title">New Trade — {symbol}</div>

        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Bid Price</span>
          <span className="mt5-trade-value mt5-change-down">{bid.toFixed(4)}</span>
        </div>
        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Ask Price</span>
          <span className="mt5-trade-value mt5-change-up">{ask.toFixed(4)}</span>
        </div>
        <div className="mt5-trade-row">
          <span className="mt5-trade-label">Volume (Lot)</span>
          <span className="mt5-trade-value">{volume}</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={volume}
            onChange={handleVolumeChange}
            style={{
              width: 60,
              textAlign: 'center',
              background: '#1a1a1a',
              border: '1px solid #333',
              color: '#fff',
              borderRadius: 6,
              padding: 6,
              fontSize: 14,
            }}
          />
        </div>

        <div className="mt5-trade-buttons">
          <button className="mt5-btn-buy" onClick={handleBuy}>
            Buy
          </button>
          <button className="mt5-btn-sell" onClick={handleSell}>
            Sell
          </button>
        </div>

        <button className="mt5-btn-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}