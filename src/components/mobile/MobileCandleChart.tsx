import React, { useEffect, useRef, useState } from 'react';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  symbol: string;
  entryPrice?: number | null;
  sl?: number | null;
  tp?: number | null;
  side?: 'buy' | 'sell' | null;
  lang?: 'ar' | 'en';
  onSlChange?: (price: number) => void;
  onTpChange?: (price: number) => void;
}

const TF_LIST = ['15m', '1h', '4h', '1d', '1w'];

function fmt(n: number): string {
  return n < 10 ? n.toFixed(4) : n.toFixed(2);
}

/**
 * Mobile candle chart — real candles from /api/market-data (same backend as
 * desktop TradingViewWidget) rendered on canvas, with draggable
 * entry/SL/TP levels (desktop parity: drag the line, level saves to trade).
 */
export function MobileCandleChart({ symbol, entryPrice, sl, tp, side, lang, onSlChange, onTpChange }: Props) {
  const isAr = lang === 'ar';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState('1h');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty'>('loading');
  const [drag, setDrag] = useState<'sl' | 'tp' | null>(null);
  const viewRef = useRef({ entryPrice, sl, tp, side });
  viewRef.current = { entryPrice, sl, tp, side };

  // Fetch candles from the same backend the desktop chart uses.
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setCandles([]);
    fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        try {
          const ts: number[] = d?.chart?.result?.[0]?.timestamp || [];
          const q = d?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
          const out: Candle[] = [];
          for (let i = 0; i < ts.length; i++) {
            const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
            if (o == null || h == null || l == null || c == null) continue;
            out.push({ time: ts[i], open: o, high: h, low: l, close: c });
          }
          if (out.length) { setCandles(out.slice(-120)); setStatus('ok'); }
          else setStatus('empty');
        } catch { setStatus('empty'); }
      })
      .catch(() => { if (alive) setStatus('empty'); });
    return () => { alive = false; };
  }, [symbol, tf]);

  // Canvas render: candles + entry/SL/TP lines (same colors as desktop).
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const W = wrap.clientWidth || 320;
    const H = 260;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W, H);
    if (!candles.length) {
      ctx.fillStyle = '#666';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(status === 'loading' ? '…' : (isAr ? 'لا توجد شموع' : 'No candles'), W / 2, H / 2);
      return;
    }
    let mn = Infinity, mx = -Infinity;
    for (const c of candles) { mn = Math.min(mn, c.low); mx = Math.max(mx, c.high); }
    for (const lv of [entryPrice, sl, tp]) {
      if (lv != null && isFinite(lv)) { mn = Math.min(mn, lv); mx = Math.max(mx, lv); }
    }
    const pad = (mx - mn) * 0.12 || mx * 0.01 || 1;
    mn -= pad; mx += pad;
    const y = (p: number) => H - 14 - ((p - mn) / (mx - mn)) * (H - 34);
    (cv as any)._yToPrice = (py: number) => mn + ((H - 14 - py) / (H - 34)) * (mx - mn);
    (cv as any)._priceToY = y;
    const n = candles.length;
    const cw = Math.max(2, Math.min(10, (W - 46) / n - 1));
    const step = (W - 46) / n;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const x = 4 + i * step + step / 2;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? '#00ff88' : '#ff5555';
      ctx.fillStyle = up ? '#00ff88' : '#ff5555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(c.high));
      ctx.lineTo(x, y(c.low));
      ctx.stroke();
      const yo = y(c.open), yc = y(c.close);
      ctx.fillRect(x - cw / 2, Math.min(yo, yc), cw, Math.max(1.5, Math.abs(yc - yo)));
    }
    const line = (price: number | null | undefined, color: string, label: string, dashed: boolean) => {
      if (price == null || !isFinite(price)) return;
      const yy = y(price);
      if (yy < 0 || yy > H) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W - 44, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label + ' ' + fmt(price), W - 42, Math.max(10, Math.min(H - 4, yy - 3)));
    };
    line(entryPrice, '#e5e7eb', side === 'sell' ? 'S' : 'B', true);
    line(sl, '#ff5555', 'SL', false);
    line(tp, '#00ff88', 'TP', false);
    const last = candles[candles.length - 1].close;
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmt(last), W - 42, Math.max(10, Math.min(H - 4, y(last) + 10)));
  });

  const yToPrice = (clientY: number): number | null => {
    try {
      const cv = canvasRef.current;
      if (!cv) return null;
      const fn = (cv as any)._yToPrice;
      if (typeof fn !== 'function') return null;
      const r = cv.getBoundingClientRect();
      return fn(clientY - r.top);
    } catch { return null; }
  };

  const nearLine = (clientY: number): 'sl' | 'tp' | null => {
    try {
      const cv = canvasRef.current;
      if (!cv) return null;
      const fn = (cv as any)._priceToY;
      if (typeof fn !== 'function') return null;
      const r = cv.getBoundingClientRect();
      const py = clientY - r.top;
      if (sl != null && Math.abs(fn(sl) - py) < 14) return 'sl';
      if (tp != null && Math.abs(fn(tp) - py) < 14) return 'tp';
      return null;
    } catch { return null; }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {TF_LIST.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTf(t)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer',
              border: tf === t ? '1px solid rgba(0,255,136,0.5)' : '1px solid #2a2a2a',
              background: tf === t ? 'rgba(0,255,136,0.12)' : '#0a0a0a',
              color: tf === t ? '#00ff88' : '#888',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', borderRadius: 10, touchAction: 'none', cursor: drag ? 'ns-resize' : 'default' }}
          onPointerDown={(e) => {
            const hit = nearLine(e.clientY);
            if (hit) {
              setDrag(hit);
              try { (e.target as any).setPointerCapture(e.pointerId); } catch {}
            }
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = yToPrice(e.clientY);
            if (p == null || !(p > 0)) return;
            if (drag === 'sl') onSlChange?.(p);
            else onTpChange?.(p);
          }}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
        />
        {drag && (
          <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 11, fontWeight: 800, color: '#ffaa44', background: 'rgba(0,0,0,0.7)', padding: '2px 8px', borderRadius: 6 }}>
            {isAr ? 'اسحب لتغيير ' : 'Dragging '} {drag.toUpperCase()}…
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 6, fontWeight: 600 }}>
        {isAr ? 'اسحب خط SL أو TP على الشارت لتعديله — يُحفظ تلقائياً' : 'Drag the SL / TP line on the chart to adjust — saves automatically'}
      </div>
    </div>
  );
}

