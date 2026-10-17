import React, { useState, useMemo } from 'react';
import type { MobileQuote } from './MobileQuotes';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { MobileLotCalc } from './MobileLotCalc';

interface MobileNewTradeProps {
  quotes: MobileQuote[];
  defaultSymbol: string | null;
  lang: Language;
  balance: number;
  signalFor?: (symbol: string) => AnalysisResult | undefined;
  onOpen: (symbol: string, type: 'buy' | 'sell', volume: number) => void;
}

export function MobileNewTrade({ quotes, defaultSymbol, lang, balance, signalFor, onOpen }: MobileNewTradeProps) {
  const isAr = lang === 'ar';
  const [symbol, setSymbol] = useState(defaultSymbol || (quotes[0]?.symbol || ''));
  const [volume, setVolume] = useState(0.01);

  const current = quotes.find((q) => q.symbol === symbol);
  const sig = useMemo(() => (signalFor ? signalFor(symbol) : undefined), [signalFor, symbol]);

  return (
    <div className="mt5-page-container">
      <div className="mt5-section-title">{isAr ? 'صفقة جديدة' : 'New Trade'}</div>

      <div className="mt5-card">
        <div className="mt5-card-title">{isAr ? 'الرمز' : 'Symbol'}</div>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          style={{
            width: '100%', background: '#1a1a1a', border: '1px solid #333',
            color: '#fff', borderRadius: 10, padding: 12, fontSize: 15, fontWeight: 700,
          }}
        >
          {quotes.map((q) => (
            <option key={q.symbol} value={q.symbol}>
              {q.symbol} — {q.category}
            </option>
          ))}
        </select>
      </div>

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

      <div className="mt5-card">
        <div className="mt5-card-title">{isAr ? 'الحجم (لوت)' : 'Volume (Lot)'}</div>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value) || 0.01)}
          style={{
            width: '100%', background: '#1a1a1a', border: '1px solid #333',
            color: '#fff', borderRadius: 10, padding: 12, fontSize: 16, fontWeight: 700,
            textAlign: 'center',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[0.01, 0.05, 0.1, 0.5, 1.0].map((v) => (
            <button
              key={v}
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
          className="mt5-btn-sell"
          style={{ flex: 1 }}
          disabled={!symbol}
          onClick={() => symbol && onOpen(symbol, 'sell', volume)}
        >
          SELL
        </button>
        <button
          className="mt5-btn-buy"
          style={{ flex: 1 }}
          disabled={!symbol}
          onClick={() => symbol && onOpen(symbol, 'buy', volume)}
        >
          BUY
        </button>
      </div>
    </div>
  );
}