import { useEffect, useState } from 'react';
import { getLivePrice, subscribeQuoteBatch } from '../../services/paperTradingService';
import type { MobileQuote } from './MobileQuotes';

/** Base instruments shown in the watchlist (same universes as the site). */
const BASE: { symbol: string; category: string; spreadFactor: number }[] = [
  { symbol: 'BTCUSD', category: 'Crypto', spreadFactor: 0.00005 },
  { symbol: 'ETHUSD', category: 'Crypto', spreadFactor: 0.0001 },
  { symbol: 'XAUUSD', category: 'Metals', spreadFactor: 0.0001 },
  { symbol: 'EURUSD', category: 'Forex', spreadFactor: 0.00002 },
  { symbol: 'GBPUSD', category: 'Forex', spreadFactor: 0.00002 },
  { symbol: 'USDJPY', category: 'Forex', spreadFactor: 0.00002 },
  { symbol: 'US30', category: 'Indices', spreadFactor: 0.00004 },
  { symbol: 'NAS100', category: 'Indices', spreadFactor: 0.00006 },
];

/**
 * Live quotes for the watchlist — mirrors the original site by routing every
 * symbol through `subscribePrices` (the SAME engine the desktop trade page uses).
 * Prices refresh ~1s; change% is measured against the session open (first price).
 */
export function useLiveQuotes(): MobileQuote[] {
  // A single state object instead of two: the hub delivers every symbol's price
  // in one batch, so we now commit ONE state update per tick instead of two
  // setState calls per symbol (previously ~16 re-renders per second).
  const [state, setState] = useState<{ prices: Record<string, number>; opens: Record<string, number> }>({ prices: {}, opens: {} });

  useEffect(() => {
    const symbols = BASE.map((b) => b.symbol);
    // ONE callback per tick with ALL prices → a single state commit per second
    // instead of one commit per symbol.
    const unsub = subscribeQuoteBatch(symbols, (batch) => {
      setState((prev) => {
        let changed = false;
        const prices = { ...prev.prices };
        const opens = { ...prev.opens };
        for (const [sym, price] of batch) {
          if (!(price > 0)) continue;
          if (prices[sym] !== price) { prices[sym] = price; changed = true; }
          // change% is measured against the session open (first price seen).
          if (opens[sym] == null) { opens[sym] = price; changed = true; }
        }
        return changed ? { prices, opens } : prev;
      });
    });
    return () => { try { unsub(); } catch {} };
  }, []);

  const { prices, opens } = state;
  return BASE.map((b) => {
    const bid = prices[b.symbol];
    const open = opens[b.symbol] ?? bid;
    if (bid == null) {
      return { symbol: b.symbol, category: b.category, bid: 0, ask: 0, change: 0, changePercent: 0 };
    }
    const spread = bid * b.spreadFactor;
    const ask = bid + spread;
    const change = bid - open;
    const changePercent = open > 0 ? (change / open) * 100 : 0;
    return { symbol: b.symbol, category: b.category, bid, ask, change, changePercent };
  });
}

/** One-shot live price for an arbitrary symbol (e.g. a manually picked one). */
export async function fetchQuotePrice(symbol: string): Promise<number | null> {
  try { return await getLivePrice(symbol); } catch { return null; }
}