import React, { useEffect, useRef, useState } from 'react';
import { getCachedQuote, subscribeQuoteBatch } from '../../services/paperTradingService';
import { mobileT } from '../../lib/mobileMode';
import type { Language } from '../../lib/i18n';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  symbol: string;
  /** Live market price (from the shared quote hub) — drawn as the last-price line. */
  livePrice?: number | null;
  /** Open-position levels (price) to draw on the chart — desktop platform parity. */
  slPrice?: number | null;
  tpPrice?: number | null;
  trailingPrice?: number | null;
  lang?: Language;
}

const TF_LIST = ['15m', '1h', '4h', '1d', '1w'];

function fmt(n: number): string {
  return n < 10 ? n.toFixed(4) : n.toFixed(2);
}

/**
 * Mobile candle chart — platform view.
 * Real candles from /api/market-data (same backend as desktop TradingViewWidget)
 * rendered on canvas with a live last-price line. Draws the open-position
 * SL/TP/trailing-stop levels (passed as props, computed in USD via positionMath)
 * so the chart matches the desktop trading platform.
 */
export function MobileCandleChart({ symbol, livePrice, lang }: Props) {
  const isAr = lang === 'ar';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState('1h');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty'>('loading');
  // The live price the chart renders. Kept in state (not a ref) so the canvas
  // effect re-runs when the quote changes and the price line follows the market.
  const [tickPrice, setTickPrice] = useState<number | null>(null);
  // Last live price per symbol — a symbol switch must NOT show the previous
  // symbol's price, so the value is reset the moment the symbol changes.
  const [priceSymbol, setPriceSymbol] = useState<string>(symbol);
  // Canvas width is tracked explicitly so the render effect can depend on it
  // (the canvas must be re-sized when the device rotates or the layout shifts).
  const [width, setWidth] = useState(0);

  // ── Live price feed ────────────────────────────────────────────────────────
  // The chart subscribes to the SAME shared quote hub the rest of the mobile app
  // uses (watchlist / positions / account bar), so there is exactly one batched
  // /api/quotes request per tick for the whole app — no extra polling here.
  useEffect(() => {
    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) return;
    let alive = true;
    // Seed with the hub's cached price so the line appears immediately instead
    // of waiting for the first poll (and so a stale symbol price is never used).
    const cached = getCachedQuote(sym);
    setPriceSymbol(sym);
    setTickPrice(cached != null && cached > 0 ? cached : null);
    const unsub = subscribeQuoteBatch([sym], (batch) => {
      if (!alive) return;
      const p = batch.get(sym);
      if (p != null && p > 0) setTickPrice(p);
    });
    return () => { alive = false; try { unsub(); } catch {} };
  }, [symbol]);

  // The price prop (owned by the parent) wins when it is for the SAME symbol;
  // otherwise the chart's own subscription drives it.
  const effectivePrice = priceSymbol === (symbol || '').trim().toUpperCase()
    ? (livePrice != null && livePrice > 0 ? livePrice : tickPrice)
    : tickPrice;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => setWidth(wrap.clientWidth || 320);
    measure();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(measure);
      ro.observe(wrap);
    } catch {
      window.addEventListener('resize', measure);
    }
    return () => {
      try { ro?.disconnect(); } catch {}
      window.removeEventListener('resize', measure);
    };
  }, []);

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

  // Canvas render: professional chart (desktop parity — TradingViewWidget logic:
  // grid + time axis + live last-price line + entry/SL/TP + trailing display).
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const W = width || wrap.clientWidth || 320;
    const H = 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // Background (same as desktop chart).
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d1117');
    bg.addColorStop(1, '#0b0e14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (!candles.length) {
      ctx.fillStyle = status === 'loading' ? '#00ff88' : '#666';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(status === 'loading' ? (isAr ? 'جاري تحميل الشموع…' : 'Loading candles…') : (isAr ? 'لا توجد شموع' : 'No candles'), W / 2, H / 2);
      return;
    }
    let mn = Infinity, mx = -Infinity;
    for (const c of candles) { mn = Math.min(mn, c.low); mx = Math.max(mx, c.high); }
    // The live price is part of the scale so the last-price line is always
    // visible (and never clipped off the top/bottom of the plot).
    if (effectivePrice != null && isFinite(effectivePrice)) {
      mn = Math.min(mn, effectivePrice); mx = Math.max(mx, effectivePrice);
    }
    const pad = (mx - mn) * 0.12 || mx * 0.01 || 1;
    mn -= pad; mx += pad;
    const plotH = H - 44;
    const y = (p: number) => plotH - ((p - mn) / (mx - mn)) * (plotH - 10) + 4;
    (cv as any)._yToPrice = (py: number) => mn + ((plotH + 4 - py) / (plotH - 10)) * (mx - mn);
    (cv as any)._priceToY = y;
    // ── Grid: horizontal price lines + vertical time lines (desktop-style) ──
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 5; g++) {
      const gp = mn + ((mx - mn) * g) / 5;
      const gy = y(gp);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(W - 48, gy);
      ctx.stroke();
      ctx.fillText(fmt(gp), W - 45, gy + 3);
    }
    const n = candles.length;
    const stepT = Math.max(1, Math.floor(n / 5));
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i += stepT) {
      const c = candles[i];
      const x = 4 + i * ((W - 52) / n) + ((W - 52) / n) / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotH + 4);
      ctx.stroke();
      try {
        const d = new Date(c.time * 1000);
        const lbl = tf === '1d' || tf === '1w'
          ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
          : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText(lbl, Math.min(Math.max(x, 20), W - 66), H - 6);
      } catch {}
    }
    ctx.textAlign = 'left';
    const cw = Math.max(2, Math.min(10, (W - 52) / n - 1));
    const step = (W - 52) / n;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const x = 4 + i * step + step / 2;
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? '#26a69a' : '#ef5350';
      ctx.fillStyle = up ? '#26a69a' : '#ef5350';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y(c.high));
      ctx.lineTo(x, y(c.low));
      ctx.stroke();
      const yo = y(c.open), yc = y(c.close);
      ctx.fillRect(x - cw / 2, Math.min(yo, yc), cw, Math.max(1.5, Math.abs(yc - yo)));
    }
    // ── Live last-price line (desktop-style: live market price, not candle close) ──
    const last = effectivePrice != null ? effectivePrice : candles[candles.length - 1].close;
    const ly = y(last);
    const upLast = last >= candles[candles.length - 1].open;
    ctx.strokeStyle = upLast ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(W - 48, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = upLast ? '#26a69a' : '#ef5350';
    const lbl = fmt(last);
    const tw = ctx.measureText(lbl).width + 8;
    ctx.fillRect(W - 48, ly - 8, 46, 15);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(lbl, W - 44, ly + 3);
    const line = (price: number | null | undefined, color: string, label: string, dashed: boolean) => {
      if (price == null || !isFinite(price)) return;
      const yy = y(price);
      if (yy < 0 || yy > H) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W - 48, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label + ' ' + fmt(price), W - 46, Math.max(10, Math.min(H - 24, yy - 3)));
    };
    // ── Platform-parity levels: SL (red), TP (green), Trailing stop (orange) ──
    line(slPrice, '#ff5550', mobileT(lang!, 'SL', 'وقف'), true);
    line(tpPrice, '#00ff88', mobileT(lang!, 'TP', 'هدف'), true);
    line(trailingPrice, '#ffaa44', mobileT(lang!, 'TS', 'تريلنغ'), true);
    // Redraw only when pixels actually change: candles, timeframe, canvas size,
    // live price, and the SL/TP/trailing levels.
  }, [candles, status, tf, isAr, width, tickPrice, livePrice, slPrice, tpPrice, trailingPrice, lang]);

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
        <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 10, touchAction: 'none', cursor: 'default' }} />
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 6, fontWeight: 600 }}>
        {isAr ? 'شارت مباشر — الشموع من /api/market-data' : 'Live chart — candles from /api/market-data'}
      </div>
    </div>
  );
}
