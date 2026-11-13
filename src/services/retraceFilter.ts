import { MarketType, StrategySettings } from '../types';

/**
 * Retrace (pullback) final-confirmation filter.
 *
 * Once every other entry condition has been satisfied, this filter looks at the
 * LAST consecutive candles on a chosen timeframe and counts the ones that move
 * AGAINST the intended trade direction:
 *
 *   BUY  → needs N bearish candles before entry
 *   SELL → needs N bullish candles before entry
 *
 * A doji candle is NEVER counted as a retrace candle (and does not break the
 * run): bearish → doji → bearish → bearish = 3 retrace candles.
 * A candle moving WITH the trade direction ends the run.
 *
 * When the configured category is enabled and the count is reached, the engine
 * promotes the signal to STRONG (final confirmation). When the retrace is not
 * found, the signal is hidden as neutral (the filter is a blocking gate).
 * All categories are disabled by default.
 */

export type RetraceCategory = 'forex' | 'crypto' | 'stocks' | 'metals';

export type RetraceSide = 'buy' | 'sell';

export interface RetraceConfig {
  category: RetraceCategory;
  enabled: boolean;
  candles: number;
  timeframe: string;
}

export interface RetraceCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  ts?: number;
}

export const DEFAULT_RETRACE_CANDLES = 3;
export const DEFAULT_RETRACE_TIMEFRAME = '1d';
export const MIN_RETRACE_CANDLES = 1;
export const MAX_RETRACE_CANDLES = 10;

/** Timeframes offered in the settings UI (any other stored value falls back to 1d). */
export const RETRACE_TIMEFRAMES = ['15m', '30m', '1h', '4h', '1d', '1w', '1M'] as const;

const TF_DURATION_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1M': 31 * 24 * 60 * 60 * 1000, // upper bound — a calendar month is never longer
};

export function retraceCategoryForType(type: MarketType | string): RetraceCategory {
  const t = String(type || '').toLowerCase();
  if (t === 'crypto' || t === 'stocks' || t === 'metals' || t === 'forex') {
    return t as RetraceCategory;
  }
  return 'forex';
}

function categorySuffix(category: RetraceCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Resolve the per-category retrace configuration with safe defaults. */
export function resolveRetraceConfig(
  settings: StrategySettings | undefined,
  type: MarketType | string,
): RetraceConfig {
  const category = retraceCategoryForType(type);
  const suffix = categorySuffix(category);
  const raw: any = settings || {};

  const enabled = raw[`retraceFilterEnabled${suffix}`] === true;

  const storedCount = Number(raw[`retraceCandles${suffix}`]);
  const candles = Number.isFinite(storedCount) && storedCount > 0
    ? Math.max(MIN_RETRACE_CANDLES, Math.min(MAX_RETRACE_CANDLES, Math.round(storedCount)))
    : DEFAULT_RETRACE_CANDLES;

  const storedTf = String(raw[`retraceTimeframe${suffix}`] || '');
  const timeframe = (RETRACE_TIMEFRAMES as readonly string[]).includes(storedTf)
    ? storedTf
    : DEFAULT_RETRACE_TIMEFRAME;

  return { category, enabled, candles, timeframe };
}

/** Extract a clean OHLC(+timestamp) series from any market-data response. */
export function extractRetraceCandles(raw: any): RetraceCandle[] | null {
  const q = raw?.chart?.result?.[0]?.indicators?.quote?.[0];
  const ts: number[] | undefined = raw?.chart?.result?.[0]?.timestamp;
  if (!q?.open || !q?.close) return null;
  const len = q.close.length;
  const out: RetraceCandle[] = [];
  for (let i = 0; i < len; i++) {
    const open = q.open[i];
    const close = q.close[i];
    if (open == null || close == null) continue;
    const high = q.high?.[i];
    const low = q.low?.[i];
    out.push({
      open,
      high: high == null ? Math.max(open, close) : high,
      low: low == null ? Math.min(open, close) : low,
      close,
      ts: ts?.[i] == null ? undefined : ts[i],
    });
  }
  return out.length ? out : null;
}

/**
 * Is the last candle still forming (the live/current candle)? It must not be
 * counted as a completed retrace candle. When the timestamp is unavailable we
 * assume it is live (analysis always runs on the current price).
 */
export function isLastCandleForming(
  candles: RetraceCandle[] | null | undefined,
  timeframe: string,
  now: number = Date.now(),
): boolean {
  const last = candles?.[candles.length - 1];
  if (!last || !last.ts) return true;
  const duration = TF_DURATION_MS[timeframe] || TF_DURATION_MS[DEFAULT_RETRACE_TIMEFRAME];
  // Small 1-minute tolerance so a just-closed bar is treated as closed.
  return now < last.ts + duration - 60 * 1000;
}

/**
 * Doji = a candle whose body is tiny compared with its full range (≤10%).
 * A zero-range candle (open = high = low = close) is also a doji.
 */
export function isDojiCandle(candle: RetraceCandle): boolean {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (!Number.isFinite(range) || range <= 0) {
    return body <= Math.max(Math.abs(candle.close), Math.abs(candle.open), 1) * 1e-9;
  }
  return body / range <= 0.1;
}

export interface RetraceCountResult {
  found: number;
  required: number;
  confirmed: boolean;
  dojiSkipped: number;
  scanned: number;
  lastCandleSkipped: boolean;
}

/**
 * Count the consecutive retrace candles ending at the most recent CLOSED
 * candle. Doji candles are skipped (not counted, do not break the run).
 * The first candle that moves WITH the trade direction stops the count.
 */
export function countRetraceCandles(
  candles: RetraceCandle[] | null | undefined,
  side: RetraceSide,
  required: number,
  opts?: { skipLast?: boolean },
): RetraceCountResult {
  const req = Math.max(MIN_RETRACE_CANDLES, Math.round(Number(required) || DEFAULT_RETRACE_CANDLES));
  const list = candles || [];
  const skipLast = opts?.skipLast !== false;
  let i = list.length - 1;
  if (skipLast && i >= 0) i -= 1;

  const wanted: 'bullish' | 'bearish' = side === 'buy' ? 'bearish' : 'bullish';
  let found = 0;
  let dojiSkipped = 0;
  let scanned = 0;

  for (; i >= 0; i--) {
    const c = list[i];
    scanned++;
    if (isDojiCandle(c)) {
      dojiSkipped++;
      continue;
    }
    const dir = c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'doji';
    if (dir === 'doji') {
      dojiSkipped++;
      continue;
    }
    if (dir !== wanted) break; // a with-trend candle ends the retrace run
    found++;
    if (found >= req) break;
  }

  return {
    found,
    required: req,
    confirmed: found >= req,
    dojiSkipped,
    scanned,
    lastCandleSkipped: skipLast && list.length > 0,
  };
}
