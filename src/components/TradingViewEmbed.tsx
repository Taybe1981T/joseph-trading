import React, { useEffect, useRef } from 'react';
import { toTvSymbol } from '../lib/tvSymbol';

interface Props {
  symbol: string; // TradingView format e.g. "BINANCE:BTCUSDT" or "FX:EURUSD"
  interval?: string;
}

export default function TradingViewEmbed({ symbol, interval = '60' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = toTvSymbol(symbol);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Reset + retry: the advanced-chart widget sometimes renders an empty
    // search box when the symbol has no candles on the first load (notably
    // index CFDs and intraday TFs). Loading twice hides that first-paint gap.
    container.innerHTML = '';
    let cancelled = false;
    const load = (attempt: number) => {
      if (cancelled) return;
      container.innerHTML = '';
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.async = true;
      script.innerHTML = JSON.stringify({
        allow_symbol_change: false,
        calendar: false,
        details: false,
        hide_side_toolbar: false,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_volume: false,
        hotlist: false,
        interval,
        locale: 'en',
        save_image: false,
        style: '1',
        symbol: tvSymbol,
        theme: 'dark',
        timezone: 'Etc/UTC',
        backgroundColor: '#0b0e14',
        gridColor: 'rgba(255,255,255,0.04)',
        watchlist: [],
        withdateranges: false,
        compareSymbols: [],
        studies: [],
        autosize: true,
      });
      container.appendChild(script);
      // One silent retry if the iframe never paints (empty-data first load).
      if (attempt === 0) {
        setTimeout(() => {
          try {
            const iframe = container.querySelector('iframe');
            if (!cancelled && !iframe) load(1);
          } catch {}
        }, 6000);
      }
    };
    load(0);
    return () => { cancelled = true; container.innerHTML = ''; };
  }, [tvSymbol, interval]);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-white/10 bg-[#0b0e14]">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
