import { useEffect, useState } from 'react';
import { subscribePrices } from '../../services/paperTradingService';
import { getLivePrice } from '../../services/paperTradingService';
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
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [opens, setOpens] = useState<Record<string, number>>({});

  useEffect(() => {
    const symbols = BASE.map((b) => b.symbol);
    const unsub = subscribePrices(symbols, (sym, price) => {
      if (!(price > 0)) return;
      setPrices((prev) => ({ ...prev, [sym]: price }));
      setOpens((prev) => (prev[sym] == null ? { ...prev, [sym]: price } : prev));
    });
    return () => { try { unsub(); } catch {} };
  }, []);

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