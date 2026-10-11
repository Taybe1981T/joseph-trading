import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import { playClickSound, playDragTick } from '../lib/tradeSounds';
import { getInstrumentConfig } from '../lib/positionMath';

// Strip outlier candles whose range exceeds median*5 — protects the chart
// even when the backend returns stale Twelve Data with implausible spikes.
function sanitizeCandlesForChart(candles: { time: number; open: number; high: number; low: number; close: number }[]) {
  if (candles.length < 10) return candles;
  const ranges = candles.map((c) => Math.abs(c.high - c.low));
  const sorted = [...ranges].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median || median <= 0) return candles;
  const limit = median * 5;
  const filtered = candles.filter((c) => Math.abs(c.high - c.low) <= limit);
  if (filtered.length < candles.length) {
    console.log(`[sanitize-chart] dropped ${candles.length - filtered.length} outlier candles`);
  }
  return filtered.length > 0 ? filtered : candles;
}

interface TradingViewWidgetProps {
  symbol: string;
  entryPrice?: number | null;
  sl?: number | null;
  tp?: number | null;
  side?: 'buy' | 'sell' | null;
  category?: string | null;
  qty?: number | null;
  openedAt?: number | null;
  livePrice?: number | null;
  onSlChange?: (price: number) => void;
  onTpChange?: (price: number) => void;
  [key: string]: any;
}

type LineKey = 'entry' | 'sl' | 'tp';

// Timeframes for the trading chart. '1d' (Daily) is the default view: it is the
// cleanest, most TradingView-like perspective and the backend fully supports it
// (Binance 1d/365 bars, Twelve Data 1day). Outlier-spiked candles are neutralised
// at runtime by sanitizeCandlesForChart(), so daily is safe to show.
// Full range 1-minute → 1-month (a monthly chart spans years). Keys match the
// /api/market-data backend: note lowercase '1w' for weekly, capital '1M'.
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

const DRAW_TOOLS = [
  { id: 'cursor', label: 'مؤشر', icon: '↖' },
  { id: 'hline', label: 'أفقي', icon: '─' },
  { id: 'vline', label: 'عمودي', icon: '│' },
  { id: 'trend', label: 'اتجاه', icon: '╱' },
  { id: 'arrow', label: 'سهم', icon: '➤' },
];

const INDICATORS = [
  { id: 'rsi', label: 'RSI' },
  { id: 'bb', label: 'Bollinger' },
  { id: 'vol', label: 'Volume' },
];

export default function TradingViewWidget({ symbol, entryPrice, sl, tp, side, trailingActive, onSlChange, onTpChange, openedAt, livePrice }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const dataRef = useRef<any[]>([]);
  const priceLinesRef = useRef<Partial<Record<LineKey, any>>>({});
  const draggingRef = useRef<LineKey | null>(null);
  const lastDragSoundRef = useRef(0);
  const [tf, setTf] = useState('1d');
  const [positions, setPositions] = useState<{ sl?: number; tp?: number }>({});
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty'>('loading');
  const [drawColor, setDrawColor] = useState('#60a5fa');
  const [drawWidth, setDrawWidth] = useState(2);
  // Visible build version: the content-hashed bundle filename served right now,
  // so the user can verify they are running the LATEST deployment (cache proof).
  const [bundleVer] = useState<string>(() => {
    try {
      const s = document.querySelector('script[src*="/assets/index-"]')?.getAttribute('src');
      return s ? s.split('/').pop() || '' : '';
    } catch { return ''; }
  });

  // new UI states
  const [activeTool, setActiveTool] = useState('cursor');
  const [drawLines, setDrawLines] = useState<any[]>([]);
  const drawLinesRef = useRef<any[]>([]);
  drawLinesRef.current = drawLines;
  const [activeIndicators, setActiveIndicators] = useState<Record<string, boolean>>({});
  const [starPos, setStarPos] = useState<{ x: number; y: number } | null>(null);
  const lastTfChangeRef = useRef(0);
  const indicatorSeriesRef = useRef<Record<string, any>>({});
  const [indicatorStyles, setIndicatorStyles] = useState<Record<string, { color: string; width: number }>>({
    rsi: { color: '#f59e0b', width: 2 },
    bb: { color: '#3b82f6', width: 1 },
    vol: { color: '#10b981', width: 1 },
  });

  // Persist chart work place across manual refresh (sessionStorage)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('joseph_chart_ui');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.tf && TIMEFRAMES.includes(s.tf)) setTf(s.tf);
        if (s.activeTool) setActiveTool(s.activeTool);
        if (s.activeIndicators) setActiveIndicators(s.activeIndicators);
        if (s.indicatorStyles) setIndicatorStyles(s.indicatorStyles);
        if (s.drawColor) setDrawColor(s.drawColor);
        if (s.drawWidth) setDrawWidth(s.drawWidth);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem('joseph_chart_ui', JSON.stringify({ tf, activeTool, activeIndicators, indicatorStyles, drawColor, drawWidth }));
    } catch {}
  }, [tf, activeTool, activeIndicators, indicatorStyles, drawColor, drawWidth]);

  const allPropsRef = useRef({ entryPrice, sl, tp, side, trailingActive, onSlChange, onTpChange, openedAt });
  allPropsRef.current = { entryPrice, sl, tp, side, trailingActive, onSlChange, onTpChange, openedAt };
  const livePriceRef = useRef<number | null>(livePrice);
  livePriceRef.current = livePrice;

  const lineDefs = (p = allPropsRef.current) => {
    // When the dynamic trailing stop has kicked in and ratcheted the stop into
    // profit, we recolour the SL line GOLD and relabel it "TS" so the user sees
    // at a glance that the stop is now locking in profit, not a plain risk stop.
    const slIsTrailing = !!p.trailingActive && p.sl != null && p.entryPrice != null && (
      p.side === 'buy' ? p.sl > p.entryPrice : p.sl < p.entryPrice
    );
    return [
      { key: 'entry' as LineKey, price: p.entryPrice, color: '#eab308', title: 'Entry', editable: false },
      { key: 'sl' as LineKey, price: p.sl, color: slIsTrailing ? '#f59e0b' : '#f23645', title: slIsTrailing ? 'TS' : 'SL', editable: true },
      { key: 'tp' as LineKey, price: p.tp, color: '#089981', title: 'TP', editable: true },
    ];
  };

  const updateLines = () => {
    const series = seriesRef.current;
    if (!series) return;
    const pl = priceLinesRef.current;
    for (const def of lineDefs()) {
      const existing = pl[def.key];
      if (def.price != null) {
        try {
          if (!existing) {
            pl[def.key] = series.createPriceLine({
              price: def.price,
              color: def.color,
              lineWidth: 2,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: def.title,
            });
          } else {
            existing.applyOptions({ price: def.price });
          }
        } catch {}
      } else if (existing) {
        try { series.removePriceLine(existing); } catch {}
        pl[def.key] = undefined;
      }
    }
  };

  const syncPositions = () => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const next: { sl?: number; tp?: number } = {};
    for (const k of ['sl', 'tp'] as const) {
      const price = k === 'sl' ? allPropsRef.current.sl : allPropsRef.current.tp;
      if (price == null) continue;
      try {
        const y = series.priceToCoordinate(price);
        if (typeof y === 'number' && isFinite(y)) next[k] = y;
      } catch {}
    }
    if (Object.keys(next).length) setPositions((prev) => ({ ...prev, ...next }));
    // star position - لا تختفي عند تغيير الفريم، تُعاد حسابها فوراً حسب الفريم الحالي
    const ep = allPropsRef.current.entryPrice;
    const at = allPropsRef.current.openedAt;
    if (ep != null && at != null && series) {
      try {
        const y = series.priceToCoordinate(ep);
        if (typeof y !== 'number' || !isFinite(y)) return; // احتفظ بالموضع السابق أثناء التحول
        const atSec = Math.floor(at / 1000);
        let best: any = null, bestDiff = Infinity;
        if (dataRef.current.length) {
          for (const c of dataRef.current) {
            const diff = Math.abs(c.time - atSec);
            if (diff < bestDiff) { bestDiff = diff; best = c.time; }
          }
        }
        const tfSec: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
        let x: number | null = null;
        if (best != null && bestDiff <= (tfSec[tf] || 3600) * 4) {
          try { x = chart.timeScale().timeToCoordinate(best as any); } catch {}
        }
        if (x == null || !isFinite(x) || x < -20) {
          try { x = chart.timeScale().timeToCoordinate(atSec as any); } catch {}
        }
        if (typeof x === 'number' && isFinite(x) && x >= -20) setStarPos({ x, y });
        else {
          // أثناء تغيير الفريم احتفظ بالنجمة 1.2 ثانية لتجنب الاختفاء، وإلا أخفها (خرجت من العرض)
          if (Date.now() - lastTfChangeRef.current < 1200) return;
          setStarPos(null);
        }
      } catch {}
    } else if (ep == null || at == null) setStarPos(null);
  };

  // حافظ على تثبيت النجمة أثناء أي حركة يدوية (pan/zoom) عبر تحديث دوري سريع
  // صفر انحراف: تحديث مستمر عبر RAF لتبقى النجمة مسمّرة تماماً أثناء تحريك السعر
  useEffect(() => {
    if (entryPrice == null || openedAt == null) return;
    let raf = 0;
    const loop = () => { syncPositions(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, openedAt]);

  useEffect(() => { lastTfChangeRef.current = Date.now(); }, [tf]);

  // indicator helpers
  const calcSMA = (data: any[], len: number) => {
    const out: any[] = [];
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i].close;
      if (i >= len) sum -= data[i - len].close;
      if (i >= len - 1) out.push({ time: data[i].time, value: sum / len });
    }
    return out;
  };
  const applyIndicators = () => {
    const chart = chartRef.current;
    const data = dataRef.current;
    if (!chart || !data.length) return;
    Object.values(indicatorSeriesRef.current).forEach((s: any) => { try { chart.removeSeries(s); } catch {} });
    indicatorSeriesRef.current = {};
    const getStyle = (id: string, fallback: string) => {
      const st = indicatorStyles[id];
      return { color: st?.color || fallback, width: st?.width || 2 };
    };
    if (activeIndicators['rsi']) {
      // RSI 14
      const rsi: any[] = [];
      let gains = 0, losses = 0;
      for (let i = 1; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (i <= 14) { if (diff > 0) gains += diff; else losses -= diff; if (i === 14) { const rs = losses === 0 ? 100 : gains / losses; rsi.push({ time: data[i].time, value: 100 - 100 / (1 + rs) }); } }
        else {
          const g = diff > 0 ? diff : 0, l = diff < 0 ? -diff : 0;
          gains = (gains * 13 + g) / 14; losses = (losses * 13 + l) / 14;
          const rs = losses === 0 ? 100 : gains / losses;
          rsi.push({ time: data[i].time, value: 100 - 100 / (1 + rs) });
        }
      }
      const { color, width } = getStyle('rsi', '#f59e0b');
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false });
      s.setData(rsi); indicatorSeriesRef.current['rsi'] = s;
    }
    if (activeIndicators['bb']) {
      const len = 20; const { color, width } = getStyle('bb', '#3b82f6');
      const sma = calcSMA(data, len);
      const up: any[] = [], low: any[] = [];
      for (let i = len - 1; i < data.length; i++) {
        let sumSq = 0; const mean = sma[i - len + 1]?.value; if (mean == null) continue;
        for (let j = i - len + 1; j <= i; j++) sumSq += (data[j].close - mean) ** 2;
        const std = Math.sqrt(sumSq / len);
        up.push({ time: data[i].time, value: mean + 2 * std });
        low.push({ time: data[i].time, value: mean - 2 * std });
      }
      const s1 = chart.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false });
      const s2 = chart.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
      s1.setData(up); s2.setData(low); indicatorSeriesRef.current['bb_up'] = s1; indicatorSeriesRef.current['bb_low'] = s2;
    }
    if (activeIndicators['vol']) {
      const { color, width } = getStyle('vol', '#10b981');
      const s = chart.addSeries(LineSeries, { color, lineWidth: width as any, priceLineVisible: false, lastValueVisible: false });
      // volume proxy: use candle range as pseudo-volume
      s.setData(data.map((c: any) => ({ time: c.time, value: Math.abs(c.close - c.open) * 1000 })));
      indicatorSeriesRef.current['vol'] = s;
    }
  };
  useEffect(() => { applyIndicators(); }, [activeIndicators, indicatorStyles]);

  // create the chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let chart: any;
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;
    try {
      chart = createChart(el, {
        // Explicit sizing driven by our ResizeObserver below (NOT autoSize).
        // autoSize's internal observer fails to recover when the panel is created
        // already collapsed (width 0), which squashed the candles into the corner.
        width: el.clientWidth || 600,
        height: el.clientHeight || 360,
        layout: {
          background: { type: ColorType.Solid, color: '#0b0e14' },
          textColor: '#f59e0b', // yellow on BOTH axes (price + time labels)
          fontFamily: 'inherit',
          // Bigger axis + last-value (current price) labels so the whole scale
          // reads clearly. lightweight-charts has no per-axis font size, so this
          // is global for the few labels the chart draws (price axis, time axis,
          // and the current-price tag).
          fontSize: 18,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.04)' },
          horzLines: { color: 'rgba(255,255,255,0.04)' },
        },
        rightPriceScale: {
          // Amber axis: price labels + border use the app's gold accent.
          borderColor: 'rgba(245,158,11,0.55)',
          borderVisible: true,
          scaleMargins: { top: 0.12, bottom: 0.12 },
          textColor: '#f59e0b', // yellow price-axis labels
          entireTextOnly: false, // اعرض كل تسميات السعر بلا إخفاء
          minimumWidth: 104, // شريط سعر أعرض لاستيعاب خط 18
        },
        timeScale: {
          borderColor: 'rgba(245,158,11,0.55)', // yellow time-axis border
          borderVisible: true,
          timeVisible: true,
          secondsVisible: false,
          // كل التفاصيل دائماً: يوم/شهر/سنة + ساعة:دقيقة على الشريط الزمني.
          tickMarkFormatter: (time: any, _tickMarkType: number, _locale: string) => {
            // يدعم UTCTimestamp (رقم) وBusinessDay ({year,month,day}) وISO string
            let ms = 0;
            if (typeof time === 'number') ms = time * 1000;
            else if (typeof time === 'string') ms = Date.parse(time);
            else if (time && typeof time === 'object') {
              const y = time.year ?? 1970, m = time.month ?? 1, d0 = time.day ?? 1;
              ms = Date.UTC(y, m - 1, d0);
            }
            const d = new Date(ms || 0);
            const dd = String(d.getUTCDate()).padStart(2, '0');
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const yyyy = d.getUTCFullYear();
            const hh = String(d.getUTCHours()).padStart(2, '0');
            const mi = String(d.getUTCMinutes()).padStart(2, '0');
            // tickMarkType (lightweight-charts): 0=سنة 1=شهر 2=يوم 3=ساعة 4=دقيقة
            // كل المستويات دائماً: يوم/شهر/سنة + ساعة:دقيقة (دقائق+ساعات+أيام+شهور).
            // ملاحظة: شموع اليومي+ في Yahoo تحمل توقيت 00:00 UTC لذلك تُعرض 00:00.
            return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
          },
        },
        crosshair: { mode: CrosshairMode.Normal },
      });
      const series = chart.addSeries(CandlestickSeries, {
        // Solid candles (previous house style): solid green up-candles and solid
        // red down-candles, with a matching bright wick for a crisp, clean look.
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
        borderVisible: true,
        // Match the price-axis precision to the instrument's own decimals so the
        // axis and TP/SL labels show EXACTLY the same numeric values as the
        // open-trade row (5 decimals forex, 3 decimals JPY, 2 decimals others).
        // Without this the default 2-decimal axis rounds 1.10095 -> "1.10",
        // making every chart level look smaller than its true value.
        priceFormat: (() => {
          try {
            const rawSym = (symbol || '').includes(':') ? symbol.split(':')[1] : symbol;
            const cfg = getInstrumentConfig(rawSym);
            return {
              type: 'price' as const,
              precision: cfg.decimals,
              minMove: 1 / Math.pow(10, cfg.decimals),
            };
          } catch {
            return { type: 'price' as const, precision: 2, minMove: 0.01 };
          }
        })(),
        autoscaleInfoProvider: (original: any) => {
          const base = original ? original() : null;
          const p = allPropsRef.current;
          const levels = [p.entryPrice, p.sl, p.tp, livePriceRef.current].filter((n) => n != null && isFinite(n as number)) as number[];
          if (!base || !levels.length) return base;
          // Only fold levels into the price scale when they sit within a sane
          // distance of the current candle range. Far-away trade levels (e.g. a
          // wide stop) must NOT stretch the axis, or the candles get squashed
          // into a sliver (or disappear entirely). They still render as lines,
          // just off-screen when out of the visible band, like a native chart.
          const lo = base.priceRange.minValue;
          const hi = base.priceRange.maxValue;
          const span = hi - lo;
          const margin = Number.isFinite(span) && span > 0 ? Math.max(span, Math.abs(hi) * 1e-4) : Math.abs(hi) * 0.02;
          const within = (v: number) => v >= lo - margin && v <= hi + margin;
          const nearby = levels.filter(within);
          if (!nearby.length) return base;
          return {
            priceRange: {
              minValue: Math.min(lo, ...nearby),
              maxValue: Math.max(hi, ...nearby),
            },
          };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      updateLines();
      syncPositions();
      try {
        chart.timeScale().subscribeVisibleTimeRangeChange(syncPositions);
        chart.priceScale('right').subscribeSizeInvalidated(syncPositions);
      } catch {}
      // autoSize only re-measures the container while it has a real layout box.
      // When the panel opens already collapsed (width 0) — e.g. opening a trade's
      // chart straight from the folded list — the chart is created with a 0-width
      // box and autoSize can fail to catch up, leaving the candles squashed into
      // the left corner. A ResizeObserver forces a real re-measure + content fit
      // the instant the container regains a width.
      const refit = () => {
        try {
          const w = el.clientWidth;
          const h = el.clientHeight;
          if (w > 0 && h > 0) {
            chart.applyOptions({ width: w, height: h });
            const d = dataRef.current;
            if (d.length) chart.timeScale().fitContent();
          }
        } catch {}
      };
      try {
        resizeObserver = new ResizeObserver(() => {
          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(refit);
        });
        resizeObserver.observe(el);
      } catch {}
    } catch {
      return;
    }
    return () => {
      try { resizeObserver?.disconnect(); } catch {}
      try { if (rafId) cancelAnimationFrame(rafId); } catch {}
      try { chart?.remove(); } catch {}
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fetch OHLC data when symbol or timeframe changes
  useEffect(() => {
    let cancelled = false;
    const raw = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    fetch(`/api/market-data?symbol=${encodeURIComponent(raw)}&timeframe=${tf}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const result = d?.chart?.result?.[0];
        const ts: number[] | undefined = result?.timestamp;
        const q = result?.indicators?.quote?.[0];
        if (!ts || !q || !q.close) {
          setStatus('empty');
          return;
        }
        let candles: any[] = [];
        for (let i = 0; i < ts.length; i++) {
          const o = q.open?.[i];
          const h = q.high?.[i];
          const l = q.low?.[i];
          const c = q.close?.[i];
          if (o == null || h == null || l == null || c == null) continue;
          candles.push({ time: Math.floor(ts[i]), open: o, high: h, low: l, close: c });
        }
        if (!candles.length) {
          setStatus('empty');
          return;
        }
        candles = sanitizeCandlesForChart(candles);
        dataRef.current = candles;
        try {
          seriesRef.current?.setData(candles);
          const ts = chartRef.current?.timeScale();
          // Wider, elegant candles (was 8 — too thin). Showing ~48 recent bars
          // with a small right margin gives a clean TradingView-like density
          // instead of the old cramped 35-bar squish. The daily timeframe has far
          // fewer bars, so give it a noticeably wider spacing for big, clear
          // candles; the short timeframes keep a tighter density.
          const barSpacing = tf === '1d' ? 16 : 11;
          ts?.applyOptions({ barSpacing });
          const visible = tf === '1d' ? Math.min(40, candles.length) : Math.min(48, candles.length);
          ts?.setVisibleLogicalRange({ from: Math.max(0, candles.length - visible), to: candles.length - 1 + 4 });
        } catch {}
        updateLines();
        syncPositions();
        applyIndicators();
        setStatus('ok');
      })
      .catch(() => {
        if (!cancelled) setStatus('empty');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf]);

  // live price tick - يحرك الشارت حياً ويحدّث الشريط العمودي
  useEffect(() => {
    if (livePrice == null || !seriesRef.current || !dataRef.current.length) return;
    const last = dataRef.current[dataRef.current.length - 1];
    if (!last) return;
    const upd = { ...last, close: livePrice, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice) };
    dataRef.current[dataRef.current.length - 1] = upd;
    try { seriesRef.current.update(upd); } catch {}
  }, [livePrice]);

  // redraw lines when entry/sl/tp change
  useEffect(() => {
    updateLines();
    syncPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, sl, tp, openedAt]);

  // drag SL/TP lines with mouse (window-based)
  useEffect(() => {
    const el = containerRef.current;
    const getSeries = () => seriesRef.current;
    if (!el) return;
    const posY = (e: MouseEvent | PointerEvent) => e.clientY - el.getBoundingClientRect().top;
    const lineYFor = (def: { key: LineKey; price?: number | null }): number | null => {
      if (def.price == null) return null;
      try {
        const y = getSeries()?.priceToCoordinate(def.price);
        if (typeof y === 'number' && isFinite(y)) return y;
      } catch {}
      return null;
    };
    const hitTest = (y: number) => {
      let best: LineKey | null = null;
      let bestDist = 24;
      for (const def of lineDefs()) {
        if (!def.editable) continue;
        const lineY = lineYFor(def);
        if (lineY != null) {
          const d = Math.abs(lineY - y);
          if (d < bestDist) { bestDist = d; best = def.key; }
        }
      }
      return best;
    };
    const nearestForCursor = (y: number) => {
      for (const def of lineDefs()) {
        if (!def.editable) continue;
        const lineY = lineYFor(def);
        if (lineY != null && Math.abs(lineY - y) <= 12) return true;
      }
      return false;
    };
    const onDown = (e: PointerEvent) => {
      if (activeTool !== 'cursor') return;
      if (e.button !== 0) return;
      const y = posY(e);
      const key = hitTest(y);
      if (key) {
        draggingRef.current = key;
        el.style.cursor = 'ns-resize';
        try { e.preventDefault(); } catch {}
      }
    };
    const onMove = (e: PointerEvent | MouseEvent) => {
      const k = draggingRef.current;
      if (k) {
        const y = posY(e);
        let price: number | null = null;
        try { price = getSeries()?.coordinateToPrice(y) as number | null; } catch {}
        if (price == null || !isFinite(price)) return;
        try { priceLinesRef.current[k]?.applyOptions({ price }); } catch {}
        setPositions((prev) => ({ ...prev, [k]: y }));
        if (Date.now() - lastDragSoundRef.current > 90) { playDragTick(); lastDragSoundRef.current = Date.now(); }
        const p = allPropsRef.current;
        if (k === 'sl' && p.onSlChange) p.onSlChange(price);
        else if (k === 'tp' && p.onTpChange) p.onTpChange(price);
      } else {
        try { el.style.cursor = nearestForCursor(posY(e)) ? 'ns-resize' : 'crosshair'; } catch {}
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      el.style.cursor = 'crosshair';
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // overlay handle drag
  const handleDrag = useRef<LineKey | null>(null);
  const onHandleDown = (key: LineKey) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handleDrag.current = key;
    draggingRef.current = key;
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch {}
  };
  const onHandleUp = (key: LineKey) => (e: React.PointerEvent) => {
    if (handleDrag.current === key) handleDrag.current = null;
    draggingRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture?.((e as any).pointerId); } catch {}
  };
  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      const k = handleDrag.current || draggingRef.current;
      if (!k) return;
      const s = seriesRef.current;
      const ov = overlayRef.current;
      const el = containerRef.current;
      const target = ov || el;
      if (!s || !target) return;
      const y = e.clientY - target.getBoundingClientRect().top;
      let price: number | null = null;
      try { price = s.coordinateToPrice(y) as number | null; } catch {}
      if (price == null || !isFinite(price)) return;
      try { priceLinesRef.current[k]?.applyOptions({ price }); } catch {}
      setPositions((prev) => ({ ...prev, [k]: y }));
      if (Date.now() - lastDragSoundRef.current > 90) { playDragTick(); lastDragSoundRef.current = Date.now(); }
      const p = allPropsRef.current;
      if (k === 'sl' && p.onSlChange) p.onSlChange(price);
      else if (k === 'tp' && p.onTpChange) p.onTpChange(price);
    };
    const onWinUp = () => {
      handleDrag.current = null;
      draggingRef.current = null;
    };
    window.addEventListener('pointermove', onWinMove, true);
    window.addEventListener('pointerup', onWinUp, true);
    window.addEventListener('pointercancel', onWinUp, true);
    return () => {
      window.removeEventListener('pointermove', onWinMove, true);
      window.removeEventListener('pointerup', onWinUp, true);
      window.removeEventListener('pointercancel', onWinUp, true);
    };
  }, []);

  // drawing tools click on chart
  const onChartClick = (e: React.MouseEvent) => {
    if (activeTool === 'cursor') return;
    const s = seriesRef.current;
    const el = containerRef.current;
    if (!s || !el) return;
    const y = e.clientY - el.getBoundingClientRect().top;
    const x = e.clientX - el.getBoundingClientRect().left;
    let price: number | null = null;
    try { price = s.coordinateToPrice(y) as number | null; } catch {}
    if (activeTool === 'hline' && price != null) {
      const id = Date.now().toString();
      try {
        const pl = s.createPriceLine({ price, color: drawColor, lineWidth: drawWidth as any, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'H' });
        setDrawLines((prev) => [...prev, { id, type: 'hline', price, line: pl, color: drawColor, width: drawWidth }]);
        playClickSound();
      } catch {}
    } else if (activeTool === 'vline') {
      setDrawLines((prev) => [...prev, { id: Date.now().toString(), type: 'vline', x, color: drawColor, width: drawWidth }]); playClickSound();
    } else if (activeTool === 'arrow') {
      setDrawLines((prev) => [...prev, { id: Date.now().toString(), type: 'arrow', x, y, color: drawColor }]); playClickSound();
    } else if (activeTool === 'trend' || activeTool === 'rect' || activeTool === 'fib') {
      setDrawLines((prev) => [...prev, { id: Date.now().toString(), type: activeTool, x, y, color: drawColor, width: drawWidth }]); playClickSound();
    }
  };

  const clearDrawings = () => {
    const s = seriesRef.current;
    drawLines.forEach((d) => { if (d.line) try { s.removePriceLine(d.line); } catch {} });
    setDrawLines([]);
  };
  const deleteDrawing = (id: string) => {
    playClickSound();
    const s = seriesRef.current;
    const target = drawLines.find((d) => d.id === id);
    if (target?.line) try { s.removePriceLine(target.line); } catch {}
    setDrawLines((prev) => prev.filter((d) => d.id !== id));
  };

  const scrollBy = (dir: number) => {
    try {
      const ts = chartRef.current?.timeScale();
      const lr = ts.getVisibleLogicalRange();
      if (!lr) return;
      const size = lr.to - lr.from;
      ts.setVisibleLogicalRange({ from: lr.from + dir * size * 0.3, to: lr.to + dir * size * 0.3 });
    } catch {}
  };
  const resetView = () => {
    try {
      const ts = chartRef.current?.timeScale();
      const n = dataRef.current.length;
      const lr = ts.getVisibleLogicalRange();
      const size = lr ? lr.to - lr.from : 60;
      const half = size / 2;
      // يضع آخر شمعة في الوسط لرؤية أفضل مع الحفاظ على حجم الشموع
      ts.setVisibleLogicalRange({ from: n - half - 5, to: n + half - 5 });
      syncPositions();
    } catch {
      try { chartRef.current?.timeScale()?.scrollToRealTime(); syncPositions(); } catch {}
    }
  };

  // Zoom candles in/out by scaling barSpacing (px per bar): larger value = bigger
  // candles & fewer visible bars, smaller = more bars. Clamped to a safe range so
  // the chart never collapses or explodes. Independent of horizontal scroll pos.
  const zoom = (dir: number) => {
    try {
      const ts = chartRef.current?.timeScale();
      const cur = ts.options()?.barSpacing ?? (tf === '1d' ? 16 : 11);
      const next = Math.max(3, Math.min(50, dir > 0 ? cur * 1.3 : cur / 1.3));
      ts.applyOptions({ barSpacing: next });
      syncPositions();
    } catch {}
  };

  return (
    // The chart plays its own click/drag ticks, so the global UI click sound is
    // muted here — otherwise every drag over the canvas would double-tick.
    <div className="relative h-full w-full flex flex-col" data-no-click-sound>
      {/* top toolbar: timeframe x2 + drawing tools */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1 bg-[#0b0e14] border-b border-white/5">
        <div className="flex flex-wrap items-center gap-1">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              onClick={() => { playClickSound(); setTf(t); }}
              className={`px-3 py-2 md:px-6 md:py-2.5 rounded-lg text-sm md:text-base font-black uppercase tracking-wide transition-all active:scale-95 hover:scale-[1.02] ${
                tf === t ? 'bg-[#F59E0B] text-black' : 'bg-white/5 text-brand-text/60 hover:bg-white/15 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          {DRAW_TOOLS.map((tl) => (
            <button
              key={tl.id}
              onClick={() => { playClickSound(); setActiveTool((prev) => (prev === tl.id ? 'cursor' : tl.id)); }}
              title={tl.label + ' (اضغط مرة ثانية للإلغاء)'}
              className={`w-11 h-11 rounded-lg flex items-center justify-center text-lg font-bold border-2 transition-all active:scale-90 hover:scale-105 ${activeTool === tl.id ? 'bg-[#F59E0B] text-black border-[#F59E0B]' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'}`}
            >
              {tl.icon}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/10">
            <input type="color" value={drawColor} onChange={(e) => { playClickSound(); setDrawColor(e.target.value); }} title="لون الخط" className="w-8 h-8 rounded cursor-pointer bg-transparent border border-white/20 hover:scale-110 transition-transform" />
            <select value={drawWidth} onChange={(e) => { playClickSound(); setDrawWidth(parseInt(e.target.value)); }} title="سمك الخط" className="bg-[#1a1d26] text-white text-xs rounded border border-white/20 px-1 py-1 cursor-pointer">
              <option value={1}>1px</option><option value={2}>2px</option><option value={3}>3px</option><option value={4}>4px</option><option value={5}>5px</option>
            </select>
          </div>
          <button onClick={() => { playClickSound(); clearDrawings(); }} title="مسح الكل" className="w-11 h-11 rounded-lg flex items-center justify-center text-sm font-black bg-white/5 border-2 border-white/10 text-white/60 hover:bg-white/10 active:scale-90 transition-all">✕</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* left indicators tab - مع تحكم بالحجم واللون */}
        <div className="w-16 bg-[#0b0e14] border-r border-white/5 flex flex-col items-center py-2 gap-1.5">
          <div className="text-[8px] font-black text-white/40 tracking-widest mb-1">المؤشرات</div>
          {INDICATORS.map((ind) => (
            <div key={ind.id} className="flex flex-col items-center gap-1">
              <button
                onClick={() => { playClickSound(); setActiveIndicators((p) => ({ ...p, [ind.id]: !p[ind.id] })); }}
                title={ind.label}
                className={`w-10 h-10 rounded-lg text-[9px] font-black leading-tight flex items-center justify-center border-2 transition-all active:scale-90 hover:scale-105 ${activeIndicators[ind.id] ? 'bg-[#F59E0B] text-black border-[#F59E0B]' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'}`}
              >
                {ind.label}
              </button>
              {activeIndicators[ind.id] && (
                <div className="flex items-center gap-1">
                  <input type="color" value={indicatorStyles[ind.id]?.color || '#f59e0b'} onChange={(e) => { playClickSound(); setIndicatorStyles((p) => ({ ...p, [ind.id]: { color: e.target.value, width: p[ind.id]?.width || 2 } })); }} className="w-5 h-5 rounded cursor-pointer bg-transparent border border-white/20 hover:scale-110 transition-transform" title="لون" />
                  <select value={indicatorStyles[ind.id]?.width || 2} onChange={(e) => { playClickSound(); setIndicatorStyles((p) => ({ ...p, [ind.id]: { color: p[ind.id]?.color || '#f59e0b', width: parseInt(e.target.value) } })); }} className="bg-[#1a1d26] text-white text-[9px] rounded border border-white/20 px-0.5 py-0.5 cursor-pointer">
                    <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option><option value={5}>5</option>
                  </select>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          {status === 'empty' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <span className="text-sm font-bold text-brand-text/40 bg-black/60 px-4 py-2 rounded-lg">
                {symbol} — لا توجد بيانات / no data
              </span>
            </div>
          )}
          <div ref={containerRef} className="h-full w-full" style={{ touchAction: 'none', userSelect: 'none' }} onClick={onChartClick} />
          {/* overlay handles */}
          <div ref={overlayRef} className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 15 }}>
            {typeof positions.sl === 'number' && sl != null && (
              <div onPointerDown={onHandleDown('sl')} onPointerUp={onHandleUp('sl')} onPointerCancel={onHandleUp('sl')} title="اسحب SL" style={{ position: 'absolute', left: 0, right: 36, top: positions.sl - 20, height: 40, pointerEvents: 'auto', cursor: 'ns-resize', background: 'transparent' }} />
            )}
            {typeof positions.tp === 'number' && tp != null && (
              <div onPointerDown={onHandleDown('tp')} onPointerUp={onHandleUp('tp')} onPointerCancel={onHandleUp('tp')} title="اسحب TP" style={{ position: 'absolute', left: 0, right: 36, top: positions.tp - 20, height: 40, pointerEvents: 'auto', cursor: 'ns-resize', background: 'transparent' }} />
            )}
            {/* drawings with per-object delete */}
            {drawLines.filter((d) => d.type === 'vline').map((d) => (
              <div key={d.id} style={{ position: 'absolute', left: d.x, top: 0, bottom: 0, width: d.width || 2, background: d.color || '#60a5fa', opacity: 0.9, pointerEvents: 'none' }}>
                <button onClick={() => deleteDrawing(d.id)} title="حذف" style={{ position: 'absolute', top: 4, left: -10, pointerEvents: 'auto', background: '#1f2937', color: 'white', border: `1px solid ${d.color || '#60a5fa'}`, borderRadius: 6, width: 20, height: 20, fontSize: 10, lineHeight: '18px' }}>✕</button>
              </div>
            ))}
            {drawLines.filter((d) => d.type === 'arrow').map((d) => (
              <div key={d.id} style={{ position: 'absolute', left: d.x - 14, top: d.y - 14, pointerEvents: 'none', color: d.color || '#f59e0b', fontSize: 28 }}>
                ➤
                <button onClick={() => deleteDrawing(d.id)} title="حذف" style={{ position: 'absolute', top: -8, right: -12, pointerEvents: 'auto', background: '#1f2937', color: 'white', border: `1px solid ${d.color || '#f59e0b'}`, borderRadius: 6, width: 18, height: 18, fontSize: 9 }}>✕</button>
              </div>
            ))}
            {drawLines.filter((d) => d.type === 'trend' || d.type === 'rect' || d.type === 'fib').map((d) => (
              <div key={d.id} style={{ position: 'absolute', left: d.x - 12, top: d.y - 12, pointerEvents: 'none', color: d.color || '#a78bfa', fontSize: 26 }}>
                {d.type === 'trend' ? '╱' : d.type === 'rect' ? '▭' : '≋'}
                <button onClick={() => deleteDrawing(d.id)} title="حذف" style={{ position: 'absolute', top: -8, right: -10, pointerEvents: 'auto', background: '#1f2937', color: 'white', border: `1px solid ${d.color || '#a78bfa'}`, borderRadius: 6, width: 18, height: 18, fontSize: 9 }}>✕</button>
              </div>
            ))}
            {drawLines.filter((d) => d.type === 'hline').map((d, idx) => (
              <div key={d.id} style={{ position: 'absolute', right: 6, top: 4 + idx * 22, pointerEvents: 'none' }}>
                <button onClick={() => deleteDrawing(d.id)} title={`حذف خط ${d.price?.toFixed(2) || ''}`} style={{ pointerEvents: 'auto', background: '#1f2937', color: '#60a5fa', border: '1px solid #60a5fa', borderRadius: 6, padding: '2px 6px', fontSize: 10 }}>حذف H ✕</button>
              </div>
            ))}
            {/* yellow flashing star at entry */}
            {starPos && entryPrice != null && (
              <div style={{ position: 'absolute', left: starPos.x - 16, top: starPos.y - 16, pointerEvents: 'none', zIndex: 25 }}>
                <div className="relative w-8 h-8 flex items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75 animate-ping" />
                  <span className="relative text-yellow-400 text-2xl leading-none drop-shadow-[0_0_8px_rgba(250,204,21,0.95)]">★</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* bottom nav: scroll back/forward/reset */}
      <div className="flex items-center justify-center gap-4 py-2 bg-[#0b0e14] border-t border-white/5">
        <span className="text-[10px] text-white/30 font-mono px-2" title="App build (bundle hash)">{bundleVer || 'dev'}</span>
        <button onClick={() => { playClickSound(); zoom(1); }} title="تكبير الشموع" className="w-12 h-10 rounded-lg bg-[#22c55e]/15 border-2 border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e]/25 active:scale-90 transition-all flex items-center justify-center text-2xl font-black">+</button>
        <button onClick={() => { playClickSound(); zoom(-1); }} title="تصغير الشموع" className="w-12 h-10 rounded-lg bg-[#ef4444]/15 border-2 border-[#ef4444]/40 text-[#ef4444] hover:bg-[#ef4444]/25 active:scale-90 transition-all flex items-center justify-center text-2xl font-black">−</button>
        <button onClick={() => { playClickSound(); scrollBy(-1); }} title="للخلف" className="w-14 h-10 rounded-lg bg-white/5 border-2 border-white/10 text-white hover:bg-white/10 active:scale-90 transition-all flex items-center justify-center text-xl">←</button>
        <button onClick={() => { playClickSound(); scrollBy(1); }} title="للأمام" className="w-14 h-10 rounded-lg bg-white/5 border-2 border-white/10 text-white hover:bg-white/10 active:scale-90 transition-all flex items-center justify-center text-xl">→</button>
        <button onClick={() => { playClickSound(); resetView(); }} title="العودة لآخر سعر (مع الحفاظ على الحجم)" className="w-14 h-10 rounded-lg bg-[#F59E0B] text-black font-black flex items-center justify-center text-xl border-2 border-[#F59E0B] active:scale-90 transition-all">↻</button>
      </div>
    </div>
  );
}
