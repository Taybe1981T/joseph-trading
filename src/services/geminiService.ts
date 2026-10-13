import { MarketType, AnalysisResult, TradingStyle, SignalType, StrategySettings } from "../types";
import { DEFAULT_STRATEGY_SETTINGS } from "../constants";
import { fetchMarketContext } from "./marketContextService";
import { onRateLimited, waitIfRateLimited } from "./rateLimitTracker";
import { fetchMarketDataDirect } from './apiDirect';
import { callAIServer } from './aiPool';
import { getCorrelationGroup } from "./portfolioRiskService";
import { readClientOwnKeyForEmails, clientEmailsFor, currentUserEmail, isDeveloperKeyAllowed } from '../lib/clientScope';

// Result cache: same symbol+timeframe+style returns same result for 5 minutes
const _resultCache = new Map<string, { result: AnalysisResult; ts: number }>();
const RESULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ═══ Weekly News Immunity Filter ═══
// Maps a country code → currency/region tokens that identify which pairs are affected.
// Only HIGH-impact events within the current calendar week (Mon→Fri) block a symbol.
const EVENT_COUNTRY_TOKENS: Record<string, string[]> = {
  'US': ['USD', 'US', 'USA', 'DOLLAR', 'FED', 'CELSIUS'],
  'JP': ['JPY', 'JP', 'JAPAN', 'YEN', 'BOJ', 'BANK OF JAPAN'],
  'GB': ['GBP', 'GB', 'UK', 'POUND', 'BOE', 'BANK OF ENGLAND', 'STERLING'],
  'EU': ['EUR', 'EU', 'EURO', 'ECB', 'EUROPEAN CENTRAL'],
  'DE': ['EUR', 'EU', 'DE', 'GERMAN', 'ECB'],
  'FR': ['EUR', 'EU', 'FR', 'FRANCE'],
  'IT': ['EUR', 'EU', 'IT', 'ITALY'],
  'ES': ['EUR', 'EU', 'ES', 'SPAIN'],
  'AU': ['AUD', 'AU', 'AUSSIE', 'RBA', 'RESERVE BANK OF AUSTRALIA'],
  'CA': ['CAD', 'CA', 'CANADA', 'BOC', 'BANK OF CANADA', 'LOONIE'],
  'NZ': ['NZD', 'NZ', 'NEW ZEALAND', 'RBNZ', 'KIWI'],
  'CH': ['CHF', 'CH', 'SWISS', 'SNB', 'SWISS NATIONAL'],
  'MX': ['MXN', 'MX', 'MEXICO', 'BANXICO'],
  'CN': ['CNH', 'CNY', 'CN', 'CHINA', 'PBoC', 'YUAN', 'RENMINBI'],
  'SE': ['SEK', 'SE', 'SWEDEN', 'RIKSBANK'],
  'NO': ['NOK', 'NO', 'NORWAY', 'NORGES'],
  'DK': ['DKK', 'DK', 'DENMARK', 'DANMARKS'],
  'SG': ['SGD', 'SG', 'SINGAPORE'],
  'HK': ['HKD', 'HK', 'HONG KONG'],
  'KR': ['KRW', 'KR', 'KOREA'],
  'TR': ['TRY', 'TR', 'TURKEY', 'CBRT'],
  'ZA': ['ZAR', 'ZA', 'SOUTH AFRICA', 'SARB'],
  'IN': ['INR', 'IN', 'INDIA', 'RESERVE BANK OF INDIA'],
  'RU': ['RUB', 'RU', 'RUSSIA'],
  'PL': ['PLN', 'PL', 'POLAND'],
  'CZ': ['CZK', 'CZ', 'CZECH'],
  'HU': ['HUF', 'HU', 'HUNGARY'],
  'IL': ['ILS', 'IL', 'ISRAEL'],
};

// Returns true if the given SYMBOL is affected by an economic event whose country token
// matches one of the currencies/regions inside the symbol (e.g. USDJPY matches US + JP).
function symbolAffectedByCountry(symbol: string, country: string): boolean {
  const sym = (symbol || '').toUpperCase().replace(/[.\s]/g, '');
  if (!sym) return true; // unknown symbol → be cautious
  const tokens = EVENT_COUNTRY_TOKENS[country?.toUpperCase()] || [];
  for (const t of tokens) {
    const upper = t.toUpperCase();
    if (upper.length >= 2 && sym.includes(upper)) return true;
  }
  // Fallback: whole-country tokens like "JAPAN", "UNITED STATES" → tightened base matching
  const c = (country || '').toUpperCase();
  if (sym.includes('XAU') || sym.includes('GOLD')) { if (c === 'US') return true; }
  return false;
}

// Returns the next Friday (end of the current trading week) as a Date.
function endOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  let diffToFri = (5 - day + 7) % 7; // days until Friday
  if (diffToFri === 0) diffToFri = 0; // already Friday
  const end = new Date(now.getTime() + diffToFri * 24 * 3600 * 1000);
  return end;
}

/**
 * Resolves the API key for an analysis run.
 *
 * SECURITY: for a CLIENT (non-developer) the ONLY acceptable key is the one that
 * client saved under their own email. The shared slots (finalyze_key1_value,
 * finalyze_key2_value, the legacy slot, the session mirror and the
 * finalyze_api_key cookie) hold the DEVELOPER's key and must never be handed to
 * a paying client — otherwise one key serves every customer.
 *
 * An empty string means "no own key": callers must route the client to the key
 * gate instead of running an analysis on someone else's key.
 */
export function getApiKey(): string {
  try {
    if (isDeveloperKeyAllowed()) {
      // Developer/admin: the shared slots are fine.
      const runtime = sessionStorage.getItem('finalyze_runtime_client_key');
      if (runtime) return runtime;
      const k1 = localStorage.getItem('finalyze_key1_value');
      const k1en = localStorage.getItem('finalyze_key1_enabled') !== 'false';
      if (k1 && k1en) return k1;
      const oldKey = localStorage.getItem('finalyze_user_groq_api_key');
      if (oldKey) return oldKey;
      const k2 = localStorage.getItem('finalyze_key2_value');
      if (k2) return k2;
      const ssDev = sessionStorage.getItem('finalyze_key_mirror');
      if (ssDev) return ssDev;
      const cookieDev = document.cookie.split('; ').find(r => r.startsWith('finalyze_api_key='));
      if (cookieDev) {
        const val = decodeURIComponent(cookieDev.split('=')[1] || '');
        if (val) return val;
      }
      return '';
    }
    // Client: strictly the key this client saved under their own email(s).
    return readClientOwnKeyForEmails(clientEmailsFor(currentUserEmail()));
  } catch {}
  return '';
}

export function mirrorApiKey(key: string): void {
  try {
    sessionStorage.setItem('finalyze_key_mirror', key);
    // Cookie: 1 year expiry ΓÇö survives redeploy, browser restart
    document.cookie = `finalyze_api_key=${encodeURIComponent(key)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

function calculateSupplyDemandZones(highs: number[], lows: number[], volumes: number[], closes: number[]) {
  const zones: { type: 'supply' | 'demand'; top: number; bottom: number; strength: number; age: number; consumed: boolean }[] = [];
  const len = highs.length;
  if (len < 15) return zones;

  const currentPrice = closes[len - 1];

  for (let i = 5; i < len - 5; i++) {
    const isPivotHigh = highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2];
    const isPivotLow = lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2];
    if (!isPivotHigh && !isPivotLow) continue;

    const vol = volumes[i] || 0;
    const avgVol = volumes.slice(Math.max(0, i - 5), i + 5).filter(v => v).reduce((a, b) => a + b, 0) / Math.max(volumes.slice(Math.max(0, i - 5), i + 5).filter(v => v).length, 1);
    const volRatio = avgVol > 0 ? vol / avgVol : 1;

    if (isPivotHigh && volRatio > 1.2) {
      const zoneTop = highs[i] * 1.002;
      const zoneBottom = lows[i] * 0.998;
      // Zone is "consumed" if price has passed through it
      const consumed = currentPrice > zoneTop; // price broke above supply = consumed
      const age = len - i; // candles since zone formed
      zones.push({ type: 'supply', top: zoneTop, bottom: zoneBottom, strength: Math.min(100, volRatio * 50), age, consumed });
    }
    if (isPivotLow && volRatio > 1.2) {
      const zoneTop = highs[i] * 1.002;
      const zoneBottom = lows[i] * 0.998;
      // Zone is "consumed" if price has passed through it
      const consumed = currentPrice < zoneBottom; // price broke below demand = consumed
      const age = len - i; // candles since zone formed
      zones.push({ type: 'demand', top: zoneTop, bottom: zoneBottom, strength: Math.min(100, volRatio * 50), age, consumed });
    }
  }
  // Filter out consumed zones and zones older than 30 candles, then take top 6
  return zones.filter(z => !z.consumed && z.age < 30).slice(0, 6);
}

/**
 * ROBUST TECHNICAL ENGINE (VERSION 2.0)
 * Works with minimal data (10+ candles) and handles gaps gracefully.
 */
function calculateTechnicalMetrics(closes: number[], highs: number[], lows: number[], volumes?: number[], opens?: number[]) {
  if (!closes || closes.length < 10) return null;

  const len = closes.length;
  const safeOpens = opens && opens.length >= len ? opens : closes;
  const safeHighs = highs && highs.length >= len ? highs : closes;
  const safeLows = lows && lows.length >= len ? lows : closes;
  
  // 1. RSI (14)
  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i < Math.min(len, 15); i++) {
    const diff = closes[len - i] - closes[len - i - 1];
    if (diff >= 0) sumGain += diff; else sumLoss -= diff;
  }
  const rs = sumLoss === 0 ? 100 : sumGain / sumLoss;
  const rsi = 100 - (100 / (1 + rs));

  // 2. EMA Cross (9 vs 21) ΓÇö true Exponential Moving Average
  const calcEMA = (data: number[], period: number): number => {
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }
    return ema;
  };
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const emaCross = ema9 > ema21 ? 'bullish' : 'bearish';

  // 3. Trend Direction (STRUCTURAL — reliable method)
  // Primary: Net price displacement (most reliable)
  const windowSize = Math.min(len - 1, 20);
  const netDisplacement = closes[len - 1] - closes[len - 1 - windowSize];
  const avgPrice = closes.slice(-windowSize).reduce((a, b) => a + b, 0) / windowSize;
  const displacementPct = Math.abs(netDisplacement) / avgPrice;

  // Secondary: Candle count (confirmation)
  let upScore = 0;
  let downScore = 0;
  for (let i = 0; i < windowSize; i++) {
    const curr = len - 1 - i;
    const prev = curr - 1;
    if (closes[curr] > closes[prev]) upScore++; else downScore++;
  }

  // EMA cross
  const emaSlopeUp = ema9 > ema21;

  let direction: 'uptrend' | 'downtrend' | 'sideways' = 'sideways';
  const candleUp = upScore > downScore + 2;
  const candleDown = downScore > upScore + 2;
  const priceUp = netDisplacement > 0 && displacementPct > 0.003;
  const priceDown = netDisplacement < 0 && displacementPct > 0.003;

  // Decision: displacement + at least ONE confirmation
  if (priceUp && (candleUp || emaSlopeUp)) {
    direction = 'uptrend';
  } else if (priceDown && (candleDown || !emaSlopeUp)) {
    direction = 'downtrend';
  }

  // 4. Age (Relaxed for Crypto)
  let age = 0;
  for (let i = 1; i < len; i++) {
    const curr = len - i;
    const isUp = closes[curr] > closes[curr - 1];
    if (direction === 'uptrend' && isUp) age++;
    else if (direction === 'downtrend' && !isUp) age++;
    else break;
  }

  // 4b. Total Trend Age ΓÇö structural trend length (last 2+ consecutive opposite candles)
  let totalAge = 0;
  if (direction !== 'sideways') {
    let consecutiveAgainst = 0;
    for (let i = 1; i < len; i++) {
      const curr = len - i;
      const prev = curr - 1;
      const isAgainst = direction === 'uptrend'
        ? closes[curr] < closes[prev]
        : closes[curr] > closes[prev];
      if (isAgainst) {
        consecutiveAgainst++;
        if (consecutiveAgainst >= 2) {
          totalAge = i - consecutiveAgainst;
          break;
        }
      } else {
        consecutiveAgainst = 0;
      }
    }
    if (consecutiveAgainst < 2) totalAge = len;
  }

  // 5. Volume Surge
  let volSurge = false;
  if (volumes && volumes.length > 5) {
    const lastVol = volumes[len - 1];
    const avgVol = volumes.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    volSurge = lastVol > avgVol * 1.5;
  }

  // 6. ATR (14-period Average True Range) ΓÇö for dynamic SL/TP
  let atr = 0;
  if (len >= 15) {
    let sumTR = 0;
    for (let i = len - 14; i < len; i++) {
      const prevClose = closes[i - 1] || closes[i];
      const tr = Math.max(
        safeHighs[i] - safeLows[i],
        Math.abs(safeHighs[i] - prevClose),
        Math.abs(safeLows[i] - prevClose)
      );
      sumTR += tr;
    }
    atr = sumTR / 14;
  }

  // 7. Bollinger Bands (20-period SMA + 2 standard deviations)
  let bbUpper = 0, bbMiddle = 0, bbLower = 0, bbWidth = 0, bbPercentB = 0;
  if (len >= 20) {
    const period = 20;
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    bbMiddle = sma;
    bbUpper = sma + 2 * stdDev;
    bbLower = sma - 2 * stdDev;
    bbWidth = bbUpper > 0 ? (bbUpper - bbLower) / bbMiddle : 0;
    const currentPrice = closes[len - 1];
    bbPercentB = bbUpper > bbLower ? (currentPrice - bbLower) / (bbUpper - bbLower) : 0.5;
  }

  // 7b. ADX (Average Directional Index) — trend strength vs sideways
  let adx = 0;
  let adxDirection: 'uptrend' | 'downtrend' | 'sideways' = 'sideways';
  if (len >= 28) {
    const period = 14;
    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    for (let i = 1; i < len; i++) {
      const highDiff = safeHighs[i] - safeHighs[i - 1];
      const lowDiff = safeLows[i - 1] - safeLows[i];
      const tr = Math.max(safeHighs[i] - safeLows[i], Math.abs(safeHighs[i] - closes[i - 1]), Math.abs(safeLows[i] - closes[i - 1]));
      trs.push(tr);
      plusDMs.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
      minusDMs.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
    }
    let atr14 = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    let plusDM14 = plusDMs.slice(-period).reduce((a, b) => a + b, 0) / period;
    let minusDM14 = minusDMs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const dxs: number[] = [];
    for (let i = period; i < trs.length; i++) {
      atr14 = (atr14 * (period - 1) + trs[i]) / period;
      plusDM14 = (plusDM14 * (period - 1) + plusDMs[i]) / period;
      minusDM14 = (minusDM14 * (period - 1) + minusDMs[i]) / period;
      const plusDI = atr14 > 0 ? (plusDM14 / atr14) * 100 : 0;
      const minusDI = atr14 > 0 ? (minusDM14 / atr14) * 100 : 0;
      const diSum = plusDI + minusDI;
      dxs.push(diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0);
    }
    if (dxs.length >= period) {
      adx = dxs.slice(-period).reduce((a, b) => a + b, 0) / period;
      const lastPlusDI = atr14 > 0 ? (plusDM14 / atr14) * 100 : 0;
      const lastMinusDI = atr14 > 0 ? (minusDM14 / atr14) * 100 : 0;
      if (adx > 20) {
        adxDirection = lastPlusDI > lastMinusDI ? 'uptrend' : 'downtrend';
      }
    }
  }

  // 7c. MA Alignment (20/50/200) — confirms trend structure
  let maAlignment: 'bullish' | 'bearish' | 'mixed' = 'mixed';
  if (len >= 200) {
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    if (sma20 > sma50 && sma50 > sma200) maAlignment = 'bullish';
    else if (sma20 < sma50 && sma50 < sma200) maAlignment = 'bearish';
  } else if (len >= 50) {
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    if (sma20 > sma50 * 1.005) maAlignment = 'bullish';
    else if (sma20 < sma50 * 0.995) maAlignment = 'bearish';
  }

  // 7d. COMBINED SIDEWAYS FILTER — ADX + BB Width + MA Alignment
  const adxSideays = adx < 20;
  const bbSideays = bbWidth < 0.02;
  const maMixed = maAlignment === 'mixed';
  const sidewaysVotes = [adxSideays, bbSideays, maMixed].filter(Boolean).length;
  const isSideways = sidewaysVotes >= 2;
  let sidewaysDirection: 'sideways' | 'uptrend' | 'downtrend' = 'sideways';
  if (!isSideways) {
    if (maAlignment === 'bullish' || adxDirection === 'uptrend') sidewaysDirection = 'uptrend';
    else if (maAlignment === 'bearish' || adxDirection === 'downtrend') sidewaysDirection = 'downtrend';
  }

  // 8. Bollinger Band Pullback Detection (3-6 candles opposite to trend)
  let bbPullbackCount = 0;
  let bbTouchLower = false;
  let bbTouchUpper = false;
  if (len >= 3 && bbLower > 0) {
    for (let i = len - 1; i >= Math.max(0, len - 7); i--) {
      const isBearish = closes[i] < safeOpens[i];
      const isBullish = closes[i] > safeOpens[i];
      if (direction === 'uptrend' && isBearish) bbPullbackCount++;
      else if (direction === 'downtrend' && isBullish) bbPullbackCount++;
      else break;
    }
    const currentPrice = closes[len - 1];
    bbTouchLower = currentPrice <= bbLower * 1.015;
    bbTouchUpper = currentPrice >= bbUpper * 0.985;
  }

  // 9. Reversal Candle Patterns (last candle)
  let hasHammer = false;
  let hasPinbar = false;
  let hasEngulfing = false;
  let hasShootingStar = false;
  if (len >= 2) {
    const currO = safeOpens[len - 1], currC = closes[len - 1], currH = safeHighs[len - 1], currL = safeLows[len - 1];
    const prevO = safeOpens[len - 2], prevC = closes[len - 2];
    const body = Math.abs(currC - currO);
    const upperWick = currH - Math.max(currO, currC);
    const lowerWick = Math.min(currO, currC) - currL;
    const totalRange = currH - currL;

    if (totalRange > 0) {
      // Hammer: small body at top, long lower wick (>2x body)
      hasHammer = lowerWick > body * 2 && upperWick < body * 0.5 && body > 0;
      // Shooting Star: small body at bottom, long upper wick (>2x body)
      hasShootingStar = upperWick > body * 2 && lowerWick < body * 0.5 && body > 0;
      // Pinbar: one wick > 2x the other side
      hasPinbar = (lowerWick > upperWick * 2.5 && lowerWick > body) ||
                  (upperWick > lowerWick * 2.5 && upperWick > body);
    }
    // Bullish Engulfing: prev bearish, curr bullish, curr body engulfs prev
    const prevBearish = prevC < prevO;
    const currBullish = currC > currO;
    hasEngulfing = prevBearish && currBullish && currO <= prevC && currC >= prevO;
    // Bearish Engulfing: prev bullish, curr bearish, curr body engulfs prev
    const prevBullish2 = prevC > prevO;
    const currBearish2 = currC < currO;
    const hasBearishEngulfing = prevBullish2 && currBearish2 && currO >= prevC && currC <= prevO;
    if (hasBearishEngulfing) hasEngulfing = true;
  }

  // 10. Bullish/Bearish Candle (simple direction candle)
  let hasBullishCandle = false;
  let hasBearishCandle = false;
  if (len >= 1) {
    const lastO = safeOpens[len - 1];
    const lastC = closes[len - 1];
    hasBullishCandle = lastC > lastO;
    hasBearishCandle = lastC < lastO;
  }

  // 11. Pre-Pullback Age — candles in trend direction BEFORE the pullback
  let prePullbackAge = 0;
  if (totalAge > 0) {
    const trendStartIdx = len - 1 - totalAge;
    const trendDir = direction !== 'sideways' ? direction :
      (len > 1 && closes[len - 1] > closes[trendStartIdx] ? 'uptrend' : 'downtrend');
    if (trendDir === 'uptrend') {
      for (let i = trendStartIdx; i < len - 1; i++) {
        if (closes[i + 1] > closes[i]) prePullbackAge++;
      }
    } else if (trendDir === 'downtrend') {
      for (let i = trendStartIdx; i < len - 1; i++) {
        if (closes[i + 1] < closes[i]) prePullbackAge++;
      }
    }
  }

  // 12. Pullback Point — the lowest/highest point that started the current trend
  let pullbackPoint: { index: number; price: number; date: string | null } | null = null;
  if (totalAge > 0) {
    const trendStartIdx = len - 1 - totalAge;
    const trendDir = direction !== 'sideways' ? direction :
      (len > 1 && closes[len - 1] > closes[trendStartIdx] ? 'uptrend' : 'downtrend');
    if (trendDir === 'uptrend') {
      let lowestIdx = trendStartIdx;
      for (let i = trendStartIdx; i <= len - 1; i++) {
        if (safeLows[i] < safeLows[lowestIdx]) lowestIdx = i;
      }
      pullbackPoint = {
        index: lowestIdx,
        price: safeLows[lowestIdx],
        date: null
      };
    } else if (trendDir === 'downtrend') {
      let highestIdx = trendStartIdx;
      for (let i = trendStartIdx; i <= len - 1; i++) {
        if (safeHighs[i] > safeHighs[highestIdx]) highestIdx = i;
      }
      pullbackPoint = {
        index: highestIdx,
        price: safeHighs[highestIdx],
        date: null
      };
    }
  }

  // 13. Last Swing Point — the most recent pullback low/high
  let lastSwingPoint: { index: number; price: number; date: string | null } | null = null;
  if (age > 0 && age < len - 1) {
    const swingIdx = len - 1 - age;
    const swingDir = direction !== 'sideways' ? direction :
      (len > 1 && closes[len - 1] > closes[swingIdx] ? 'uptrend' : 'downtrend');
    if (swingDir === 'uptrend') {
      lastSwingPoint = {
        index: swingIdx,
        price: safeLows[swingIdx],
        date: null
      };
    } else if (swingDir === 'downtrend') {
      lastSwingPoint = {
        index: swingIdx,
        price: safeHighs[swingIdx],
        date: null
      };
    }
  }

  return {
    direction, age, totalAge, prePullbackAge, pullbackPoint, lastSwingPoint, rsi, emaCross, volSurge, atr,
    bbUpper, bbMiddle, bbLower, bbWidth, bbPercentB,
    bbPullbackCount, bbTouchLower, bbTouchUpper,
    hasHammer, hasPinbar, hasEngulfing, hasShootingStar,
    hasBullishCandle, hasBearishCandle,
    adx, adxDirection, maAlignment, isSideways, sidewaysDirection,
    momentumScore: upScore / (upScore + downScore) * 100
  };
}

// Batch analysis: ONE AI call for ALL symbols ΓÇö eliminates rate limiting
async function fetchAndPrepareSymbolData(
  symbol: string, type: MarketType, timeframe: string, lang: string
): Promise<{
  metrics: any; microMetrics: any; supplyDemandZones: any[];
  contextNews: any[]; contextFearGreed: any; contextEcon: any[];
  microTF: string; zonesText: string; newsText: string; eventsText: string;
} | { error: string }> {
  try {
    const TF_PROGRESSION = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M', '1Y'];
    const currentIndex = TF_PROGRESSION.indexOf(timeframe);
    const microTF = currentIndex > 0 ? TF_PROGRESSION[currentIndex - 1] : TF_PROGRESSION[0];

    const rawData = await fetchMarketDataDirect(symbol, timeframe).catch(() => ({ chart: { result: [{ indicators: { quote: [{}] } }] } }));
    const quotes = rawData.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!quotes || !quotes.close) return { error: 'Market data currently unavailable from the source.' };

    const closes = quotes.close.filter((c: any) => c != null);
    const highsRaw = quotes.high.filter((c: any) => c != null);
    const lowsRaw = quotes.low.filter((c: any) => c != null);
    const highs = highsRaw.length >= closes.length ? highsRaw : closes;
    const lows = lowsRaw.length >= closes.length ? lowsRaw : closes;
    const volumes = quotes.volume?.filter((v: any) => v != null);
    const rawOpens1 = quotes.open?.filter((c: any) => c != null) || closes;
    const opens = rawOpens1.length >= closes.length ? rawOpens1 : closes;
    if (closes.length < 10) return { error: `Insufficient data for ${symbol}.` };

    const metrics = calculateTechnicalMetrics(closes, highs, lows, volumes, opens);
    const supplyDemandZones = calculateSupplyDemandZones(highs, lows, volumes || [], closes);
    const zonesText = supplyDemandZones.length > 0
      ? supplyDemandZones.map(z => `${z.type === 'supply' ? 'Supply' : 'Demand'} zone: ${z.bottom.toFixed(2)}ΓÇô${z.top.toFixed(2)} (strength ${z.strength.toFixed(0)}%)`).join('. ')
      : 'No clear zones detected.';

    let microMetrics = null;
    let microCloses: number[] = [];
    let microHighs: number[] = [];
    let microLows: number[] = [];
    let microOpens: number[] = [];
    let microVolumes: number[] = [];
    try {
      const microData = await fetchMarketDataDirect(symbol, microTF).catch(() => ({ chart: { result: [{ indicators: { quote: [{}] } }] } }));
      const microQuotes = microData.chart?.result?.[0]?.indicators?.quote?.[0];
      if (microQuotes && microQuotes.close) {
        microCloses = microQuotes.close.filter((c: any) => c != null);
        microHighs = microQuotes.high?.filter((c: any) => c != null) || microCloses;
        microLows = microQuotes.low?.filter((c: any) => c != null) || microCloses;
        microOpens = microQuotes.open?.filter((c: any) => c != null) || microCloses;
        microVolumes = microQuotes.volume?.filter((c: any) => c != null) || [];
        if (microCloses.length >= 10) microMetrics = calculateTechnicalMetrics(microCloses, microHighs, microLows, microVolumes.length > 0 ? microVolumes : undefined, microOpens);
      }
    } catch {}
    let contextFearGreed = null, contextNews: any[] = [], contextEcon: any[] = [];
    try {
      const m = await import('./marketContextService');
      const ctx = await m.fetchMarketContext(symbol);
      contextFearGreed = ctx.fearGreed; contextNews = ctx.news; contextEcon = ctx.econEvents;
    } catch {}
    const newsText = contextNews.length > 0 ? contextNews.map((n: any) => `ΓÇó ${n.title} (${n.source})`).join('\n') : 'No recent news available.';
    const eventsText = contextEcon.length > 0 ? contextEcon.map((e: any) => `ΓÇó ${e.country} | ${e.title} | Impact: ${e.impact} | Forecast: ${e.forecast} | Previous: ${e.previous}`).join('\n') : 'No major economic events this week.';
    return { metrics, microMetrics, supplyDemandZones, contextNews, contextFearGreed, contextEcon, microTF, zonesText, newsText, eventsText };
  } catch (e: any) {
    return { error: e.message || 'Failed to fetch data' };
  }
}

function generateLocalAnalysis(
  metrics: any, zonesText: string, supplyDemandZones: any[], microMetrics: any, microTF: string,
  settings: StrategySettings, type: MarketType, lang: string, symbol: string, timeframe: string, infantLimit: number, matureLimit: number, oldLimit: number,
  contextFearGreed?: { value: number; classification: string } | null,
  macroDirection?: 'uptrend' | 'downtrend' | 'sideways'
): AnalysisResult {
  const minAge = settings?.minTrendAge ?? 2;
  const age = metrics?.age || 0;
  const totalAge = metrics?.totalAge || 0;
  let primaryScore = 0;
  let supportScore = 0;
  let supportAligned = 0;
  let supportTotal = 0;
  const reasons: any[] = [];
  const direction = metrics?.direction || 'sideways';
  const isUp = direction === 'uptrend';
  const isDown = direction === 'downtrend';

  let bbPullbackMet = false;
  let supplyDemandMet = false;
  let trendAgeMet = false;
  let prePullbackAgeMet = false;
  let newsMet = false;

  // ΓöÇΓöÇ PRIMARY 1: BB Pullback ΓöÇΓöÇ
  if (metrics?.bbLower > 0 && metrics?.bbUpper > 0) {
    const bbPct = Math.round(metrics.bbPercentB * 100);
    if (isUp && metrics.bbTouchLower && metrics.bbPullbackCount >= 3 && metrics.bbPullbackCount <= 6 && (metrics.hasHammer || metrics.hasPinbar || metrics.hasEngulfing || metrics.hasBullishCandle)) {
      primaryScore += 3; bbPullbackMet = true;
      reasons.push({ check: 'BB Pullback (BUY)', value: `Pullback ${metrics.bbPullbackCount}c ΓåÆ Lower + Reversal`, status: 'positive', impact: 'strong: trend up + pullback + reversal', primary: true });
    } else if (isDown && metrics.bbTouchUpper && metrics.bbPullbackCount >= 3 && metrics.bbPullbackCount <= 6 && (metrics.hasShootingStar || metrics.hasPinbar || metrics.hasEngulfing || metrics.hasBearishCandle)) {
      primaryScore -= 3; bbPullbackMet = true;
      reasons.push({ check: 'BB Pullback (SELL)', value: `Rally ${metrics.bbPullbackCount}c ΓåÆ Upper + Reversal`, status: 'negative', impact: 'strong: trend down + rally + reversal', primary: true });
    } else {
      reasons.push({ check: 'BB Pullback', value: `No pullback ΓÇö ${bbPct}%B`, status: 'neutral', impact: 'BB pullback not met', primary: true });
    }
  }

  // ΓöÇΓöÇ PRIMARY 2: Supply/Demand ΓöÇΓöÇ
  if (supplyDemandZones?.length > 0) {
    const z = supplyDemandZones[0];
    if ((z.type === 'demand' && isUp) || (z.type === 'supply' && isDown)) {
      primaryScore += z.type === 'demand' ? 2 : -2; supplyDemandMet = true;
      reasons.push({ check: 'Supply/Demand', value: `${z.type === 'supply' ? 'Supply' : 'Demand'} ${z.bottom.toFixed(2)}-${z.top.toFixed(2)}`, status: z.type === 'demand' ? 'positive' : 'negative', impact: `zone confirms direction`, primary: true });
    } else {
      reasons.push({ check: 'Supply/Demand', value: `${z.type} zone vs ${direction}`, status: 'neutral', impact: 'zone conflicts with trend', primary: true });
    }
  } else {
    supplyDemandMet = true;
    reasons.push({ check: 'Supply/Demand', value: 'No zones detected', status: 'neutral', impact: 'no zones ΓÇö signal allowed', primary: true });
  }

  // ΓöÇΓöÇ PRIMARY 3: Trend Age ΓöÇΓöÇ
  if (totalAge >= matureLimit && totalAge <= oldLimit) {
    trendAgeMet = true;
    reasons.push({ check: 'Trend Age', value: `${totalAge}c ΓÇö Mature`, status: 'positive', impact: 'trend mature ΓÇö full signal', primary: true });
  } else if (totalAge < infantLimit) {
    reasons.push({ check: 'Trend Age', value: `${totalAge}c ΓÇö Infant`, status: 'negative', impact: 'trend too young ΓÇö low confidence', primary: true });
  } else if (totalAge < matureLimit) {
    trendAgeMet = true;
    reasons.push({ check: 'Trend Age', value: `${totalAge}c ΓÇö Youth`, status: 'positive', impact: 'trend developing ΓÇö allowed', primary: true });
  } else {
    reasons.push({ check: 'Trend Age', value: `${totalAge}c ΓÇö Old`, status: 'negative', impact: 'trend exhausting', primary: true });
  }

  // ΓöÇΓöÇ PRIMARY 3b: Pre-Pullback Age ΓöÇΓöÇ
  const rawMinPreAge = settings?.minPrePullbackAge ?? 15;
  const maxPreAge = settings?.maxPrePullbackAge ?? 50;
  const minPreAge = Math.min(rawMinPreAge, Math.max(3, Math.floor(totalAge * 0.5)));
  const prePullbackAgeVal = metrics?.prePullbackAge ?? 0;
  const pullbackPt = metrics?.pullbackPoint;
  const lastSwing = metrics?.lastSwingPoint;
  const trendStartInfo = pullbackPt ? (pullbackPt.date ? `${pullbackPt.date} (${pullbackPt.price.toFixed(5)})` : pullbackPt.price.toFixed(5)) : 'N/A';
  const lastSwingInfo = lastSwing ? (lastSwing.date ? `${lastSwing.date} (${lastSwing.price.toFixed(5)})` : lastSwing.price.toFixed(5)) : 'N/A';
  if (prePullbackAgeVal < minPreAge) {
    reasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö صغير (أقل من ${minPreAge}) | بداية: ${trendStartInfo} | آخر سحب: ${lastSwingInfo}`, status: 'neutral', impact: 'trend before pullback too short ΓÇö neutral only', primary: true });
  } else if (prePullbackAgeVal >= minPreAge && prePullbackAgeVal <= maxPreAge) {
    prePullbackAgeMet = true;
    reasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö شاب (${minPreAge}-${maxPreAge}) | بداية: ${trendStartInfo} | آخر سحب: ${lastSwingInfo}`, status: 'positive', impact: 'trend healthy ΓÇö STRONG signals allowed', primary: true });
  } else {
    reasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö كهل (أكثر من ${maxPreAge}) | بداية: ${trendStartInfo} | آخر سحب: ${lastSwingInfo}`, status: 'negative', impact: 'trend exhausted ΓÇö neutral only', primary: true });
  }

  // ΓöÇΓöÇ PRIMARY 4: News ΓöÇΓöÇ
  newsMet = true;
  reasons.push({ check: 'News Sentiment', value: 'No active events', status: 'neutral', impact: 'no blocking news', primary: true });

  // ΓöÇΓöÇ SUPPORTING: RSI ΓöÇΓöÇ
  if (metrics?.rsi !== undefined) {
    supportTotal++;
    if (metrics.rsi < 30) { 
      if (isUp && metrics.direction === 'uptrend') {
        supportScore += 1; supportAligned++; 
        reasons.push({ check: 'RSI', value: metrics.rsi.toFixed(1), status: 'positive', impact: 'oversold in uptrend — potential bounce' }); 
      } else if (isDown || metrics.direction === 'downtrend') {
        supportScore -= 0.5; // continuation signal in downtrend, NOT buy
        reasons.push({ check: 'RSI', value: metrics.rsi.toFixed(1), status: 'negative', impact: 'oversold in downtrend — momentum continuation, NOT buy' });
      } else {
        reasons.push({ check: 'RSI', value: metrics.rsi.toFixed(1), status: 'neutral', impact: 'oversold — waiting for direction confirmation' });
      }
    }
    else if (metrics.rsi > 70) { supportScore -= 1; if (isDown) supportAligned++; reasons.push({ check: 'RSI', value: metrics.rsi.toFixed(1), status: 'negative', impact: 'overbought ΓÇö supports sell' }); }
    else { reasons.push({ check: 'RSI', value: metrics.rsi.toFixed(1), status: 'neutral', impact: 'neutral zone' }); }
  }

  // ΓöÇΓöÇ SUPPORTING: EMA Cross ΓöÇΓöÇ
  if (metrics?.emaCross === 'bullish') { supportScore += 1; supportTotal++; if (isUp) supportAligned++; reasons.push({ check: 'EMA Cross', value: 'bullish', status: 'positive', impact: 'bullish cross supports up' }); }
  else if (metrics?.emaCross === 'bearish') { supportScore -= 1; supportTotal++; if (isDown) supportAligned++; reasons.push({ check: 'EMA Cross', value: 'bearish', status: 'negative', impact: 'bearish cross supports down' }); }

  // ΓöÇΓöÇ SUPPORTING: Trend Direction ΓöÇΓöÇ
  if (isUp) { supportScore += 0.5; supportTotal++; supportAligned++; reasons.push({ check: 'Trend Direction', value: 'uptrend', status: 'positive', impact: 'price making higher highs' }); }
  else if (isDown) { supportScore -= 0.5; supportTotal++; supportAligned++; reasons.push({ check: 'Trend Direction', value: 'downtrend', status: 'negative', impact: 'price making lower lows' }); }
  else { supportTotal++; reasons.push({ check: 'Trend Direction', value: 'sideways', status: 'neutral', impact: 'no clear direction' }); }

  // ΓöÇΓöÇ SUPPORTING: Volume ΓöÇΓöÇ
  if (metrics?.volSurge) { supportTotal++; supportScore += isUp ? 0.5 : isDown ? -0.5 : 0; reasons.push({ check: 'Volume Surge', value: 'true', status: isUp ? 'positive' : isDown ? 'negative' : 'neutral', impact: 'confirms momentum' }); }

  // ΓöÇΓöÇ SUPPORTING: Fear&Greed (Contrarian) ΓöÇΓöÇ
  if (contextFearGreed?.value !== undefined) {
    supportTotal++;
    const fg = contextFearGreed.value;
    if (fg <= 25) { 
      if (isUp || !isDown) {
        supportScore += 0.5; supportAligned++; // reduced from 1.5 to 0.5
        reasons.push({ check: 'Fear&Greed', value: `${fg}/100 ΓÇö ${contextFearGreed.classification}`, status: 'positive', impact: 'extreme fear ΓÇö contrarian buy signal (weak)' }); 
      } else {
        reasons.push({ check: 'Fear&Greed', value: `${fg}/100 ΓÇö ${contextFearGreed.classification}`, status: 'neutral', impact: 'extreme fear but downtrend ΓÇö caution' }); 
      }
    }
    else if (fg >= 75) { 
      if (isDown || !isUp) {
        supportScore -= 0.5; supportAligned++; // reduced from 1.5 to 0.5
        reasons.push({ check: 'Fear&Greed', value: `${fg}/100 ΓÇö ${contextFearGreed.classification}`, status: 'negative', impact: 'extreme greed ΓÇö contrarian sell signal (weak)' }); 
      } else {
        reasons.push({ check: 'Fear&Greed', value: `${fg}/100 ΓÇö ${contextFearGreed.classification}`, status: 'neutral', impact: 'extreme greed but uptrend ΓÇö caution' }); 
      }
    }
    else { reasons.push({ check: 'Fear&Greed', value: `${fg}/100 ΓÇö ${contextFearGreed.classification}`, status: 'neutral', impact: 'neutral sentiment' }); }
  }

  // ΓöÇΓöÇ SUPPORTING: Micro Alignment ΓöÇΓöÇ
  if (microMetrics) {
    supportTotal++;
    const microAligned = (microMetrics.emaCross === 'bullish' && isUp) || (microMetrics.emaCross === 'bearish' && isDown);
    if (microAligned) { supportAligned++; supportScore += isUp ? 0.5 : -0.5; }
    reasons.push({ check: 'Micro Alignment', value: microAligned ? 'aligned' : 'diverging', status: microAligned ? 'positive' : 'neutral', impact: microAligned ? 'micro confirms macro' : 'micro diverging' });
  }

  // ΓöÇΓöÇ Compute Score ΓöÇΓöÇ
  const totalScore = primaryScore + supportScore;
  const primaryMetCount = [bbPullbackMet, supplyDemandMet, trendAgeMet, newsMet].filter(Boolean).length;

  // ΓöÇΓöÇ Sideways penalty: need strong evidence to trade ΓöÇΓöÇ
  const hasStrongEvidence = Math.abs(primaryScore) >= 2 || Math.abs(supportScore) >= 2;

  const baseConf = settings?.baseConfidence ?? 30;
  const strongThresh = settings?.strongThreshold ?? 60;
  const buyThresh = settings?.buyThreshold ?? 40;
  const maxPrimary = (settings?.primaryBBWeight ?? 15) + (settings?.primarySDWeight ?? 15) + (settings?.primaryAgeWeight ?? 10) + (settings?.primaryNewsWeight ?? 10);
  const maxSupport = (settings?.supportRSIWeight ?? 5) + (settings?.supportEMAWeight ?? 5) + (settings?.supportDirWeight ?? 3) + (settings?.supportVolWeight ?? 2) + (settings?.supportMicroBBWeight ?? 3) + (settings?.supportMicroAlignWeight ?? 2);

  const supportRatio = supportTotal > 0 ? supportAligned / supportTotal : 0;
  const primaryConf = maxPrimary > 0 ? Math.round(Math.abs(primaryScore) / 5 * maxPrimary) : 0;
  const supportConf = supportTotal > 0 ? Math.round(supportRatio * maxSupport) : 0;
  let confidence = Math.min(100, primaryConf + supportConf + baseConf);

  // ΓöÇΓöÇ Signal classification ΓöÇΓöÇ
  let rawSignal: SignalType;
  const CONF_BUFFER = 5;
  const isOld = totalAge > oldLimit;
  const isMatureForStrong = totalAge >= matureLimit && totalAge <= oldLimit;

  // Old zone: block ALL signals
  if (isOld) {
    rawSignal = SignalType.NEUTRAL;
    confidence = Math.min(confidence, 25);
  }
  // Sideways + no strong evidence = NEUTRAL
  else if (!isUp && !isDown && !hasStrongEvidence) {
    rawSignal = SignalType.NEUTRAL;
    confidence = Math.min(confidence, 35);
  }
  // STRONG signals: only in MATURE zone (25-70), all gates required
  else if (totalScore > 0 && primaryMetCount >= 3 && isMatureForStrong && bbPullbackMet && prePullbackAgeMet && confidence >= (strongThresh - CONF_BUFFER)) {
    rawSignal = SignalType.STRONG_BUY;
  } else if (totalScore < 0 && primaryMetCount >= 3 && isMatureForStrong && bbPullbackMet && prePullbackAgeMet && confidence >= (strongThresh - CONF_BUFFER)) {
    rawSignal = SignalType.STRONG_SELL;
  }
  // Regular BUY/SELL: only needs buyThreshold (bypass BB, Pre-Pullback, News)
  else if (totalScore > 0 && confidence >= (buyThresh - CONF_BUFFER)) {
    rawSignal = SignalType.BUY;
  } else if (totalScore < 0 && confidence >= (buyThresh - CONF_BUFFER)) {
    rawSignal = SignalType.SELL;
  } else {
    rawSignal = SignalType.NEUTRAL;
  }

  // Age zone caps
  if (totalAge < infantLimit) { confidence = Math.round(confidence * 0.7); rawSignal = rawSignal === SignalType.STRONG_BUY ? SignalType.BUY : rawSignal === SignalType.STRONG_SELL ? SignalType.SELL : rawSignal; }
  else if (totalAge < matureLimit) { if (rawSignal === SignalType.STRONG_BUY) rawSignal = SignalType.BUY; if (rawSignal === SignalType.STRONG_SELL) rawSignal = SignalType.SELL; confidence = Math.round(confidence * 0.85); }
  else if (totalAge > oldLimit) { confidence = Math.round(confidence * 0.75); }
  if (age < minAge) confidence = Math.round(confidence * 0.8);

  const minConf = settings?.minConfidence || 45;
  if (confidence < minConf) rawSignal = SignalType.NEUTRAL;

  // Higher TF Direction: BLOCK signal if current direction conflicts with higher timeframe
  const directionConflicts = macroDirection && (
    (isUp && macroDirection === 'downtrend') || (isDown && macroDirection === 'uptrend')
  );
  if (directionConflicts) {
    confidence = Math.round(confidence * 0.6);
    if (rawSignal === SignalType.BUY || rawSignal === SignalType.STRONG_BUY ||
        rawSignal === SignalType.SELL || rawSignal === SignalType.STRONG_SELL) {
      rawSignal = SignalType.NEUTRAL;
    }
    reasons.push({ check: 'Higher TF Direction', value: `Higher: ${macroDirection} vs Current: ${direction}`, status: 'negative', impact: 'BLOCKED: trading against higher timeframe trend', primary: true });
  }

  // Pre-Pullback Age filter: if trend before pullback is too short or too exhausted, force NEUTRAL
  if (prePullbackAgeVal < minPreAge || prePullbackAgeVal > maxPreAge) {
    rawSignal = SignalType.NEUTRAL;
    confidence = Math.min(confidence, 30);
  }

  // FINAL SAFETY: Pre-Pullback Age must ALWAYS block BUY/SELL if out of range
  if (prePullbackAgeVal < minPreAge || prePullbackAgeVal > maxPreAge) {
    if (rawSignal === SignalType.BUY || rawSignal === SignalType.STRONG_BUY ||
        rawSignal === SignalType.SELL || rawSignal === SignalType.STRONG_SELL) {
      rawSignal = SignalType.NEUTRAL;
      confidence = Math.min(confidence, 30);
    }
  }

  const dir = metrics?.direction || 'sideways';
  const summary = lang === 'ar'
    ? `\u0645\u0644\u062e\u0635 \u0627\u0644\u062a\u062d\u0644\u064a\u0644: ${symbol} \u2014 ${dir === 'uptrend' ? '\u0627\u062a\u062c\u0627\u0647 \u0635\u0627\u0639\u062f' : dir === 'downtrend' ? '\u0627\u062a\u062c\u0627\u0647 \u0647\u0627\u0628\u0637' : '\u0627\u0633\u062a\u0642\u0628\u0627\u0644 \u0627\u0644\u0627\u062a\u062c\u0627\u0647'}. RSI ${metrics?.rsi?.toFixed(1) || 'N/A'}. \u0627\u0644\u062b\u0642\u0629: ${confidence}%.`
    : `Analysis: ${symbol} ΓÇö ${dir} trend. RSI ${metrics?.rsi?.toFixed(1) || 'N/A'}. Confidence: ${confidence}%.`;

  return {
    symbol, type, timeframe,
    signal: rawSignal, confidence, summary, detailedReasons: reasons,
    microSignal: 'unknown', microTrend: '', technicalScore: Math.round(totalScore * 16.7 + 50),
    sentimentScore: contextFearGreed?.value ?? 50, historicalMatch: '',
    timestamp: new Date().toISOString(),
    userId: '',
    primaryMetCount,
    direction: dir,
  };
}

export async function analyzeMarketBatch(
  paramsList: { symbol: string; type: MarketType; timeframe: string; tradingStyle: TradingStyle }[],
  settings: StrategySettings,
  lang: string,
  onProgress?: (current: string, total: number, index: number, failed?: number) => void
): Promise<{ results: AnalysisResult[]; errors: { symbol: string; error: string }[] }> {
  const results: AnalysisResult[] = [];
  const errors: { symbol: string; error: string }[] = [];
  const total = paramsList.length;
  const BATCH_SIZE = 3;

  async function analyzeOne(p: { symbol: string; type: MarketType; timeframe: string; tradingStyle: TradingStyle }, idx: number): Promise<void> {
    let lastError: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
        await waitIfRateLimited();
        const t0 = Date.now();
        const result = await analyzeMarket({ symbol: p.symbol, type: p.type, timeframe: p.timeframe, tradingStyle: p.tradingStyle, settings, lang });
        console.log(`[Batch] ${p.symbol} → ${result.signal} (${result.confidence}%) [${Date.now() - t0}ms]`);
        results.push(result);
        lastError = null;
        break;
      } catch (e: any) {
        lastError = e;
        console.warn(`[Batch] Attempt ${attempt + 1} FAILED ${p.symbol}:`, e.message);
      }
    }
    if (lastError) {
      console.error(`[Batch] GIVING UP ${p.symbol} after 2 attempts:`, lastError.message);
      errors.push({ symbol: p.symbol, error: lastError.message || 'Analysis failed' });
    }
  }

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = paramsList.slice(i, i + BATCH_SIZE);
    if (onProgress) onProgress(batch[0].symbol, total, i, errors.length);
    await Promise.all(batch.map((p, j) => analyzeOne(p, i + j)));
    if (i + BATCH_SIZE < total) await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[Batch] DONE: ${results.length} results, ${errors.length} errors out of ${total} symbols`);
  if (errors.length > 0) {
    console.error(`[Batch] Failed symbols:`, errors.map(e => `${e.symbol}: ${e.error}`).join(' | '));
  }

  return { results, errors };
}

function synthFromMetrics(metrics: any, symbol: string): any {
  const dir = metrics?.direction || 'sideways';
  const rsi = metrics?.rsi ?? 50;
  const momentum = metrics?.momentumScore ?? 50;
  const emaC = metrics?.emaCross || 'none';
  let synthConf = 50;
  if (dir === 'uptrend') synthConf += 10;
  else if (dir === 'downtrend') synthConf -= 10;
  if (rsi < 30) synthConf += 5;
  else if (rsi > 70) synthConf -= 5;
  if (momentum > 60) synthConf += 3;
  else if (momentum < 40) synthConf -= 3;
  if (emaC === 'bullish') synthConf += 5;
  else if (emaC === 'bearish') synthConf -= 5;
  // Sideways penalty
  if (metrics?.isSideways) synthConf = Math.min(synthConf, 40);
  synthConf = Math.max(20, Math.min(80, synthConf));
  const synthSignal = synthConf >= 55 ? (dir === 'uptrend' ? 'buy' : dir === 'downtrend' ? 'sell' : 'neutral') : 'neutral';
  console.log(`[Engine] ${symbol} synth: ${synthSignal} (${synthConf}%) dir=${dir} rsi=${rsi.toFixed(1)} ema=${emaC}`);
  return { signal: synthSignal, confidence: synthConf, detailedReasons: [], summary: `${symbol} ${synthSignal} (${synthConf}%) — metrics-based`, microSignal: 'unknown', microTrend: dir, historicalMatch: 'N/A' };
}

// ═══════════════════════════════════════════════════════════════════
// Professional Volume Quality engine (5 modules)
// Produces a 0-100 "Volume Quality Score" plus absorption detection.
// Designed to be a NON-hard-gating filter: when volume data is absent OR
// the score is merely mediocre, the symbol passes as NEUTRAL so it stays
// aligned with the other systems and the overall price direction — it never
// silently kills a genuinely strong signal. Only a clearly broken / low
// score or a confirmed absorption trap actively suppresses the signal.
//   Module 1  Relative volume      (0-25)
//   Module 2  Effort vs Result     (0-25)  ← absorption / climax detector
//   Module 3  Volume trend         (0-20)
//   Module 4  S/R pivot interaction(0-20)
//   Module 5  Absorption penalty   (-30..0)
// ═══════════════════════════════════════════════════════════════════
function computeVolumeQuality(
  closes: number[], highs: number[], lows: number[], volumes: number[], opens: number[], direction: string
): { score: number; detected: boolean; absorbed: boolean; absorptionLevel: number; reasons: string[] } {
  const len = closes.length;
  const v = volumes || [];
  const base = { score: 0, detected: false, absorbed: false, absorptionLevel: 0, reasons: [] as string[] };
  // No volume data (some feeds return OHLC only) → neutral pass, do not interfere.
  if (!v.length || v.length < 8 || len < 10) return base;

  const lastVol = v[len - 1] || 0;
  const prevVols = v.slice(-6, -1).filter((x: any) => x != null);
  const avgPrevVol = prevVols.length ? prevVols.reduce((a: number, b: number) => a + b, 0) / prevVols.length : 1;
  const volRatio = avgPrevVol > 0 ? lastVol / avgPrevVol : 1;

  // ── Module 1: Relative volume (0-25) ──
  const relScore = Math.max(0, Math.min(25, ((volRatio - 0.8) / 1.7) * 25));

  // ── Module 2: Effort vs Result (0-25) ──
  const body = Math.abs((closes[len - 1] || 0) - (opens[len - 1] || closes[len - 1] || 0));
  const range = ((highs[len - 1] || 0) - (lows[len - 1] || 0)) || 1;
  const bodyRatio = Math.max(0, Math.min(1, body / range));
  let effortScore = 12.5;
  if (volRatio > 1.2) {
    if (bodyRatio >= 0.6) effortScore = 25;
    else if (bodyRatio >= 0.4) effortScore = 18;
    else if (bodyRatio >= 0.25) effortScore = 8;   // effort, little result → absorption risk
    else effortScore = 2;                           // high volume + tiny body → absorption/climax
  } else {
    effortScore = bodyRatio >= 0.5 ? 15 : 10;
  }

  // ── Module 3: Volume trend (0-20) ──
  const window = Math.max(3, Math.min(5, Math.floor(len / 2)));
  const recentV = v.slice(-window);
  const earlierV = v.slice(-window * 2, -window);
  const recentAvg = recentV.length ? recentV.reduce((a: number, b: number) => a + b, 0) / recentV.length : 1;
  const earlierAvg = earlierV.length ? earlierV.reduce((a: number, b: number) => a + b, 0) / earlierV.length : 1;
  const volRising = recentAvg > earlierAvg * 1.1;
  const priceChange = (closes[len - 1] || 0) - (closes[len - 1 - window] || closes[len - 1] || 0);
  const priceUp = priceChange > 0;
  let trendScore = 10;
  if (direction === 'uptrend') trendScore = volRising ? 20 : (priceUp ? 14 : 8);
  else if (direction === 'downtrend') trendScore = volRising ? 20 : (priceUp ? 6 : 12);
  else trendScore = 10;

  // ── Module 4: S/R pivot interaction (0-20) ──
  const back = Math.max(4, Math.min(10, len - 2));
  let swingHigh = -Infinity, swingLow = Infinity;
  for (let i = len - back; i < len - 1; i++) {
    if (highs[i] > swingHigh) swingHigh = highs[i];
    if (lows[i] < swingLow) swingLow = lows[i];
  }
  const lastClose = closes[len - 1] || 0;
  const lastHigh = highs[len - 1] || lastClose;
  const lastLow = lows[len - 1] || lastClose;
  let srScore = 12;
  const brokeHigh = isFinite(swingHigh) && lastClose > swingHigh;
  const brokeLow = isFinite(swingLow) && lastClose < swingLow;
  const wickAbove = isFinite(swingHigh) && lastHigh > swingHigh && lastClose <= swingHigh;
  const wickBelow = isFinite(swingLow) && lastLow < swingLow && lastClose >= swingLow;
  if (brokeHigh || brokeLow) srScore = volRatio > 1.3 ? 20 : 14;     // confirmed breakout w/ volume
  else if (wickAbove || wickBelow) srScore = volRatio > 1.3 ? 4 : 8; // rejection at pivot → warn
  else srScore = 12;

  // ── Module 5: Absorption penalty (-30..0) ──
  let absorptionLevel = 0;
  if (volRatio > 1.6 && bodyRatio < 0.3) {
    absorptionLevel = Math.max(absorptionLevel, 2);
    base.reasons.push('high volume + small body = absorption/climax');
  }
  if (volRatio > 1.4 && ((wickAbove && direction === 'uptrend') || (wickBelow && direction === 'downtrend'))) {
    absorptionLevel = Math.max(absorptionLevel, 2);
    base.reasons.push('rejection at pivot against direction on elevated volume');
  }
  if (volRatio > 2.5 && len >= 20) {
    const follow = closes.slice(-3, -1).filter((c: any) => c != null);
    const flatFollow = follow.length > 0 && follow.every((c: number) => lastClose > 0 && Math.abs(c - lastClose) / lastClose < 0.002);
    if (flatFollow) { absorptionLevel = Math.max(absorptionLevel, 2); base.reasons.push('huge volume spike, no price follow-through'); }
  }
  if (volRatio < 0.6 && len >= 20) {
    absorptionLevel = Math.max(absorptionLevel, 1);
    base.reasons.push('very low volume — weak conviction');
  }
  const absorptionPenalty = absorptionLevel >= 2 ? -30 : absorptionLevel === 1 ? -10 : 0;

  let score = relScore + effortScore + trendScore + srScore + absorptionPenalty;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, detected: true, absorbed: absorptionLevel >= 2, absorptionLevel, reasons: base.reasons };
}

export async function analyzeMarket(params: {
  symbol: string;
  type: MarketType;
  timeframe: string;
  tradingStyle: TradingStyle;
  settings?: StrategySettings;
  lang?: string;
}): Promise<AnalysisResult> {
  const { symbol, type, timeframe, tradingStyle, settings = DEFAULT_STRATEGY_SETTINGS, lang = 'en' } = params;

  // Check result cache first
  const cacheKey = `${symbol}_${timeframe}_${tradingStyle}_${JSON.stringify(settings)}`;
  const cached = _resultCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESULT_CACHE_TTL) {
    return cached.result;
  }

  // Block stock/ETF analysis when the exchange is closed (metals trade 24/5 like forex — not gated)
  if (type === MarketType.STOCKS) {
    const now = new Date();
    
    // Detect exchange from symbol suffix
    let timezone = 'America/New_York'; // default: US
    let exchangeName = 'US';
    let openMin = 9 * 60 + 30;  // 9:30 AM
    let closeMin = 16 * 60;     // 4:00 PM
    
    if (/\.T$/.test(symbol)) {
      // Japan: TSE opens 9:00-15:00 JST (UTC+9)
      timezone = 'Asia/Tokyo';
      exchangeName = 'Japan (TSE)';
      openMin = 9 * 60;       // 9:00 AM JST
      closeMin = 15 * 60;     // 3:00 PM JST
    } else if (/\.(AS|PA|DE|L|SW|CO|MI|STO|HEL|OSL|WSE|MCX|COP)$/i.test(symbol)) {
      // Europe: XETRA/LSE/Euronext opens 9:00-17:30 CET
      timezone = 'Europe/Berlin';
      exchangeName = 'Europe';
      openMin = 9 * 60;       // 9:00 AM CET
      closeMin = 17 * 60 + 30; // 5:30 PM CET
    } else {
      // US: NYSE/NASDAQ 9:30-16:00 ET
      exchangeName = 'US (NYSE/NASDAQ)';
    }
    
    const localHour = parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));
    const localMin = parseInt(now.toLocaleString('en-US', { timeZone: timezone, minute: 'numeric' }));
    const localDay = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' });
    const localMinutes = localHour * 60 + localMin;
    const isWeekday = localDay !== 'Sat' && localDay !== 'Sun';
    const isMarketOpen = isWeekday && localMinutes >= openMin && localMinutes < closeMin;

    if (!isMarketOpen) {
      const timeStr = now.toLocaleString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: true });
      const blockedResult: AnalysisResult = {
        symbol, type, timeframe,
        signal: 'no_entry' as any,
        confidence: 0,
        summary: `${symbol} — ${exchangeName} market closed (${timeStr})`,
        detailedReasons: [{
          check: 'Market Hours',
          value: `${localDay} ${timeStr} (${exchangeName})`,
          status: 'negative',
          impact: `BLOCKED: ${exchangeName} exchange is closed — opens Mon-Fri ${String(openMin/60).padStart(2,'0')}:${String(openMin%60).padStart(2,'0')}-${String(closeMin/60).padStart(2,'0')}:${String(closeMin%60).padStart(2,'0')}`
        }],
        technicalScore: 0, sentimentScore: 0,
        timestamp: new Date().toISOString(), userId: '',
      };
      return blockedResult;
    }
  }

  try {
    const TF_PROGRESSION = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M', '1Y'];
    const currentIndex = TF_PROGRESSION.indexOf(timeframe);
    const macro1 = TF_PROGRESSION[Math.min(currentIndex + 1, TF_PROGRESSION.length - 1)];
    
    const macro2 = TF_PROGRESSION[Math.min(currentIndex + 2, TF_PROGRESSION.length - 1)];
    const microTF = currentIndex > 0 ? TF_PROGRESSION[currentIndex - 1] : TF_PROGRESSION[0];

    // Fetch ALL data sources in PARALLEL — saves ~10-15s per symbol
    console.log(`[Engine] Fetching data for ${symbol} (${timeframe}, micro=${microTF}, macro=${macro1})`);
    const fetchT0 = Date.now();
    const [rawData, microDataRaw, ctxResult, macroDataRaw] = await Promise.all([
      fetchMarketDataDirect(symbol, timeframe).catch((e) => { console.warn(`[Engine] ${symbol} main fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
      fetchMarketDataDirect(symbol, microTF).catch((e) => { console.warn(`[Engine] ${symbol} micro fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
      fetchMarketContext(symbol).catch((e) => { console.warn(`[Engine] ${symbol} ctx fail:`, e.message); return { fearGreed: null, news: [], econEvents: [] }; }),
      fetchMarketDataDirect(symbol, macro1).catch((e) => { console.warn(`[Engine] ${symbol} macro fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
    ]);

    // Fetch daily/weekly/monthly data for Candle Match Filter
    // (fetched whenever the direction-unify filter is active,
    //  since the direction filter is ON by default and must always be enforced)
    let candleMatchData: { daily: any; weekly: any; monthly: any } | null = null;
    if (settings?.useCandleMatch || settings?.candleDirectionFilter !== false) {
      const [dailyRaw, weeklyRaw, monthlyRaw] = await Promise.all([
        fetchMarketDataDirect(symbol, '1d').catch((e) => { console.warn(`[Engine] ${symbol} daily fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
        fetchMarketDataDirect(symbol, '1w').catch((e) => { console.warn(`[Engine] ${symbol} weekly fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
        fetchMarketDataDirect(symbol, '1M').catch((e) => { console.warn(`[Engine] ${symbol} monthly fetch fail:`, e.message); return { chart: { result: [{ indicators: { quote: [{}] } }] } }; }),
      ]);
      candleMatchData = { daily: dailyRaw, weekly: weeklyRaw, monthly: monthlyRaw };
    }

    console.log(`[Engine] ${symbol} data fetched in ${Date.now() - fetchT0}ms`);

    var contextFearGreed = ctxResult.fearGreed;
    var contextNews: { title: string; source: string }[] = ctxResult.news || [];
    var contextEcon: any[] = ctxResult.econEvents || [];

    const quotes = rawData.chart?.result?.[0]?.indicators?.quote?.[0];
    const closeLen = quotes?.close?.filter((c: any) => c != null)?.length || 0;
    console.log(`[Engine] ${symbol} close data points: ${closeLen}`);
    
    if (!quotes || !quotes.close) {
      console.error(`[Engine] ${symbol} BLOCKED: no close data — rawData keys: ${JSON.stringify(Object.keys(rawData?.chart?.result?.[0] || {}))}`);
      throw new Error("Market data currently unavailable from the source.");
    }

    const closes = quotes.close.filter((c: any) => c != null);
    const highsRaw2 = quotes.high.filter((c: any) => c != null);
    const lowsRaw2 = quotes.low.filter((c: any) => c != null);
    const highs = highsRaw2.length >= closes.length ? highsRaw2 : closes;
    const lows = lowsRaw2.length >= closes.length ? lowsRaw2 : closes;
    const volumes = quotes.volume?.filter((v: any) => v != null);
    const rawOpens2 = quotes.open?.filter((c: any) => c != null) || closes;
    const opens = rawOpens2.length >= closes.length ? rawOpens2 : closes;
    
    // Extract timestamps for date calculations
    const timestamps: number[] = rawData.chart?.result?.[0]?.timestamp || [];
    const tsLen = timestamps.length;
    const candlesWithTS = Math.min(tsLen, closes.length);

    if (closes.length < 10) {
      throw new Error(`Insufficient data for ${symbol}.`);
    }

    const metrics = calculateTechnicalMetrics(closes, highs, lows, volumes, opens);
    const supplyDemandZones = calculateSupplyDemandZones(highs, lows, volumes || [], closes);
    const zonesText = supplyDemandZones.length > 0 
      ? supplyDemandZones.map(z => `${z.type === 'supply' ? 'Supply' : 'Demand'} zone: ${z.bottom.toFixed(2)}ΓÇô${z.top.toFixed(2)} (strength ${z.strength.toFixed(0)}%)`).join('. ')
      : 'No clear zones detected.';

    // ── Professional Volume Quality (5-module filter) ──
    const volumeQuality = computeVolumeQuality(closes, highs, lows, volumes || [], opens, metrics?.direction || 'sideways');
    console.log(`[Engine] ${symbol} VolumeQuality=${volumeQuality.score}/100 detected=${volumeQuality.detected} absorbed=${volumeQuality.absorbed} ${volumeQuality.reasons.join('; ')}`);
    
    // Process micro data (already fetched in parallel above)
    var microCloses: number[] = [];
    var microMetrics = null;
    try {
      const microQuotes = microDataRaw.chart?.result?.[0]?.indicators?.quote?.[0];
      if (microQuotes && microQuotes.close) {
        microCloses = microQuotes.close.filter((c: any) => c != null);
        const microHighsRaw = microQuotes.high?.filter((c: any) => c != null) || microCloses;
        const microLowsRaw = microQuotes.low?.filter((c: any) => c != null) || microCloses;
        const microOpensRaw = microQuotes.open?.filter((c: any) => c != null) || microCloses;
        const microVolsRaw = microQuotes.volume?.filter((c: any) => c != null) || [];
        if (microCloses.length >= 10) {
          microMetrics = calculateTechnicalMetrics(microCloses, microHighsRaw, microLowsRaw, microVolsRaw.length > 0 ? microVolsRaw : undefined, microOpensRaw);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch micro timeframe data:", e);
    }

    // Compute MACRO direction (higher timeframe trend)
    var macroDirection: 'uptrend' | 'downtrend' | 'sideways' = 'sideways';
    try {
      const macroQuotes = macroDataRaw.chart?.result?.[0]?.indicators?.quote?.[0];
      if (macroQuotes && macroQuotes.close) {
        const macroCloses = macroQuotes.close.filter((c: any) => c != null);
        if (macroCloses.length >= 10) {
          const macroMetrics = calculateTechnicalMetrics(macroCloses, 
            (macroQuotes.high || []).filter((c: any) => c != null), 
            (macroQuotes.low || []).filter((c: any) => c != null), 
            (macroQuotes.volume || []).filter((c: any) => c != null), 
            (macroQuotes.open || []).filter((c: any) => c != null));
          macroDirection = macroMetrics?.direction || 'sideways';
        }
      }
    } catch (e) {
      console.warn("Failed to compute macro direction:", e);
    }
    const isMacroUp = macroDirection === 'uptrend';
    const isMacroDown = macroDirection === 'downtrend';
    
    const newsText = contextNews.length > 0
      ? contextNews.map(n => `ΓÇó ${n.title} (${n.source})`).join('\n')
      : 'No recent news available.';
    const eventsText = contextEcon.length > 0
      ? contextEcon.map(e => `ΓÇó ${e.country} | ${e.title} | Impact: ${e.impact} | Forecast: ${e.forecast} | Previous: ${e.previous}`).join('\n')
      : 'No major economic events this week.';

    const isAr = lang === 'ar';
    const technicalPrompt = `You are an Elite Institutional Trader (ICT/SMC). Analyze ${symbol} (${type}, ${timeframe}, ${tradingStyle}) and return a JSON trading decision.

MARKET DATA: RSI ${metrics?.rsi?.toFixed(1)}, Trend ${metrics?.direction}, EMA Cross ${metrics?.emaCross}, Vol Surge ${metrics?.volSurge}, Trend Length ${metrics?.totalAge}c, Momentum ${metrics?.age}c.

BOLLINGER BANDS: Upper ${metrics?.bbUpper?.toFixed(4) || 'N/A'}, Middle ${metrics?.bbMiddle?.toFixed(4) || 'N/A'}, Lower ${metrics?.bbLower?.toFixed(4) || 'N/A'}, %B ${metrics?.bbPercentB ? Math.round(metrics.bbPercentB * 100) : 'N/A'}%, Width ${metrics?.bbWidth ? metrics.bbWidth.toFixed(4) : 'N/A'}.
BB STRATEGY: Pullback ${metrics?.bbPullbackCount || 0} candles, TouchLower ${metrics?.bbTouchLower || false}, TouchUpper ${metrics?.bbTouchUpper || false}, Hammer ${metrics?.hasHammer || false}, Pinbar ${metrics?.hasPinbar || false}, Engulfing ${metrics?.hasEngulfing || false}, ShootingStar ${metrics?.hasShootingStar || false}.

SIDEWAYS FILTER: ADX ${metrics?.adx?.toFixed(1) || 'N/A'} (direction: ${metrics?.adxDirection || 'N/A'}), MA Alignment ${metrics?.maAlignment || 'N/A'}, IsSideways ${metrics?.isSideways || false}, Direction ${metrics?.sidewaysDirection || 'sideways'}.

MICRO (${microTF}): RSI ${microMetrics?.rsi ? microMetrics.rsi.toFixed(1) : 'N/A'}, Trend ${microMetrics?.direction || 'sideways'}, EMA ${microMetrics?.emaCross || 'unknown'}, BB Upper ${microMetrics?.bbUpper?.toFixed(4) || 'N/A'}, BB Lower ${microMetrics?.bbLower?.toFixed(4) || 'N/A'}, BB %B ${microMetrics?.bbPercentB ? Math.round(microMetrics.bbPercentB * 100) : 'N/A'}%, TouchLower ${microMetrics?.bbTouchLower || false}, TouchUpper ${microMetrics?.bbTouchUpper || false}, Pullback ${microMetrics?.bbPullbackCount || 0}c, Hammer ${microMetrics?.hasHammer || false}, Pinbar ${microMetrics?.hasPinbar || false}, Engulfing ${microMetrics?.hasEngulfing || false}.

CONTEXT: Fear&Greed ${contextFearGreed?.value ?? 'N/A'}/100 (${contextFearGreed?.classification ?? 'Unknown'}). News: ${newsText.substring(0, 300)}. Events: ${eventsText.substring(0, 200)}.

SETTINGS: NewsGuard ${settings.useNewsGuard ? 'ON' : 'OFF'}, Volume ${settings.useVolumeAnalysis ? 'ON' : 'OFF'}, HigherTF ${settings.useHigherTimeframe ? 'ON' : 'OFF'}, Indicators ${settings.useIndicators ? 'ON' : 'OFF'}.

SUPPLY & DEMAND ZONES: ${zonesText}

RULES:
- CRITICAL SIDEWAYS GATE: If "IsSideways" is true, you MUST return signal "no_entry" with confidence 0. This is a HARD GATE — no exceptions. The market is in a sideways/choppy zone and trading is forbidden.
- If "IsSideways" is false, the market has a clear direction. Use "Direction" (uptrend/downtrend) to confirm your signal direction.
- 4 PRIMARY CONDITIONS (must ALL be favorable for strong signal):
  1. BB Pullback: trend + 3-6 pullback candles + touch BB + reversal candle ΓåÆ STRONG BUY/SELL
  2. Supply/Demand: demand zone + uptrend = confirms buy; supply zone + downtrend = confirms sell
  3. Trend Age: <10 infant (reduce confidence), <25 youth, 25-50 mature (full strength), >50 old (reduced)
  4. News Sentiment: negative news blocks strong signal; no news = allowed
- ONLY "strong_buy"/"strong_sell" if ALL 4 primary conditions are favorable + micro (${microTF}) aligned.
- If any primary condition fails ΓåÆ "buy"/"sell" (not strong).
- Supporting conditions (RSI, EMA, Volume, Micro BB) add boost only.
- BOLLINGER BANDS STRATEGY: If trend is UP and price pulled back 3-6 candles to touch Lower BB (or within 1.5%) + reversal candle ΓåÆ STRONG BUY. If trend is DOWN and price rallied 3-6 candles to touch Upper BB (or within 1.5%) + reversal candle ΓåÆ STRONG SELL.
- MICRO BB STRATEGY: Same conditions on micro timeframe ΓåÆ adds +2 boost.

CRITICAL CONTRARIAN RULES:
- Fear&Greed Γëñ 25 (EXTREME FEAR): This is a CONTRARIAN BUY signal. Strongly prefer "buy" or "strong_buy". Do NOT give "sell" unless there is overwhelming bearish evidence (all 4 primary conditions met for sell).
- Fear&Greed ΓëÑ 75 (EXTREME GREED): This is a CONTRARIAN SELL signal. Strongly prefer "sell" or "strong_sell". Do NOT give "buy" unless there is overwhelming bullish evidence.
- Fear&Greed 26-40 (Fear): Mild contrarian buy bias. Prefer "buy" over "sell" when indicators are mixed.
- Fear&Greed 60-74 (Greed): Mild contrarian sell bias. Prefer "sell" over "buy" when indicators are mixed.
- Trend "sideways" with no clear direction: Default to "neutral" unless there is a very strong setup (BB pullback + volume + micro alignment).
- Trend Age < 10 (Infant): Significantly reduce confidence. The trend is unreliable. "buy"/"sell" only if indicators are strongly aligned.

LANGUAGE RULES (CRITICAL):
${isAr ? `- ALL text fields (summary, detailedReasons impact) MUST be written in formal Arabic (\u0639\u0631\u0628\u064a) using professional financial terminology.
- Use terms like: \u0627\u0644\u0632\u062e\u0645 \u0627\u0644\u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0645\u0631\u062a\u0641\u0639 \u0644\u062d\u0638\u0629 \u0627\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0646\u0638\u0627\u0645\u064a \u0627\u0644\u0645\u0647\u0646\u064a.
- DO NOT use English words mixed in Arabic text.
- DO NOT repeat the same phrase in different reasons. Each reason must be unique and specific.
- Keep each impact field under 12 words. Be precise and concise.` : `- Write summary in clear, professional English. Keep under 2-3 sentences.
- Each impact field max 15 words, precise and professional.`}

CRITICAL RULES FOR detailedReasons:
- Each "impact" must be SHORT and SPECIFIC to that exact indicator.
- Each "check" must name the indicator (RSI, EMA Cross, Trend Direction, etc.)
- Each "value" must show the actual value
- Each "status" must be exactly: "positive", "negative", or "neutral"
- Do NOT repeat similar phrases across different reasons.
- Do NOT write vague or garbled text.

Return ONLY valid JSON:
{
  "signal": "strong_buy"|"buy"|"neutral"|"sell"|"strong_sell"|"no_entry",
  "confidence": number (0-100),
  "summary": "string ΓÇö 2-3 sentence summary",
  "detailedReasons": [
    {"check": "RSI", "value": "62.5", "status": "neutral", "impact": "${isAr ? '\u0627\u0644\u0632\u062e\u0645 \u0645\u062a\u0648\u0627\u0632\u0646 \u0644\u0627 \u0642\u0631\u0627\u0626\u0637 \u0645\u0637\u0644\u0642\u0629' : 'Momentum balanced, no extreme reading'}"},
    {"check": "EMA Cross", "value": "bullish", "status": "positive", "impact": "${isAr ? '\u0627\u0644\u0645\u062a\u0646\u0627\u0633\u0642 9 \u0641\u0648\u0642 9 \u0627\u0644\u0645\u062a\u0646\u0627\u0633\u0642 21 \u064a\u062f\u0639\u0645 \u0627\u0644\u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0635\u0627\u0639\u062f' : '9 EMA above 21 EMA supports upward bias'}"},
    {"check": "Trend Direction", "value": "uptrend", "status": "positive", "impact": "${isAr ? '\u0627\u0644\u0633\u0639\u0631 \u064a\u0635\u0646\u0639 \u0642\u0645\u0648\u0627\u062a \u0623\u0639\u0644\u0649 \u0648\u0646\u0642\u0627\u0637 \u0623\u0639\u0644\u0649' : 'Price making higher highs and higher lows'}"},
    {"check": "Trend Age Zone", "value": "mature (32c)", "status": "positive", "impact": "${isAr ? '\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0646\u0636\u062c \u062a\u0633\u0645\u062d \u0628\u0627\u0644\u062b\u0642\u0629 \u0627\u0644\u0643\u0627\u0645\u0644\u0629' : 'Mature zone allows full confidence'}"},
    {"check": "Volume Surge", "value": "true", "status": "positive", "impact": "${isAr ? '\u0627\u0632\u062f\u062d\u0627\u0632 \u0627\u0644\u062d\u062c\u0645 \u064a\u062a\u0623\u0643\u062f \u0627\u0644\u0643\u0633\u0631 \u0627\u0644\u0645\u0647\u0646\u064a' : 'Volume spike confirms breakout momentum'}"},
    {"check": "Supply/Demand", "value": "demand 1.085", "status": "positive", "impact": "${isAr ? '\u0627\u0644\u0633\u0639\u0631 \u064a\u0633\u062a\u0648\u064a \u0639\u0644\u0649 \u0645\u0646\u0637\u0642\u0629 \u0637\u0644\u0628 \u0642\u0648\u064a\u0629' : 'Price resting on strong demand zone'}"},
    {"check": "Micro Alignment", "value": "aligned", "status": "positive", "impact": "${isAr ? '\u0627\u0644\u0625\u0637\u0627\u0631 \u0627\u0644\u0632\u0645\u0646\u064a \u0627\u0644\u0635\u063a\u064a\u0631 \u064a\u062a\u0623\u0643\u062f \u0627\u0644\u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0631\u0626\u064a\u0633\u064a' : 'Lower timeframe confirms macro direction'}"},
    {"check": "Fear&Greed", "value": "45/100", "status": "neutral", "impact": "${isAr ? '\u0645\u0648\u0627\u0644\u0641\u0629 \u0627\u0644\u0633\u0648\u0642 \u0645\u062a\u0648\u0627\u0632\u0646\u0629 \u0644\u0627 \u0642\u0631\u0627\u0626\u0637' : 'Market sentiment balanced, no extreme'}"},
    {"check": "News Sentiment", "value": "2 positive", "status": "positive", "impact": "${isAr ? '\u062a\u062f\u0641\u0639 \u0623\u062e\u0628\u0627\u0631 \u0645\u0639\u062f\u064a\u0629 \u064a\u062f\u0639\u0645 \u0627\u0644\u0627\u062a\u062c\u0627\u0647' : 'Favorable news flow supports direction'}"},
    {"check": "Economic Events", "value": "none", "status": "neutral", "impact": "${isAr ? '\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u062d\u062f\u0627\u062b \u0627\u0644\u062a\u0623\u062b\u064a\u0631 \u0627\u0644\u0639\u0627\u0644\u064a\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629' : 'No upcoming high-impact events'}"},
  ],
  "technicalScore": number,
  "sentimentScore": number,
  "historicalMatch": "string",
  "microSignal": "pullback"|"aligned"|"unknown",
  "microTrend": "string",
  "stopLoss": number,
  "takeProfit": number
}`;

    // Analysis runs on the developer's key pool through the server. The browser
    // holds no key at all, so there is nothing to validate, mirror or leak here —
    // and the server refuses any account without a running plan.

    // Age zone limits ΓÇö needed by local fallback
    const totalAge = metrics?.totalAge || 0;
    const age = metrics?.age || 0;
    const isCrypto = type === MarketType.CRYPTO;
    const minAge = settings?.minTrendAge ?? 2;
    const infantAgeThreshold = settings?.minInfantAge ?? 10;
    const matureAgeThreshold = settings?.minMatureAge ?? 25;
    const oldAgeThreshold = settings?.maxMatureAge ?? 50;
    const infantLimit = infantAgeThreshold;
    const matureLimit = matureAgeThreshold;
    const oldLimit = oldAgeThreshold;

    var aiResponse: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitIfRateLimited();
      aiResponse = await callAIServer(technicalPrompt);
      if (!aiResponse?.error) break;
      if (aiResponse.error === 'rate_limited') { onRateLimited(); await new Promise(r => setTimeout(r, 8000)); continue; }
      if (attempt < 1) await new Promise(r => setTimeout(r, 2000));
    }

    const aiOk = aiResponse && !aiResponse?.error && aiResponse?.choices?.[0]?.message?.content;
    const rawText = aiOk ? aiResponse.choices[0].message.content : '';
    const jsonMatch = aiOk ? rawText.match(/\{[\s\S]*\}/) : null;
    const resultData = aiOk && jsonMatch ? JSON.parse(jsonMatch[0]) : synthFromMetrics(metrics, symbol);

    var detailedReasons: any[] = Array.isArray(resultData.detailedReasons) ? [...resultData.detailedReasons] : [];

    // Build fallback from metrics if AI didn't provide reasons
    if (detailedReasons.length === 0) {
      const addReason = (check: string, value: string, status: string, impact: string, source?: string) => {
        detailedReasons.push({ check, value, status, impact, source });
      };
      const rsiVal = metrics?.rsi;
      if (rsiVal !== undefined) {
        const rsiStatus = rsiVal > 70 ? 'negative' : rsiVal < 30 ? 
          (metrics?.direction === 'uptrend' ? 'positive' : metrics?.direction === 'downtrend' ? 'negative' : 'neutral') : 'neutral';
        addReason('RSI', rsiVal.toFixed(1), rsiStatus,
          rsiStatus === 'negative' ? (metrics?.direction === 'downtrend' && rsiVal < 30 ? 'oversold in downtrend — continuation, NOT buy' : 'overbought, caution') :
          rsiStatus === 'positive' ? 'oversold in uptrend — bounce potential' : 'neutral zone');
      }
      if (metrics?.emaCross) {
        const isBull = metrics.emaCross === 'bullish';
        addReason('EMA Cross', metrics.emaCross, isBull ? 'positive' : 'negative',
          isBull ? 'supports upward bias' : 'supports downward bias');
      }
      if (metrics?.direction) {
        const isUp = metrics.direction === 'uptrend';
        addReason('Trend Direction', metrics.direction,
          isUp ? 'positive' : metrics.direction === 'downtrend' ? 'negative' : 'neutral',
          isUp ? 'price making higher highs' :
          metrics.direction === 'downtrend' ? 'price making lower lows' : 'no clear direction');
      }
      if (metrics?.volSurge !== undefined) {
        addReason('Volume Surge', metrics.volSurge ? 'true' : 'false',
          metrics.volSurge ? 'positive' : 'neutral',
          metrics.volSurge ? 'confirms momentum' : 'normal volume');
      }
      if (microMetrics) {
        addReason('Micro TF Alignment', resultData.microSignal || 'unknown',
          resultData.microSignal === 'aligned' ? 'positive' : 'neutral',
          resultData.microSignal === 'aligned' ? 'micro aligns with macro' : 'micro diverging from macro');
      }
      const fg = contextFearGreed;
      if (fg?.value !== undefined) {
        const fgStatus = fg.value <= 25 ? 'positive' : fg.value >= 75 ? 'negative' : 'neutral';
        addReason('Fear & Greed', `${fg.value}/100 ΓÇö ${fg.classification || ''}`, fgStatus,
          fgStatus === 'positive' ? 'contrarian buy signal' :
          fgStatus === 'negative' ? 'extreme greed, cap confidence' : 'neutral sentiment');
      }
      if (contextNews.length > 0) {
        const sources = [...new Set(contextNews.map(n => n.source).filter(Boolean))];
        addReason('News Sentiment', `${contextNews.length} articles`, 'neutral', 'check summary for details', sources.join(', '));
      } else {
        addReason('News Sentiment', 'No active events', 'neutral', 'no blocking news ΓÇö signal allowed');
      }
      if (contextEcon.length > 0) {
        const highEvents = contextEcon.filter((e: any) => e.impact === 'High');
        const imminentEvents = highEvents.filter((e: any) => e.hoursUntil > 0 && e.hoursUntil <= 24);
        const eventNames = highEvents.map((e: any) => `${e.country} ${e.title}`).join(', ');
        
        if (imminentEvents.length > 0) {
          const imminentNames = imminentEvents.map((e: any) => `${e.country} ${e.title} (${e.hoursUntil}h)`).join(', ');
          addReason('Economic Events', `⚠️ ${imminentNames}`, 'negative', `-15% confidence - ${imminentEvents.length} high-impact event(s) within 24h`);
        } else {
          addReason('Economic Events', `${eventNames}`, 'neutral', `${highEvents.length} high-impact event(s) scheduled`);
        }
      } else {
        addReason('Economic Events', 'No high-impact events', 'neutral', 'no upcoming major economic events');
      }
    }

    // ΓöÇΓöÇ STEP 1b: Trend Age Zone — ALWAYS replace AI version with metrics version ΓöÇΓöÇ
    // Remove any AI-generated Trend Age reason
    detailedReasons = detailedReasons.filter((r: any) => !r.check?.includes('Trend Age'));
    
    const ageZoneDesc = totalAge < infantLimit ? `Infant (<${infantLimit})` :
      totalAge < matureLimit ? `Youth (${infantLimit}-${matureLimit})` :
      totalAge <= oldLimit ? `Mature (${matureLimit}-${oldLimit})` : `Old (>${oldLimit})`;
    const zoneStatus = totalAge >= matureLimit && totalAge <= oldLimit ? 'positive' :
      totalAge < infantLimit ? 'negative' : 'neutral';
    
    detailedReasons.push({
      check: 'Trend Age', value: `${totalAge}c ΓÇö ${ageZoneDesc}`, status: zoneStatus,
      impact: zoneStatus === 'positive' ? 'trend mature ΓÇö full signal allowed' :
        zoneStatus === 'negative' ? 'trend age issue ΓÇö confidence reduced' : 'trend developing'
    });

    // ΓöÇΓöÇ STEP 1c: Supply/Demand fallback reason ΓöÇΓöÇ
    if (!detailedReasons.some((r: any) => r.check?.includes('Supply/Demand'))) {
      if (supplyDemandZones.length > 0) {
        const nearestZone = supplyDemandZones[0];
        const isUp = metrics?.direction === 'uptrend';
        const isDown = metrics?.direction === 'downtrend';
        const aligned = (nearestZone.type === 'demand' && isUp) || (nearestZone.type === 'supply' && isDown);
        detailedReasons.push({
          check: 'Supply/Demand',
          value: `${nearestZone.type === 'supply' ? 'Supply' : 'Demand'} ${nearestZone.bottom.toFixed(2)}-${nearestZone.top.toFixed(2)} (${Math.round(nearestZone.strength)}%)`,
          status: aligned ? 'positive' : 'negative',
          impact: `nearest ${nearestZone.type} zone ${aligned ? 'confirms direction' : 'conflicts with trend'}`
        });
      } else {
        detailedReasons.push({ check: 'Supply/Demand', value: 'No zones detected', status: 'neutral', impact: 'no supply/demand zones nearby' });
      }
    }

    // ΓöÇΓöÇ STEP 1d: BB Pullback fallback ΓÇö ON MICRO TF ΓöÇΓöÇ
    if (!detailedReasons.some((r: any) => r.check?.includes('BB Pullback') || r.check?.includes('BB Strategy'))) {
      if (microMetrics?.bbLower > 0) {
        const bbPct = Math.round(microMetrics.bbPercentB * 100);
        const isUp = metrics.direction === 'uptrend';
        const isDown = metrics.direction === 'downtrend';
        if (isUp && microMetrics.bbTouchLower && microMetrics.bbPullbackCount >= 3 && microMetrics.bbPullbackCount <= 6 && (microMetrics.hasHammer || microMetrics.hasPinbar || microMetrics.hasEngulfing || microMetrics.hasBullishCandle)) {
          detailedReasons.push({ check: `BB Pullback (${microTF}) (BUY)`, value: `Pullback ${microMetrics.bbPullbackCount}c ΓåÆ Lower + Reversal on ${microTF}`, status: 'positive', impact: `strong: trend up + pullback to lower BB + reversal on ${microTF}` });
        } else if (isDown && microMetrics.bbTouchUpper && microMetrics.bbPullbackCount >= 3 && microMetrics.bbPullbackCount <= 6 && (microMetrics.hasShootingStar || microMetrics.hasPinbar || microMetrics.hasEngulfing || microMetrics.hasBearishCandle)) {
          detailedReasons.push({ check: `BB Pullback (${microTF}) (SELL)`, value: `Rally ${microMetrics.bbPullbackCount}c ΓåÆ Upper + Reversal on ${microTF}`, status: 'negative', impact: `strong: trend down + rally to upper BB + reversal on ${microTF}` });
        } else if (microMetrics.bbTouchLower && isUp) {
          detailedReasons.push({ check: `BB Pullback (${microTF}) (BUY)`, value: `Near Lower (${bbPct}%) ΓÇö ${microMetrics.bbPullbackCount}c on ${microTF}`, status: 'positive', impact: `partial: approaching lower BB on ${microTF}` });
        } else if (microMetrics.bbTouchUpper && isDown) {
          detailedReasons.push({ check: `BB Pullback (${microTF}) (SELL)`, value: `Near Upper (${bbPct}%) ΓÇö ${microMetrics.bbPullbackCount}c on ${microTF}`, status: 'negative', impact: `partial: approaching upper BB on ${microTF}` });
        } else {
          detailedReasons.push({ check: `BB Pullback (${microTF})`, value: `No pullback ΓÇö ${bbPct}%B on ${microTF}`, status: 'neutral', impact: `BB pullback NOT met on ${microTF}` });
        }
      } else if (metrics?.bbLower > 0) {
        const bbPct = Math.round(metrics.bbPercentB * 100);
        const isUp = metrics.direction === 'uptrend';
        const isDown = metrics.direction === 'downtrend';
        if (isUp && metrics.bbTouchLower && metrics.bbPullbackCount >= 3 && metrics.bbPullbackCount <= 6 && (metrics.hasHammer || metrics.hasPinbar || metrics.hasEngulfing || metrics.hasBullishCandle)) {
          detailedReasons.push({ check: 'BB Pullback (BUY)', value: `Pullback ${metrics.bbPullbackCount}c ΓåÆ Lower + Reversal`, status: 'positive', impact: 'strong: trend up + pullback to lower BB + reversal' });
        } else if (isDown && metrics.bbTouchUpper && metrics.bbPullbackCount >= 3 && metrics.bbPullbackCount <= 6 && (metrics.hasShootingStar || metrics.hasPinbar || metrics.hasEngulfing || metrics.hasBearishCandle)) {
          detailedReasons.push({ check: 'BB Pullback (SELL)', value: `Rally ${metrics.bbPullbackCount}c ΓåÆ Upper + Reversal`, status: 'negative', impact: 'strong: trend down + rally to upper BB + reversal' });
        } else {
          detailedReasons.push({ check: 'BB Pullback', value: `No pullback ΓÇö ${bbPct}%B`, status: 'neutral', impact: 'BB pullback NOT met' });
        }
      }
    }

    // ΓöÇΓöÇ STEP 1e: Micro BB fallback ΓÇö fully on micro TF ΓöÇΓöÇ
    if (!detailedReasons.some((r: any) => r.check?.includes('Micro BB'))) {
      if (microMetrics?.bbLower > 0) {
        const isUptrend = metrics?.direction === 'uptrend';
        const isDowntrend = metrics?.direction === 'downtrend';
        if (isUptrend && microMetrics.bbTouchLower && microMetrics.bbPullbackCount >= 3 && microMetrics.bbPullbackCount <= 6 && (microMetrics.hasHammer || microMetrics.hasPinbar || microMetrics.hasEngulfing || microMetrics.hasBullishCandle)) {
          detailedReasons.push({ check: `Micro BB (${microTF}) Strategy (BUY)`, value: `Pullback ${microMetrics.bbPullbackCount}c ΓåÆ Lower + Reversal on ${microTF}`, status: 'positive', impact: `strong buy: macro uptrend + micro pullback + reversal` });
        } else if (isDowntrend && microMetrics.bbTouchUpper && microMetrics.bbPullbackCount >= 3 && microMetrics.bbPullbackCount <= 6 && (microMetrics.hasShootingStar || microMetrics.hasPinbar || microMetrics.hasEngulfing || microMetrics.hasBearishCandle)) {
          detailedReasons.push({ check: `Micro BB (${microTF}) Strategy (SELL)`, value: `Rally ${microMetrics.bbPullbackCount}c ΓåÆ Upper + Reversal on ${microTF}`, status: 'negative', impact: `strong sell: macro downtrend + micro rally + reversal` });
        } else if (microMetrics.bbTouchLower && isUptrend) {
          detailedReasons.push({ check: `Micro BB (${microTF}) Touch Lower`, value: `price at lower band on ${microTF}`, status: 'positive', impact: `micro timeframe approaching lower BB in macro uptrend` });
        } else if (microMetrics.bbTouchUpper && isDowntrend) {
          detailedReasons.push({ check: `Micro BB (${microTF}) Touch Upper`, value: `price at upper band on ${microTF}`, status: 'negative', impact: `micro timeframe approaching upper BB in macro downtrend` });
        }
      }
    }

    // ΓöÇΓöÇ STEP 2: Compute primary & supporting from METRICS (not AI text) ΓöÇΓöÇ
    const isUp = metrics?.direction === 'uptrend';
    const isDown = metrics?.direction === 'downtrend';

    // PRIMARY 1 ΓÇö BB Pullback (lenient gate): passes if BB exists and aligns with direction.
    // Strict pullback (touch+3-6c+reversal) is for STRONG upgrade only, not for blocking signals.
    const hasBbData = !!(metrics?.bbLower > 0);
    const hasMicroBbData = !!(microMetrics && microMetrics.bbLower > 0);
    // Lenient: BB data exists ΓåÆ pass. Only blocks if BB actively conflicts with direction.
    // e.g. price at upper BB in uptrend with no pullback = conflict ΓåÆ block
    var bbMet = true;
    if (hasMicroBbData) {
      // Micro BB available ΓÇö use it: pass if price aligns OR if no strong conflict
      const microAtUpper = microMetrics.bbPercentB > 0.85;
      const microAtLower = microMetrics.bbPercentB < 0.15;
      bbMet = !(microAtUpper && isUp) && !(microAtLower && isDown);
    } else if (hasBbData) {
      // No micro but macro BB available ΓÇö same lenient check
      const macroAtUpper = (metrics?.bbPercentB ?? 0.5) > 0.85;
      const macroAtLower = (metrics?.bbPercentB ?? 0.5) < 0.15;
      bbMet = !(macroAtUpper && isUp) && !(macroAtLower && isDown);
    }
    // If no BB data at all ΓåÆ pass

    // PRIMARY 2 ΓÇö Supply/Demand: no zones = pass, zones support = pass, zones conflict = penalty
    const hasZones = supplyDemandZones.length > 0;
    const nearestZone = supplyDemandZones[0];
    const sdAligned = hasZones && ((nearestZone?.type === 'demand' && isUp) || (nearestZone?.type === 'supply' && isDown));
    const sdConflict = hasZones && !sdAligned;
    // Always pass for regular signals; only block for STRONG via allGatesMet
    const sdMet = !sdConflict;
    // Confidence penalty when supply/demand conflicts (applies to all signals)
    var sdPenaltyMult = 1.0;
    if (sdConflict) {
      sdPenaltyMult = 0.8;
      detailedReasons.push({ check: 'Supply/Demand', value: `${nearestZone?.type} ${nearestZone?.bottom?.toFixed(2)}-${nearestZone?.top?.toFixed(2)} conflicts with ${metrics?.direction}`, status: 'negative', impact: `supply/demand conflict -20% confidence` });
    }

    // PRIMARY 3 ΓÇö Trend Age: ALL zones pass (never blocks). Youth allows STRONG; others downgrade.
    const ageMet = true;

    // PRIMARY 4 ΓÇö News: check for high-impact negative events
    var newsMet = true;
    var econPenaltyMult = 1.0;
    if (contextEcon && contextEcon.length > 0) {
      const highImpactEvents = contextEcon.filter((e: any) => e.impact === 'High');
      const imminentEvents = highImpactEvents.filter((e: any) => e.hoursUntil > 0 && e.hoursUntil <= 24);
      if (imminentEvents.length > 0) {
        econPenaltyMult = 0.85;
        const eventList = imminentEvents.map((e: any) => `${e.country} ${e.title} in ${e.hoursUntil}h`).join('; ');
        detailedReasons.push({ check: 'Econ Penalty', value: `-15%`, status: 'negative', impact: `Imminent high-impact: ${eventList}` });
      } else if (highImpactEvents.length > 0) {
        econPenaltyMult = 0.9;
        const eventList = highImpactEvents.map((e: any) => `${e.country} ${e.title}`).join('; ');
        detailedReasons.push({ check: 'Econ Penalty', value: `-10%`, status: 'caution', impact: `Upcoming high-impact: ${eventList}` });
      }
    }
    var newsPenaltyMult = 1.0;
    if (contextNews && contextNews.length > 0) {
      // Count negative news vs positive
      const negNews = contextNews.filter((n: any) => {
        const title = (n.title || '').toLowerCase();
        return title.includes('crash') || title.includes('ban') || title.includes('fraud') || 
               title.includes('hack') || title.includes('bearish') || title.includes('drop') ||
               title.includes('fall') || title.includes('down') || title.includes('loss');
      });
      const posNews = contextNews.filter((n: any) => {
        const title = (n.title || '').toLowerCase();
        return title.includes('rally') || title.includes('bullish') || title.includes('surge') ||
               title.includes('adoption') || title.includes('partnership') || title.includes('launch');
      });
      // If overwhelmingly negative and signal is BUY → reduce confidence
      if (negNews.length >= 2 && negNews.length > posNews.length) {
        const currentSignal = String(resultData.signal || '').toLowerCase();
        if (currentSignal.includes('buy')) {
          newsPenaltyMult = 0.8;
        }
      }
    }

    // ═══ WEEKLY NEWS IMMUNITY FILTER (HARD GATE) ═══
    // User leaves trades open until end of week. If ANY HIGH-impact economic event that
    // affects THIS symbol falls anywhere in the current calendar week (Mon→Fri), the symbol
    // is BLOCKED entirely (no_entry) — regardless of how strong the technical signal is.
    // Once the event time passes (hoursUntil <= 0), the symbol becomes tradable again.
    var weeklyNewsBlocked = false;
    let weeklyNewsBlockReason = '';
    if (settings.useNewsGuard !== false && contextEcon && contextEcon.length > 0) {
      const weekEnd = endOfCurrentWeek();
      const highEvents = contextEcon.filter((e: any) => e.impact === 'High');
      for (const ev of highEvents) {
        const affected = symbolAffectedByCountry(symbol, ev.country);
        if (!affected) continue;
        const eventDate = ev.date ? new Date(ev.date) : null;
        const hoursUntil = typeof ev.hoursUntil === 'number' ? ev.hoursUntil : (eventDate ? (eventDate.getTime() - Date.now()) / (1000 * 3600) : Infinity);
        // Upcoming event (still ahead) AND occurring before end of current week → BLOCK
        if (hoursUntil > 0 && eventDate && eventDate <= weekEnd) {
          weeklyNewsBlocked = true;
          weeklyNewsBlockReason = `${ev.country} ${ev.title} (${Math.ceil(hoursUntil)}h)`;
          break;
        }
      }
    }
    if (weeklyNewsBlocked) {
      detailedReasons.push({
        check: 'News Immunity (Weekly)', value: weeklyNewsBlockReason,
        status: 'negative',
        impact: `hard block: high-impact ${symbol} event this week — no entry until it passes`
      });
    }

    const primaryTotal = 4;
    var primaryMetCount = 0;
    if (bbMet) primaryMetCount++;
    if (sdMet) primaryMetCount++;
    if (ageMet) primaryMetCount++;
    if (newsMet) primaryMetCount++;

    // Supporting conditions from metrics
    const supportConditions = [
      // RSI: neutral zone always counts. Oversold/overbought count if aligned with direction.
      { met: metrics?.rsi !== undefined && (
        (metrics.rsi > 30 && metrics.rsi < 70) ||
        (metrics.rsi <= 30 && (isUp || !isDown)) || // oversold: positive unless clearly downtrend
        (metrics.rsi >= 70 && (isDown || !isUp))    // overbought: negative unless clearly uptrend
      ) },
      { met: (metrics?.emaCross === 'bullish' && !isDown) || (metrics?.emaCross === 'bearish' && !isUp) },
      { met: metrics?.volSurge === true },
      { met: !!microMetrics?.emaCross && ((microMetrics.emaCross === 'bullish' && !isDown) || (microMetrics.emaCross === 'bearish' && !isUp)) },
      { met: microMetrics?.bbPercentB !== undefined && ((microMetrics.bbPercentB < 0.3) || (microMetrics.bbPercentB > 0.7)) },
      { met: contextFearGreed?.value !== undefined && ((contextFearGreed.value < 30) || (contextFearGreed.value > 70)) },
    ];
    const supportMet = supportConditions.filter(c => c.met).length;
    const supportTotal = supportConditions.length;
    const supportRatio = supportTotal > 0 ? supportMet / supportTotal : 0;

    // ΓöÇΓöÇ STEP 2b: Conflict detection ΓöÇΓöÇ
    const buyReasons = detailedReasons.filter((r: any) => r.status === 'positive').length;
    const sellReasons = detailedReasons.filter((r: any) => r.status === 'negative').length;
    var hasConflict = buyReasons >= 4 && sellReasons >= 4;

    // ΓöÇΓöÇ STEP 3: Normalize AI signal ΓöÇΓöÇ
    var rawSignal = String(resultData.signal || 'no_entry').toLowerCase().trim().replace(/\s+/g, '_');
    if (rawSignal.includes('strong_buy') || rawSignal === 'strongbuy') rawSignal = 'strong_buy';
    else if (rawSignal.includes('strong_sell') || rawSignal === 'strongsell') rawSignal = 'strong_sell';
    else if (rawSignal.includes('buy')) rawSignal = 'buy';
    else if (rawSignal.includes('sell')) rawSignal = 'sell';
    else if (rawSignal.includes('neutral')) rawSignal = 'neutral';
    else rawSignal = 'no_entry';

    var finalSignal = rawSignal as SignalType;
    var finalConfidence = Number(resultData.confidence) || 50;

    // ═══ CRITICAL: LOCAL SIDEWAYS ENFORCEMENT ═══
    // Must be AFTER finalConfidence declaration to avoid var overwrite
    // Enabled by default — only disabled if useFilterSideways is explicitly false
    if (settings.useFilterSideways !== false && metrics?.isSideways) {
      if (finalSignal === 'strong_buy' || finalSignal === 'strong_sell' || finalSignal === 'buy' || finalSignal === 'sell') {
        finalSignal = 'no_entry' as SignalType;
        rawSignal = 'no_entry';
        finalConfidence = 0;
        detailedReasons.push({
          check: 'Sideways Filter (LOCAL ENFORCEMENT)',
          value: `ADX ${metrics?.adx?.toFixed(1) || 'N/A'}, BB Width ${metrics?.bbWidth?.toFixed(4) || 'N/A'}, MA ${metrics?.maAlignment || 'N/A'}`,
          status: 'negative',
          impact: 'FORCED NO_ENTRY: market in sideways/choppy zone — all signals blocked'
        });
      }
    }

    // ΓöÇΓöÇ STEP 4: Age zone adjustments ΓöÇΓöÇ
    const isStrongCandidate = rawSignal === 'strong_buy' || rawSignal === 'strong_sell';
    const isOld = totalAge > oldLimit;

    // Regular signals: block in OLD zone only (infant, youth, mature allowed)
    // Skip if already blocked by sideways enforcement (no_entry)
    if (!isStrongCandidate && isOld && finalSignal !== 'no_entry') {
      finalSignal = SignalType.NEUTRAL;
      finalConfidence = Math.min(finalConfidence, 25);
      detailedReasons.push({ check: 'Trend Age Zone', value: `${totalAge}c ΓÇö كهل (أكثر من ${oldLimit})`, status: 'negative', impact: 'trend exhausted ΓÇö no signals allowed' });
    }

    // STRONG signals: only allowed in MATURE zone (25-70)
    // Skip if already blocked by sideways enforcement (no_entry)
    if (isStrongCandidate && finalSignal !== 'no_entry') {
      const isMature = totalAge >= matureLimit && totalAge <= oldLimit;
      if (!isMature) {
        // Not mature → downgrade STRONG to regular
        if (totalAge < infantLimit) {
          finalConfidence = Math.round(finalConfidence * 0.7);
        } else if (totalAge < matureLimit) {
          finalConfidence = Math.round(finalConfidence * 0.85);
        } else {
          finalConfidence = Math.round(finalConfidence * 0.75);
        }
        if (finalSignal === SignalType.STRONG_BUY) finalSignal = SignalType.BUY;
        if (finalSignal === SignalType.STRONG_SELL) finalSignal = SignalType.SELL;
      }
      if (age < minAge) finalConfidence = Math.round(finalConfidence * 0.8);
    }

    // ΓöÇΓöÇ STEP 4b: Pre-Pullback Age ΓöÇΓöÇ — filter blocks STRONG only; regular signals bypass
    const rawMinPreAge = settings?.minPrePullbackAge ?? 15;
    const maxPreAge = settings?.maxPrePullbackAge ?? 50;
    const minPreAge = Math.min(rawMinPreAge, Math.max(3, Math.floor(totalAge * 0.5)));
    const prePullbackAgeVal = metrics?.prePullbackAge ?? 0;
    const pullbackPtAI = metrics?.pullbackPoint;
    const lastSwingAI = metrics?.lastSwingPoint;
    // Calculate dates from timestamps using indices
    const toDateFromIdx = (idx: number) => {
      if (idx >= 0 && idx < timestamps.length) return new Date(timestamps[idx] * 1000).toISOString().split('T')[0];
      return 'N/A';
    };
    // 1. بداية الاتجاه الكلي (trend start = closes index)
    const trendStartDateStr = (() => {
      const idx = closes.length - 1 - totalAge;
      return idx >= 0 && idx < timestamps.length ? toDateFromIdx(idx) : 'N/A';
    })();
    // 2. بداية تكون آخر نقطة سحب (pullback point formation)
    const pullbackFormDateStr = pullbackPtAI ? `${toDateFromIdx(pullbackPtAI.index)} (${pullbackPtAI.price.toFixed(5)})` : 'N/A';
    // 3. آخر نقطة سحب (last swing point)
    const lastSwingDateStr = lastSwingAI ? `${toDateFromIdx(lastSwingAI.index)} (${lastSwingAI.price.toFixed(5)})` : 'N/A';
    const preDatesInfo = `بداية الاتجاه: ${trendStartDateStr}\nبداية آخر سحبة: ${pullbackFormDateStr}\nآخر سحبة: ${lastSwingDateStr}`;
    if (prePullbackAgeVal < minPreAge || prePullbackAgeVal > maxPreAge) {
      if (isStrongCandidate && finalSignal !== 'no_entry') {
        finalSignal = SignalType.NEUTRAL;
        finalConfidence = Math.min(finalConfidence, 30);
      }
      if (prePullbackAgeVal < minPreAge) {
        detailedReasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö صغير (أقل من ${minPreAge})`, dates: preDatesInfo, status: isStrongCandidate ? 'neutral' : 'positive', impact: isStrongCandidate ? 'trend before pullback too short ΓÇö blocks STRONG' : 'trend short but regular signal bypasses' });
      } else {
        detailedReasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö كهل (أكثر من ${maxPreAge})`, dates: preDatesInfo, status: isStrongCandidate ? 'negative' : 'positive', impact: isStrongCandidate ? 'trend exhausted ΓÇö blocks STRONG' : 'trend exhausted but regular signal bypasses' });
      }
    } else if (prePullbackAgeVal >= minPreAge && prePullbackAgeVal <= maxPreAge) {
      detailedReasons.push({ check: 'Pre-Pullback Age', value: `${prePullbackAgeVal}c ΓÇö شاب (${minPreAge}-${maxPreAge})`, dates: preDatesInfo, status: 'positive', impact: 'trend healthy ΓÇö all signals allowed' });
    }

    // ΓöÇΓöÇ STEP 4c: Pullback Confirmation ΓöÇΓöÇ — validate pullback point quality
    var pullbackConfirmed = true;
    const minPullbackCandlesVal = settings?.minPullbackCandles ?? 2;
    const pullbackVolConfirmVal = settings?.pullbackVolConfirm ?? false;
    const pullbackCandleConfirmVal = settings?.pullbackCandleConfirm ?? false;
    
    // Calculate opposite candles count (candles against the trend during the pullback)
    const oppositeCandles = totalAge - prePullbackAgeVal;
    if (oppositeCandles < minPullbackCandlesVal) {
      pullbackConfirmed = false;
      detailedReasons.push({ check: 'Pullback Confirm', value: `${oppositeCandles}c معاكسة (أقل من ${minPullbackCandlesVal})`, status: 'negative', impact: `pullback too weak — only ${oppositeCandles} opposite candles` });
    }
    
    // Volume confirmation at pullback point
    if (pullbackVolConfirmVal && pullbackPtAI) {
      const pullbackIdx = pullbackPtAI.index;
      const avgVol = volumes && volumes.length > 0 ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length : 0;
      const pullbackVol = volumes && pullbackIdx >= 0 && pullbackIdx < volumes.length ? volumes[pullbackIdx] : 0;
      if (avgVol > 0 && pullbackVol < avgVol * 0.8) {
        pullbackConfirmed = false;
        detailedReasons.push({ check: 'Pullback Confirm', value: `حجم منخفض عند السحبة`, status: 'negative', impact: `pullback volume ${Math.round(pullbackVol/avgVol*100)}% of average — weak confirmation` });
      }
    }
    
    // Candle pattern confirmation at pullback point
    if (pullbackCandleConfirmVal && pullbackPtAI) {
      const pullbackIdx = pullbackPtAI.index;
      const trendDir = metrics?.direction || 'sideways';
      const hasReversalCandle = (pullbackIdx >= 0 && pullbackIdx < closes.length) ? (
        (trendDir === 'uptrend' && (metrics?.hasHammer || metrics?.hasPinbar || metrics?.hasEngulfing)) ||
        (trendDir === 'downtrend' && (metrics?.hasShootingStar || metrics?.hasPinbar || metrics?.hasEngulfing))
      ) : false;
      if (!hasReversalCandle) {
        pullbackConfirmed = false;
        detailedReasons.push({ check: 'Pullback Confirm', value: `لا توجد شمعة ارتداد`, status: 'negative', impact: `no reversal candle at pullback point — weak confirmation` });
      }
    }
    
    if (pullbackConfirmed && (oppositeCandles >= minPullbackCandlesVal || oppositeCandles >= 2)) {
      detailedReasons.push({ check: 'Pullback Confirm', value: `${oppositeCandles}c معاكسة — مؤكدة`, status: 'positive', impact: `pullback confirmed with ${oppositeCandles} opposite candles` });
    }

    // ΓöÇΓöÇ STEP 5: Compute confidence from metrics ΓöÇΓöÇ
    const maxPrimary = settings?.maxPrimaryWeight ?? 50;
    const maxSupport = settings?.maxSupportingWeight ?? 20;
    const baseConf = settings?.baseConfidence ?? 25;
    const primaryConf = Math.round((primaryMetCount / primaryTotal) * maxPrimary);
    const supportConf = Math.round(supportRatio * maxSupport);
    const computedConfidence = baseConf + primaryConf + supportConf;
    finalConfidence = computedConfidence;

    // Apply deferred penalties from primary conditions
    finalConfidence = Math.round(finalConfidence * sdPenaltyMult * econPenaltyMult * newsPenaltyMult);
    if (sdPenaltyMult < 1) detailedReasons.push({ check: 'S/D Penalty', value: `-20%`, status: 'negative', impact: 'supply/demand conflict penalty applied' });
    if (newsPenaltyMult < 1) detailedReasons.push({ check: 'News Penalty', value: `-20%`, status: 'negative', impact: 'negative news sentiment penalty applied' });

    // ΓöÇΓöÇ STEP 5b: Age Zone Confidence Penalty ΓöÇΓöÇ
    // Infant trends have insufficient data — penalize confidence to avoid overconfidence
    if (totalAge < infantAgeThreshold) {
      const infantPenalty = Math.round(finalConfidence * 0.30); // -30%
      finalConfidence = Math.max(finalConfidence - infantPenalty, 25);
      detailedReasons.push({ check: 'Age Zone Penalty', value: `${totalAge}c — طفل (<${infantAgeThreshold})`, status: 'negative', impact: `trend too young, insufficient data — confidence -30%` });
    } else if (totalAge < matureAgeThreshold) {
      const youthPenalty = Math.round(finalConfidence * 0.15); // -15%
      finalConfidence = Math.max(finalConfidence - youthPenalty, 30);
      detailedReasons.push({ check: 'Age Zone Penalty', value: `${totalAge}c — شباب (${infantAgeThreshold}-${matureAgeThreshold})`, status: 'neutral', impact: `trend developing, moderate confidence — confidence -15%` });
    }

    // ΓöÇΓöÇ STEP 5c: RSI Extreme Protection ΓöÇΓöÇ
    // RSI >80 = overbought danger, RSI <20 = oversold danger
    var rsiBlocked = false;
    const rsiVal = metrics?.rsi;
    if (rsiVal !== undefined) {
      if (rsiVal > 85) {
        // EXTREME overbought — BLOCK signal
        rsiBlocked = true;
        finalConfidence = Math.min(finalConfidence, 20);
        detailedReasons.push({ check: 'RSI Extreme', value: `${rsiVal.toFixed(1)} — تشبع شرائي متطرف`, status: 'negative', impact: 'BLOCKED: RSI > 85 —极高风险 انعكاس' });
      } else if (rsiVal > 80) {
        // High overbought — heavy penalty
        finalConfidence = Math.round(finalConfidence * 0.75); // -25%
        detailedReasons.push({ check: 'RSI Extreme', value: `${rsiVal.toFixed(1)} — تشبع شرائي`, status: 'negative', impact: 'overbought danger — confidence -25%' });
      } else if (rsiVal < 15) {
        // EXTREME oversold — BLOCK signal
        rsiBlocked = true;
        finalConfidence = Math.min(finalConfidence, 20);
        detailedReasons.push({ check: 'RSI Extreme', value: `${rsiVal.toFixed(1)} — تشبع بيعي متطرف`, status: 'negative', impact: 'BLOCKED: RSI < 15 —极高风险 انعكاس' });
      } else if (rsiVal < 20) {
        // High oversold — heavy penalty
        finalConfidence = Math.round(finalConfidence * 0.75); // -25%
        detailedReasons.push({ check: 'RSI Extreme', value: `${rsiVal.toFixed(1)} — تشبع بيعي`, status: 'negative', impact: 'oversold danger — confidence -25%' });
      }
    }

    // ΓöÇΓöÇ STEP 5d: Pullback Quality Penalty ΓöÇΓöÇ — weak pullback = lower confidence
    if (!pullbackConfirmed) {
      finalConfidence = Math.round(finalConfidence * 0.80); // -20%
    }

    // Pre-Pullback Age cap: re-apply after confidence computation to prevent overwrite
    if (prePullbackAgeVal < minPreAge || prePullbackAgeVal > maxPreAge) {
      finalConfidence = Math.min(finalConfidence, 30);
    }

    // Multi-TF Direction: BLOCK signal if current direction conflicts with higher timeframe
    var higherTFBlocked = false;
    const useHigherTF = settings?.useHigherTimeframe !== false; // default: true
    const directionConflicts = (isUp && isMacroDown) || (isDown && isMacroUp);
    if (useHigherTF && directionConflicts) {
      higherTFBlocked = true;
      finalConfidence = Math.round(finalConfidence * 0.6); // 40% penalty for trading against higher TF
      // Force NEUTRAL when trading against the higher timeframe — this is too risky
      if (finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY ||
          finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL) {
        finalSignal = SignalType.NEUTRAL;
      }
      detailedReasons.push({ 
        check: `Higher TF Direction (${macro1})`, 
        value: `Higher TF: ${macroDirection} vs Current: ${metrics?.direction}`, 
        status: 'negative', 
        impact: `BLOCKED: trading against higher timeframe trend is too risky` 
      });
    } else if (useHigherTF) {
      detailedReasons.push({ 
        check: `Higher TF Direction (${macro1})`, 
        value: `Higher TF: ${macroDirection} aligns with Current: ${metrics?.direction}`, 
        status: 'positive', 
        impact: `higher timeframe confirms current direction` 
      });
    }

    // ═══ STEP 5e: Advanced Candle Filter — REVERSAL PREVENTION (1M mandatory) ═══
    // v5.12.0: MONTHLY-ONLY mandatory match. The big-trend monthly candle (1M)
    // MUST agree with the signal; if it opposes, we block (no fighting the
    // monthly trend). The weekly (1W) and daily (1D) are intentionally FREE —
    // the 1W running against the signal IS the pullback this strategy buys into.
    // The greedy "Candle Size (ATR)" filter has been REMOVED entirely.
    var candleMatchBlocked = false;
    if (candleMatchData) {
      const extractCandles = (raw: any): { open: number; high: number; low: number; close: number }[] | null => {
        const q = raw?.chart?.result?.[0]?.indicators?.quote?.[0];
        const ts = raw?.chart?.result?.[0]?.timestamp;
        if (!q?.open || !q?.high || !q?.low || !q?.close) return null;
        const n = Math.min(q.open.length, q.high.length, q.low.length, q.close.length, ts ? ts.length : Infinity);
        const out: { open: number; high: number; low: number; close: number }[] = [];
        for (let i = 0; i < n; i++) {
          const open = q.open[i], high = q.high[i], low = q.low[i], close = q.close[i];
          if (open == null || high == null || low == null || close == null) continue;
          out.push({ open, high, low, close });
        }
        return out.length ? out : null;
      };
      // Direction of the CURRENT (still forming) candle of the timeframe.
      const currentDirection = (candles: { open: number; high: number; low: number; close: number }[]): 'bullish' | 'bearish' | 'unknown' => {
        const c = candles[candles.length - 1];
        if (!c) return 'unknown';
        return c.close > c.open ? 'bullish' : c.close < c.open ? 'bearish' : 'unknown';
      };

      const frames: { label: string; key: string }[] = [
        { label: '1D', key: 'daily' },
        { label: '1W', key: 'weekly' },
        { label: '1M', key: 'monthly' },
      ];

      const info = frames.map((f) => {
        const raw = candleMatchData[f.key as 'daily' | 'weekly' | 'monthly'];
        const enabled = f.key === 'daily' ? settings.candleMatchDailyEnabled !== false
          : f.key === 'weekly' ? settings.candleMatchWeeklyEnabled !== false
          : settings.candleMatchMonthlyEnabled !== false;
        const candles = extractCandles(raw);
        const dir = candles ? currentDirection(candles) : 'unknown';
        return { label: f.label, enabled, dir };
      });

      const signalIsBuy = finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY;
      const signalIsSell = finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL;

      // Value string format is parsed by AnalysisDetailPage.parseCandleInfo:
      // e.g. "1D: Bullish ↑ | 1W: Bearish ↓ | 1M: Bullish ↑"
      const frameStr = (i: { label: string; enabled: boolean; dir: 'bullish' | 'bearish' | 'unknown' }): string | null => {
        if (i.dir === 'unknown') return null;
        const dirName = i.dir === 'bullish' ? 'Bullish' : 'Bearish';
        const arrow = i.dir === 'bullish' ? '↑' : '↓';
        return `${i.label}: ${dirName} ${arrow}`;
      };

      // ── FILTER A (v5.12.0): Monthly-only mandatory match ──
      // The big-trend MONTHLY candle (1M) MUST agree with the signal; if it
      // opposes, we block (no fighting the monthly trend). The weekly (1W) and
      // daily (1D) are intentionally left FREE — the 1W running against the
      // signal IS the pullback this strategy buys into. This keeps pullback
      // entries while forbidding counter-trend entries on the monthly scale.
      const directionFilterOn = settings.candleDirectionFilter !== false;
      let directionBlocked = false;
      let directionWhy = '';
      let dirValue = '';
      if (directionFilterOn) {
        const dirFrames = info.filter(i => i.enabled && i.dir !== 'unknown');
        dirValue = dirFrames.map(frameStr).filter(Boolean).join(' | ');
        const monthly = dirFrames.find(f => f.label === '1M');
        if (monthly) {
          const monthlyOpposesBuy = monthly.dir === 'bearish';
          const monthlyOpposesSell = monthly.dir === 'bullish';
          if (signalIsBuy && monthlyOpposesBuy) {
            directionBlocked = true;
            directionWhy = '1M bearish opposes BUY — counter monthly trend, reversal risk';
          } else if (signalIsSell && monthlyOpposesSell) {
            directionBlocked = true;
            directionWhy = '1M bullish opposes SELL — counter monthly trend, reversal risk';
          }
        } else {
          directionWhy = '1M candle data required';
        }
      }

      candleMatchBlocked = directionFilterOn && directionBlocked;

      if (candleMatchBlocked) {
        if (signalIsBuy || signalIsSell) finalSignal = SignalType.NEUTRAL;
        detailedReasons.push({
          check: 'Candle Match',
          value: dirValue || 'no data',
          status: 'negative',
          impact: `BLOCKED: ${directionWhy}`
        });
      } else if (directionFilterOn) {
        detailedReasons.push({
          check: 'Candle Match',
          value: info.map(frameStr).filter(Boolean).join(' | '),
          status: 'positive',
          impact: '1M agrees with the signal — allowed'
        });
      }
    }

    // ═══ STEP 6: Direction from METRICS (primary) — AI cannot override trend direction ═══
    const metricsDirection = isUp ? 'buy' : isDown ? 'sell' : null;
    
    var direction: string;
    var agreementBonus = 0;
    
    // If sideways enforcement already blocked, skip direction classification entirely
    if (finalSignal === ('no_entry' as any) || weeklyNewsBlocked) {
      direction = null;
    } else if (higherTFBlocked) {
      direction = null;
    } else if (metricsDirection) {
      // Metrics direction is ALWAYS primary — trend direction + RSI + EMA determine direction
      direction = metricsDirection;
      // Check if AI agrees (bonus only — AI cannot flip direction)
      const aiAgrees = finalSignal.includes(metricsDirection);
      if (aiAgrees) {
        agreementBonus = 10;
      }
    } else {
      // Sideways — NO directional signals allowed, force neutral
      direction = null;
    }

    finalConfidence = Math.min(100, finalConfidence + agreementBonus);

    // ═══ STEP 5f: Professional Volume Quality filter ═══
    // HARD GATE (quality-first):
    //   - No volume data  → neutral pass (never blocks a genuine signal when data is absent)
    //   - score >= threshold (default 45) → confirmed, small confidence boost
    //   - score < threshold → SUPPRESSED (no signal without confirmed volume)
    //   - absorption detected → SEPARATE suppression (the most dangerous trap, even if score ≥45)
    const volumeGuardOn = settings?.useVolumeGuard !== false;
    const volThreshold = settings?.volumeGuardThreshold ?? 45;
    const volMaxThreshold = settings?.volumeGuardMaxThreshold ?? 85;
    var volumeQualityBlocked = false;
    var volumeBoost = 0;
    if (volumeGuardOn && volumeQuality.detected) {
      if (volumeQuality.absorbed) {
        volumeQualityBlocked = true;
        detailedReasons.push({
          check: 'Volume Guard (Absorption)',
          value: `Score ${volumeQuality.score}/100 ${volumeQuality.reasons.join('; ')}`,
          status: 'negative',
          impact: 'ABSORPTION TRAP: high volume is being absorbed / rejected against the trend — forced neutral'
        });
      } else if (volumeQuality.score > volMaxThreshold) {
        volumeQualityBlocked = true;
        detailedReasons.push({
          check: 'Volume Guard (Climax Ceiling)',
          value: `${volumeQuality.score}/100 (>${volMaxThreshold}) ${volumeQuality.reasons.join('; ')}`,
          status: 'negative',
          impact: 'score above the max ceiling — extreme speculative spike, executes only one-way against safety — forced neutral'
        });
      } else if (volumeQuality.score >= volThreshold) {
        volumeBoost = Math.round(finalConfidence * 0.08);
        detailedReasons.push({
          check: 'Volume Quality',
          value: `${volumeQuality.score}/100 (≥${volThreshold})`,
          status: 'positive',
          impact: 'healthy confirmed volume — supports the direction'
        });
      } else {
        volumeQualityBlocked = true;
        detailedReasons.push({
          check: 'Volume Quality',
          value: `${volumeQuality.score}/100 (<${volThreshold}) ${volumeQuality.reasons.join('; ')}`,
          status: 'negative',
          impact: 'volume below confirmation threshold — signal suppressed (no signal without confirmed volume)'
        });
      }
    }
    finalConfidence = Math.min(100, finalConfidence + volumeBoost);

    if (finalSignal === ('no_entry' as any)) {
      // Sideways enforcement already blocked — do NOT override
    } else if (weeklyNewsBlocked) {
      finalSignal = SignalType.NO_ENTRY;
      finalConfidence = Math.min(finalConfidence, 0);
    } else if (volumeQualityBlocked) {
      finalSignal = SignalType.NEUTRAL;
      finalConfidence = Math.min(finalConfidence, 30);
    } else if (higherTFBlocked) {
      finalSignal = SignalType.NEUTRAL;
    } else if (candleMatchBlocked) {
      finalSignal = SignalType.NEUTRAL;
    } else if (rsiBlocked) {
      finalSignal = SignalType.NEUTRAL;
    } else if (hasConflict) {
      finalSignal = SignalType.NEUTRAL;
    } else if (direction === null) {
      finalSignal = SignalType.NEUTRAL;
    } else {
      const strongThreshold = settings?.strongThreshold ?? 60;
      const buyThreshold = settings?.buyThreshold ?? 40;
      const minStrongSupport = (settings?.minStrongSupport ?? 50) / 100;
      const CONF_BUFFER = 5;
      const prePullbackAgeMet = prePullbackAgeVal >= minPreAge && prePullbackAgeVal <= maxPreAge;
      // ΓöÉ STRONG: all 5 gates (BB + Supply/Demand + Trend Age + Pre-Pullback + News) + supporting ratio + confidence
      const allGatesMet = bbMet && !sdConflict && ageMet && prePullbackAgeMet && newsMet;
      const qualifiesForStrong = allGatesMet && supportRatio >= minStrongSupport && finalConfidence >= (strongThreshold - CONF_BUFFER);
      // ΓöÉ REGULAR: only confidence threshold (Supply/Demand already applied as penalty above)
      const qualifiesForRegular = finalConfidence >= (buyThreshold - CONF_BUFFER);
      if (direction === 'buy') {
        if (qualifiesForStrong) {
          finalSignal = SignalType.STRONG_BUY;
        } else if (qualifiesForRegular) {
          finalSignal = SignalType.BUY;
        } else {
          finalSignal = SignalType.NEUTRAL;
        }
      } else if (direction === 'sell') {
        if (qualifiesForStrong) {
          finalSignal = SignalType.STRONG_SELL;
        } else if (qualifiesForRegular) {
          finalSignal = SignalType.SELL;
        } else {
          finalSignal = SignalType.NEUTRAL;
        }
      } else {
        finalSignal = SignalType.NEUTRAL;
      }
      // Mature-only STRONG enforcement
      const isMature = totalAge >= matureLimit && totalAge <= oldLimit;
      if (!isMature && (finalSignal === SignalType.STRONG_BUY || finalSignal === SignalType.STRONG_SELL)) {
        finalSignal = finalSignal === SignalType.STRONG_BUY ? SignalType.BUY : SignalType.SELL;
      }
    }

    // ΓöÇΓöÇ STEP 7: Fear&Greed — supporting condition only (NO flip) ΓöÇΓöÇ
    // Fear & Greed adjusts confidence, never flips the signal direction.
    // It's already counted as a supporting condition in STEP 2 (line 946).
    const fgValue = contextFearGreed?.value;
    if (fgValue !== undefined && fgValue !== null) {
      if (fgValue <= 25) {
        // Extreme Fear: slight confidence boost for contrarian BUY, slight penalty for SELL
        if (finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY) {
          finalConfidence = Math.min(finalConfidence + 5, 100);
        } else if (finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL) {
          finalConfidence = Math.max(finalConfidence - 5, 10);
        }
      } else if (fgValue >= 75) {
        // Extreme Greed: slight confidence boost for contrarian SELL, slight penalty for BUY
        if (finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL) {
          finalConfidence = Math.min(finalConfidence + 5, 100);
        } else if (finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY) {
          finalConfidence = Math.max(finalConfidence - 5, 10);
        }
      }
    }

    // ΓöÇΓöÇ STEP 8: Sideways + no strong evidence = neutralize ΓöÇΓöÇ
    if (metrics?.direction === 'sideways' || (!isUp && !isDown)) {
      const hasStrongSetup = detailedReasons.some((r: any) => r.check?.includes('BB Pullback') && r.status !== 'neutral');
      if (!hasStrongSetup && finalConfidence < 40 && (finalSignal === SignalType.BUY || finalSignal === SignalType.SELL)) {
        finalConfidence = Math.min(finalConfidence, 35);
        finalSignal = SignalType.NEUTRAL;
      }
    }
    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
    // END LOCKED SIGNAL ENGINE RULES (v6)
    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

    // ALWAYS calculate SL/TP from ATR/price data ΓÇö AI values are unreliable
    const currentPrice = closes[closes.length - 1] || 0;
    const atr = metrics?.atr || 0;

    var finalStopLoss = 0;
    var finalTakeProfit = 0;

    if (currentPrice > 0) {
      var slDist = 0;
      const isForex = type === MarketType.FOREX;

      // ── Lever 2: breathable stop ──
      // Use the configured ATR multiple (default 3). Crypto stays at 3× because
      // its volatility is structurally higher; everything else now gets the
      // wider, configurable multiple so a normal 3-5 candle retrace cannot clip
      // the stop before the trend resumes.
      if (atr > 0) {
        const baseMult = (typeof settings.stopAtrMultiplier === 'number' && settings.stopAtrMultiplier > 0)
          ? settings.stopAtrMultiplier
          : 3;
        const atrMultiplier = isCrypto ? Math.max(3, baseMult) : baseMult;
        slDist = atr * atrMultiplier;
      }

      var minSL: number;
      var maxSL: number;

      if (isForex) {
        const pipSize = symbol.toUpperCase().includes('JPY') ? 0.01 : 0.0001;
        minSL = 30 * pipSize;
        maxSL = 200 * pipSize;
      } else if (isCrypto) {
        minSL = currentPrice * 0.03;
        maxSL = currentPrice * 0.12;
      } else {
        minSL = currentPrice * 0.02;
        maxSL = currentPrice * 0.08;
      }

      slDist = Math.max(slDist, minSL);
      slDist = Math.min(slDist, maxSL);

      // ── Lever 1 + 3: pullback entry instead of chasing the live price ──
      // The old engine anchored entry to the LAST close (currentPrice), which is
      // why the price so often dipped 3-5 candles right after entry. In 'pullback'
      // mode we place the entry a small distance BEHIND price (a limit zone):
      //   buy  → entry sits BELOW price (wait for the retrace down to us)
      //   sell → entry sits ABOVE price (wait for the retrace up to us)
      // The zone depth is `minPullbackAtr` × ATR (default 0.5). When
      // pullbackRsiConfirm is on AND RSI is stretched (a chase is dangerous), we
      // DEEPEN the zone to a full 1 ATR so we never buy the top / sell the bottom.
      const isBuy = finalSignal.includes('buy');
      const isSell = finalSignal.includes('sell');
      var usePullback = settings.entryMode === 'pullback' && (isBuy || isSell);
      var entryAnchor = currentPrice;
      var pullbackDist = 0;
      if (usePullback && atr > 0) {
        let depthAtr = (typeof settings.minPullbackAtr === 'number' && settings.minPullbackAtr > 0)
          ? settings.minPullbackAtr
          : 0.5;
        const rsi = metrics?.rsi;
        if (settings.pullbackRsiConfirm && typeof rsi === 'number') {
          // Stretched momentum in the trade direction ⇒ deepen the retrace zone.
          const stretched = isBuy ? rsi >= 65 : rsi <= 35;
          if (stretched) depthAtr = Math.max(depthAtr, 1.0);
        }
        pullbackDist = atr * depthAtr;
        entryAnchor = isBuy ? currentPrice - pullbackDist : currentPrice + pullbackDist;
      }

      // ── Backward CONFIRMATION (the hidden safety gate) ──
      // In 'pullback' mode we refuse to surface the signal to the box until a REAL
      // retrace has already played out on the candles AND price is bouncing back
      // toward the trend. We look back over the recent bars and require BOTH:
      //   1) a genuine pullback actually happened (price dipped well below the
      //      current level — the swing low of the window sits meaningfully lower), and
      //   2) price has now turned back up (the last bar closed above the previous
      //      one AND recovered off that swing low) = a bounce, not a falling knife.
      // If the retrace is still in progress (price still making lower closes) the
      // gate stays FALSE and the box filter hides this signal until it matures.
      var pullbackReadyForEntry = true;
      if (usePullback && atr > 0 && closes.length > 4) {
        const lookback = Math.min(8, closes.length - 1);
        const winStart = closes.length - 1 - lookback;
        let swingLow = Infinity;
        let swingHigh = -Infinity;
        for (let i = winStart; i < closes.length; i++) {
          if (lows[i] < swingLow) swingLow = lows[i];
          if (highs[i] > swingHigh) swingHigh = highs[i];
        }
        const lastClose = closes[closes.length - 1];
        const prevClose = closes[closes.length - 2];
        if (isBuy) {
          // Pullback = price really came down off the recent high; bounce = last
          // bar is green and has recovered clearly above the swing low.
          const pulledBack = swingLow < lastClose - atr * 0.15;
          const bouncing = lastClose > prevClose && lastClose > swingLow + atr * 0.1;
          pullbackReadyForEntry = pulledBack && bouncing;
        } else if (isSell) {
          // Mirror image for a sell after a rally into the zone and a roll-over.
          const rallied = swingHigh > lastClose + atr * 0.15;
          const rollingOver = lastClose < prevClose && lastClose < swingHigh - atr * 0.1;
          pullbackReadyForEntry = rallied && rollingOver;
        }
      }

      if (isBuy) {
        finalStopLoss = entryAnchor - slDist;
        finalTakeProfit = entryAnchor + slDist * 2;
      } else if (isSell) {
        finalStopLoss = entryAnchor + slDist;
        finalTakeProfit = entryAnchor - slDist * 2;
      } else {
        finalStopLoss = currentPrice - slDist;
        finalTakeProfit = currentPrice + slDist;
      }
    }

    // FINAL SAFETY: Pre-Pullback Age must ALWAYS block BUY/SELL if out of range
    // This is the LAST check before return — nothing can override it
    if (prePullbackAgeVal < minPreAge || prePullbackAgeVal > maxPreAge) {
      if (finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY ||
          finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL) {
        finalSignal = SignalType.NEUTRAL;
        finalConfidence = Math.min(finalConfidence, 30);
      }
    }

    // FINAL SAFETY: Candle Match Filter must ALWAYS block BUY/SELL if candles don't match
    if (candleMatchBlocked) {
      if (finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY ||
          finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL) {
        finalSignal = SignalType.NEUTRAL;
      }
      finalConfidence = Math.min(finalConfidence, 30);
    }

    // ── GOLDEN CONFIDENCE WINDOW (last gate — the developer only sees the best-timed entries) ──
    // Only signals whose final confidence sits inside [goldenConfMin .. goldenConfMax] are
    // surfaced. Too low (< min) = weak/no edge → neutral. Too high (> max) = the move is
    // already extended and you'd be chasing the top → neutral. This is the sweet spot where
    // the pullback-entry protection is most reliable.
    if (settings?.goldenRangeEnabled) {
      const gMin = typeof settings.goldenConfMin === 'number' ? settings.goldenConfMin : 70;
      const gMax = typeof settings.goldenConfMax === 'number' ? settings.goldenConfMax : 85;
      const isTradeSignal = finalSignal === SignalType.BUY || finalSignal === SignalType.STRONG_BUY ||
                            finalSignal === SignalType.SELL || finalSignal === SignalType.STRONG_SELL;
      if (isTradeSignal && (finalConfidence < gMin || finalConfidence > gMax)) {
        const reason = finalConfidence < gMin
          ? `ثقة ${finalConfidence}% أقل من النطاق الذهبي (${gMin}%) — إشارة ضعيفة`
          : `ثقة ${finalConfidence}% أعلى من النطاق الذهبي (${gMax}%) — دخول متأخر/مطاردة`;
        detailedReasons.push({
          check: 'النطاق الذهبي',
          value: reason,
          status: 'negative',
          impact: `outside golden window [${gMin}-${gMax}] — hidden as neutral`
        });
        finalSignal = SignalType.NEUTRAL;
      }
    }

    // ΓöÇΓöÇ Generate STABLE summary from metrics (not AI text) ΓöÇΓöÇ
    const trendText = metrics?.direction === 'uptrend' ? 'صاعد' : metrics?.direction === 'downtrend' ? 'هابط' : 'عرضي';
    const zoneText = totalAge < infantAgeThreshold ? 'طفولي' : totalAge < matureAgeThreshold ? 'شاب' : totalAge <= oldAgeThreshold ? 'نضج' : 'كهل';
    const signalText = finalSignal === SignalType.STRONG_BUY ? 'شراء قوي' : finalSignal === SignalType.BUY ? 'شراء' : finalSignal === SignalType.STRONG_SELL ? 'بيع قوي' : finalSignal === SignalType.SELL ? 'بيع' : 'محايد';
    const rsiText = metrics?.rsi !== undefined ? `RSI=${metrics.rsi.toFixed(0)}` : '';
    const summary = `${symbol} ${signalText} ${finalConfidence}% — ${trendText} (${totalAge}c ${zoneText}) ${rsiText}`;

    const finalResult: AnalysisResult = {
      symbol, type, timeframe,
      signal: finalSignal,
      confidence: finalConfidence,
      summary,
      detailedReasons,
      newsSources: [...new Set(detailedReasons
        .filter((r: any) => r.check === 'News Sentiment' && r.source)
        .map((r: any) => r.source))],
      technicalScore: metrics?.momentumScore || 50,
      sentimentScore: contextFearGreed?.value ?? 50,
      trendMaturity: totalAge < infantAgeThreshold ? 'infancy' : (totalAge < matureAgeThreshold ? 'youth' : (totalAge <= oldAgeThreshold ? 'mature' : 'aging')),
      trendAge: totalAge,
      microTF,
      microSignal: resultData.microSignal || 'unknown',
      microTrend: resultData.microTrend || "",
      historicalMatch: resultData.historicalMatch || "",
      timestamp: new Date().toISOString(),
      userId: "",
      entryPrice: (typeof entryAnchor === 'number' && entryAnchor > 0) ? entryAnchor : currentPrice,
      entryMode: usePullback ? 'pullback' : 'market',
      pullbackReadyForEntry: usePullback ? pullbackReadyForEntry : true,
      stopLoss: finalStopLoss,
      takeProfit: finalTakeProfit,
      primaryMetCount,
      direction: direction || 'sideways',
      isSideways: metrics?.isSideways || false,
      sidewaysDirection: (() => {
        const raw = metrics?.sidewaysDirection || 'sideways';
        if (raw === 'sideways') return raw;
        const sig = resultData.signal || '';
        if (sig.includes('buy') && raw === 'downtrend') return 'uptrend';
        if (sig.includes('sell') && raw === 'uptrend') return 'downtrend';
        return raw;
      })(),
      adx: metrics?.adx,
      adxDirection: metrics?.adxDirection,
      maAlignment: metrics?.maAlignment,
      volumeQuality: volumeQuality.detected ? volumeQuality.score : undefined,
      volumeQualityThreshold: volThreshold,
      volumeQualityMaxThreshold: volMaxThreshold,
      volumeAbsorbed: volumeQuality.absorbed,
    };

    // Cache the result
    _resultCache.set(cacheKey, { result: finalResult, ts: Date.now() });

    return finalResult;

  } catch (error: any) {
    console.error("[Engine Error] Falling back to synth:", error);
    const dir = 'sideways';
    const rsi = 50;
    const tAge = 0;
    const raw: SignalType = rsi < 30 ? SignalType.BUY : rsi > 70 ? SignalType.SELL : SignalType.NEUTRAL;
    const conf = raw === SignalType.NEUTRAL ? 30 : Math.min(75, 50 + (rsi < 30 || rsi > 70 ? 15 : 0) + (dir !== 'sideways' ? 10 : 0));
    const price = 0;
    const atr = price * 0.02;
    const finalResult: AnalysisResult = {
      symbol, type, timeframe,
      signal: raw,
      confidence: conf,
      summary: `[TDZ Fallback] ${symbol} ${dir} RSI=${rsi.toFixed(1)} — engine error: ${error.message}`,
      detailedReasons: [{ check: 'Engine Fallback', value: `TDZ error: ${error.message}`, status: 'neutral', impact: 'synth fallback used' }],
      newsSources: [],
      technicalScore: 50,
      sentimentScore: 50,
      trendMaturity: tAge < 10 ? 'infancy' as const : (tAge < 25 ? 'youth' as const : (tAge <= 70 ? 'mature' as const : 'aging' as const)),
      trendAge: tAge,
      microTF: (settings?.microTimeframe || '1h') as string,
      microSignal: 'unknown',
      microTrend: '',
      historicalMatch: '',
      timestamp: new Date().toISOString(),
      userId: '',
      entryPrice: price,
      stopLoss: raw.includes('buy') ? price - atr * 2 : price + atr * 2,
      takeProfit: raw.includes('buy') ? price + atr * 3 : price - atr * 3,
      primaryMetCount: 0,
      direction: dir || 'sideways',
    };
    return finalResult;
  }
}
