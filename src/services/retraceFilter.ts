import { MarketType, StrategySettings } from '../types';
import { gateProfileFor } from '../constants';

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
 * When the configured category is enabled, the count must be reached AND one
 * of those retrace candles must show liquidity absorption (a sweep of the prior
 * swing extreme followed by a close back inside, with a rejection wick or a
 * volume spike). The current candle direction is only a soft note — it may
 * oppose the trade without hiding it. Missing count OR missing absorption hides
 * the signal as neutral (the filter is the final blocking gate).
 * Forex is enabled by default (3 candles, lenient body counting); all other
 * categories are disabled by default.
 */

export type RetraceCategory = 'forex' | 'crypto' | 'stocks' | 'metals';

export type RetraceSide = 'buy' | 'sell';

export interface RetraceConfig {
  category: RetraceCategory;
  enabled: boolean;
  candles: number;
  timeframe: string;
  strictMode: boolean;
}

export interface RetraceCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  ts?: number;
  /** Optional volume from the feed. FX often sends zero, so price-action
   *  rejection is used as a fallback absorption signal there. */
  volume?: number;
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

  // Strict mode ignores doji, sub-30%-body candles, inside bars, hammers and
  // shooting stars. On daily FX that removes most bars, so the "3 opposite
  // candles" rule became almost impossible to satisfy. The per-category choice
  // now lives in CATEGORY_GATE_PROFILES (FX lenient, others strict).
  const strictMode = gateProfileFor(category).retraceStrict && raw[`retraceStrictMode${suffix}`] !== false;

  return { category, enabled, candles, timeframe, strictMode };
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
      volume: q.volume?.[i] == null ? undefined : Number(q.volume[i]),
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

/**
 * Neutral (non-retrace) candle detection.
 *
 * Always neutral:
 *   - Doji (body ≤ 10% of range) and zero-range candles.
 *
 * Strict mode (default) additionally treats as neutral:
 *   - Spinning top / high-wave (body < 30% of range) — indecision.
 *   - Inside bar (range contained within the next (newer) candle's range) — consolidation.
 *   - Reversal patterns: Hammer (small body on top + long lower wick) and
 *     Shooting Star (small body on bottom + long upper wick) — these are
 *     reversal signals, not pullback candles.
 *
 * A neutral candle is skipped (not counted, does not break the run).
 */
/**
 * LEGACY NOTE ONLY — no longer a blocking condition in the retrace gate.
 * It reports whether the current/forming candle moves WITH the trade direction
 * so the engine can add a soft annotation. An opposing candle is no longer a
 * reason to hide a signal; liquidity absorption on the counted retrace candles
 * is the confirmation instead (see detectLiquidityAbsorption below).
 */
export function currentCandleAligns(
  candles: RetraceCandle[] | null | undefined,
  side: RetraceSide,
): boolean {
  const last = candles?.[candles.length - 1];
  if (!last) return true; // no data → don't block
  if (isDojiCandle(last)) return true; // neutral → don't block
  const dir = last.close > last.open ? 'bullish' : last.close < last.open ? 'bearish' : 'neutral';
  if (dir === 'neutral') return true;
  const wanted = side === 'buy' ? 'bullish' : 'bearish';
  return dir === wanted;
}

export function isNeutralRetraceCandle(
  candle: RetraceCandle,
  nextCandle: RetraceCandle | undefined,
  strict: boolean,
): boolean {
  // Always: doji
  if (isDojiCandle(candle)) return true;

  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  if (!Number.isFinite(range) || range <= 0) return true;

  const bodyRatio = body / range;

  if (!strict) return false; // lenient: only doji is neutral

  // Spinning top / high-wave: small body
  if (bodyRatio < 0.3) return true;

  // Inside bar: contained within the next (newer) candle's range
  if (nextCandle && candle.high <= nextCandle.high + 1e-9 && candle.low >= nextCandle.low - 1e-9) {
    return true;
  }

  // Reversal patterns: hammer (bullish) / shooting star (bearish)
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  // Hammer: small body near top, long lower wick
  if (lowerWick >= 2 * body && upperWick <= body * 0.5 && bodyRatio <= 0.4) return true;
  // Shooting star: small body near bottom, long upper wick
  if (upperWick >= 2 * body && lowerWick <= body * 0.5 && bodyRatio <= 0.4) return true;

  return false;
}

export interface RetraceCountResult {
  found: number;
  required: number;
  confirmed: boolean;
  dojiSkipped: number;
  neutralSkipped: number;
  scanned: number;
  lastCandleSkipped: boolean;
  strictMode: boolean;
  /** Chronological positions of the counted retrace candles, newest first.
   *  Used by the liquidity-absorption confirmation that replaced the old
   *  "signal candle must align" hard gate. */
  indices: number[];
}

/**
 * Count the consecutive retrace candles ending at the most recent CLOSED
 * candle. Neutral candles (doji, and in strict mode also spinning tops,
 * high-waves, inside bars and reversal patterns) are skipped (not counted,
 * do not break the run). The first candle that moves WITH the trade
 * direction stops the count.
 */
export function countRetraceCandles(
  candles: RetraceCandle[] | null | undefined,
  side: RetraceSide,
  required: number,
  opts?: { skipLast?: boolean; strictMode?: boolean },
): RetraceCountResult {
  const req = Math.max(MIN_RETRACE_CANDLES, Math.round(Number(required) || DEFAULT_RETRACE_CANDLES));
  const list = candles || [];
  const skipLast = opts?.skipLast !== false;
  const strict = opts?.strictMode !== false; // default ON
  let i = list.length - 1;
  if (skipLast && i >= 0) i -= 1;

  const wanted: 'bullish' | 'bearish' = side === 'buy' ? 'bearish' : 'bullish';
  let found = 0;
  let dojiSkipped = 0;
  let neutralSkipped = 0;
  let scanned = 0;
  const indices: number[] = [];

  for (; i >= 0; i--) {
    const c = list[i];
    scanned++;
    const next = list[i + 1]; // newer candle (chronological)
    const isDoji = isDojiCandle(c);
    const isNeutral = isNeutralRetraceCandle(c, next, strict);

    if (isNeutral) {
      if (isDoji) dojiSkipped++;
      else neutralSkipped++;
      continue;
    }

    const dir = c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'doji';
    if (dir === 'doji') {
      dojiSkipped++;
      continue;
    }
    if (dir !== wanted) break; // a with-trend candle ends the retrace run
    indices.push(i);
    found++;
    if (found >= req) break;
  }

  return {
    found,
    required: req,
    confirmed: found >= req,
    dojiSkipped,
    neutralSkipped,
    scanned,
    lastCandleSkipped: skipLast && list.length > 0,
    strictMode: strict,
    indices,
  };
}

export interface LiquidityAbsorptionResult {
  detected: boolean;
  /** Position of the absorption candle in the original candle array. */
  candleIndex: number | null;
  side: RetraceSide;
  reasons: string[];
  /** True when a real volume spike confirmed the sweep (FX often has no volume). */
  volumeConfirmed: boolean;
}

/**
 * Liquidity-absorption confirmation for the retrace gate.
 *
 * For a BUY we look for a BEARISH retrace candle whose sell-side liquidity was
 * taken and then absorbed. This is accepted in either of two places:
 *   1. SAME candle: it swept the prior swing low and closed back ABOVE it with
 *      a rejection wick (or elevated volume when the feed has it).
 *   2. NEXT candle (including the forming one): it swept the retrace candle's
 *      low and closed back ABOVE it with a bullish reaction. This is the common
 *      case on short timeframes such as 15m with a 1-candle retrace — checking
 *      only the bearish candle itself missed it and blocked valid signals.
 *
 * A SELL uses the mirror image (bullish retrace candle, swept high, bearish
 * reaction / close back below).
 *
 * This replaced the old hard rule "the current candle must align with the
 * trade". That rule is now only a soft note. The candle direction is allowed
 * to oppose the trade here — the absorbed liquidity is what confirms the
 * start of the correction in the direction of the larger trend.
 */
export function detectLiquidityAbsorption(
  candles: RetraceCandle[] | null | undefined,
  side: RetraceSide,
  indices: readonly number[] | null | undefined,
  lookback = 5,
): LiquidityAbsorptionResult {
  const base: LiquidityAbsorptionResult = {
    detected: false,
    candleIndex: null,
    side,
    reasons: [],
    volumeConfirmed: false,
  };
  const list = candles || [];
  const checks = [...(indices || [])].sort((a, b) => b - a); // newest counted candle first
  if (!checks.length) {
    base.reasons.push('no retrace candles available to check absorption');
    return base;
  }

  const isBuy = side === 'buy';
  for (const idx of checks) {
    const c = list[idx];
    if (!c) continue;
    // The counted candle must still be a genuine retrace candle.
    const isRetraceCandle = isBuy ? c.close < c.open : c.close > c.open;
    if (!isRetraceCandle) continue;

    const prior = list.slice(Math.max(0, idx - lookback), idx).filter(Boolean);
    if (prior.length < 2) continue;
    const extreme = isBuy
      ? Math.min(...prior.map((p) => p.low))
      : Math.max(...prior.map((p) => p.high));

    const priorVols = prior
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgPriorVol = priorVols.length
      ? priorVols.reduce((sum, v) => sum + v, 0) / priorVols.length
      : 0;
    const volumeConfirmed = (v: number | undefined): boolean =>
      typeof v === 'number' && v > 0 && avgPriorVol > 0 && v >= avgPriorVol * 1.2;

    // 1) Same-candle rejection: the retrace candle swept the prior extreme
    //    and closed back inside on a rejection wick / volume spike.
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (body > 0 && range > 0) {
      const swept = isBuy ? c.low < extreme : c.high > extreme;
      const reclaimed = isBuy ? c.close > extreme : c.close < extreme;
      const wick = isBuy
        ? Math.min(c.open, c.close) - c.low
        : c.high - Math.max(c.open, c.close);
      const rejection = wick >= body && wick / range >= 0.35;
      const vol = volumeConfirmed(c.volume);
      if (swept && reclaimed && (rejection || vol)) {
        base.detected = true;
        base.candleIndex = idx;
        base.volumeConfirmed = vol;
        base.reasons.push(
          isBuy
            ? `bearish candle swept the swing low (${extreme.toFixed(5)}) and closed back above it`
            : `bullish candle swept the swing high (${extreme.toFixed(5)}) and closed back below it`,
        );
        base.reasons.push(
          rejection ? 'rejection wick absorbed the liquidity' : 'elevated volume confirmed the absorption',
        );
        return base;
      }
    }

    // 2) Next-candle absorption — the short-timeframe case (15m + 1 candle).
    //    The following candle (possibly still forming) sweeps the retrace
    //    candle's extreme and closes back inside with a with-trend reaction.
    //    Checking only the retrace candle itself missed this and blocked
    //    perfectly valid single-candle pullbacks.
    const confirm = list[idx + 1];
    if (confirm) {
      const sweepLevel = isBuy ? Math.min(c.low, extreme) : Math.max(c.high, extreme);
      const eps = Math.max(Math.abs(sweepLevel), 1) * 1e-6;
      const confBody = Math.abs(confirm.close - confirm.open);
      const confRange = confirm.high - confirm.low;
      const confWick = isBuy
        ? Math.min(confirm.open, confirm.close) - confirm.low
        : confirm.high - Math.max(confirm.open, confirm.close);
      const sweptNext = isBuy
        ? confirm.low <= sweepLevel + eps
        : confirm.high >= sweepLevel - eps;
      const reclaimedNext = isBuy
        ? confirm.close > sweepLevel + eps && confirm.close > confirm.open
        : confirm.close < sweepLevel - eps && confirm.close < confirm.open;
      const rejectionNext =
        confBody > 0 && confRange > 0 && confWick >= confBody && confWick / confRange >= 0.35;
      const mid = (c.open + c.close) / 2;
      const strongClose = isBuy ? confirm.close > mid : confirm.close < mid;
      const volNext = volumeConfirmed(confirm.volume);

      if (sweptNext && reclaimedNext && (rejectionNext || strongClose || volNext)) {
        base.detected = true;
        base.candleIndex = idx + 1;
        base.volumeConfirmed = volNext;
        base.reasons.push(
          isBuy
            ? `next candle swept the bearish retrace low (${sweepLevel.toFixed(5)}) and closed back above it`
            : `next candle swept the bullish retrace high (${sweepLevel.toFixed(5)}) and closed back below it`,
        );
        base.reasons.push(
          rejectionNext
            ? 'rejection wick on the reaction candle absorbed the liquidity'
            : strongClose
              ? 'with-trend close reclaimed the retrace candle body'
              : 'elevated volume confirmed the absorption',
        );
        return base;
      }
    }
  }

  base.reasons.push(
    isBuy
      ? 'no bearish retrace candle had its liquidity absorbed (same or next candle)'
      : 'no bullish retrace candle had its liquidity absorbed (same or next candle)',
  );
  return base;
}
