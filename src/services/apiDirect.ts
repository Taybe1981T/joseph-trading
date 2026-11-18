import { getClientOwnKeyForAnalysis } from '../lib/clientScope';
import { getCustomCryptoPair } from '../lib/customSymbols';

// Remove outlier candles whose range (high-low) exceeds median*5.
// This is a frontend safety-net: even if the API returns stale Twelve Data
// with corrupted daily candles, they get stripped before chart/analysis.
function sanitizeCandles(data: any): any {
  try {
    const result = data?.chart?.result?.[0];
    if (!result) return data;
    const quote = result?.indicators?.quote?.[0];
    const close: number[] | undefined = quote?.close;
    if (!Array.isArray(result.timestamp) || !Array.isArray(close)) return data;
    const ranges: number[] = [];
    for (let i = 0; i < close.length; i++) {
      const o = quote.open?.[i], h = quote.high?.[i], l = quote.low?.[i], c = close[i];
      if (o == null || h == null || l == null || c == null) continue;
      ranges.push(Math.abs(h - l));
    }
    if (ranges.length < 10) return data;
    const sorted = [...ranges].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (!median || median <= 0) return data;
    const limit = median * 5;
    const keep: number[] = [];
    let dropped = 0;
    for (let i = 0; i < close.length; i++) {
      const o = quote.open?.[i], h = quote.high?.[i], l = quote.low?.[i], c = close[i], t = result.timestamp[i];
      if (o == null || h == null || l == null || c == null || t == null) continue;
      if (Math.abs(h - l) > limit) { dropped++; continue; }
      keep.push(i);
    }
    if (dropped > 0 && keep.length > 0) {
      result.timestamp = keep.map((i) => result.timestamp[i]);
      quote.open = keep.map((i) => quote.open[i]);
      quote.high = keep.map((i) => quote.high[i]);
      quote.low = keep.map((i) => quote.low[i]);
      quote.close = keep.map((i) => quote.close[i]);
      if (Array.isArray(quote.volume)) quote.volume = keep.map((i) => quote.volume[i]);
      console.log(`[sanitize-frontend] dropped ${dropped} outlier candles from ${close.length}`);
    }
  } catch {}
  return data;
}

/** Yahoo has no native 4h interval: build real 4h bars from its 1h series. */
function aggregateHourlyTo4h(data: any): any {
  try {
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!Array.isArray(ts) || !q || !Array.isArray(q.close)) return data;
    const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null || ts[i] == null) continue;
      const key = Math.floor(ts[i] / (4 * 3600)) * 4 * 3600;
      const b = buckets.get(key);
      if (!b) buckets.set(key, { o, h, l, c, v: Number(q.volume?.[i]) || 0 });
      else {
        b.h = Math.max(b.h, h);
        b.l = Math.min(b.l, l);
        b.c = c;
        b.v += Number(q.volume?.[i]) || 0;
      }
    }
    const bars = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    if (bars.length < 5) return data;
    return {
      chart: {
        result: [{
          ...result,
          timestamp: bars.map(([t]) => t),
          indicators: {
            quote: [{
              open: bars.map(([, b]) => b.o),
              high: bars.map(([, b]) => b.h),
              low: bars.map(([, b]) => b.l),
              close: bars.map(([, b]) => b.c),
              volume: bars.map(([, b]) => b.v),
            }],
          },
        }],
      },
    };
  } catch {
    return data;
  }
}

const BINANCE_BASE = 'https://api.binance.com/api/v3';const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const ALTERNATIVE_BASE = 'https://api.alternative.me';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
  'https://cors-anywhere.herokuapp.com/',
];

async function fetchWithProxy(url: string, opts?: RequestInit): Promise<Response> {
  const shuffled = [...CORS_PROXIES].sort(() => Math.random() - 0.5);
  for (const proxy of shuffled) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(`${proxy}${encodeURIComponent(url)}`, { signal: ac.signal, ...opts });
      clearTimeout(timer);
      if (r.ok) return r;
    } catch {}
  }
  throw new Error('All CORS proxies failed');
}

const _dataCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 120_000;

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
};

const LIMIT_MAP: Record<string, number> = {
  '1m': 100, '5m': 100, '15m': 200, '30m': 200,
  '1h': 200, '2h': 200, '4h': 500, '6h': 500,
  '8h': 500, '12h': 500, '1d': 365, '3d': 365,
  '1w': 200, '1M': 200,
};

const CRYPTO_MAP: Record<string, string> = {
  'BTCUSD': 'BTCUSDT', 'ETHUSD': 'ETHUSDT', 'SOLUSD': 'SOLUSDT',
  'XRPUSD': 'XRPUSDT', 'DOGEUSD': 'DOGEUSDT', 'ADAUSD': 'ADAUSDT',
  'DOTUSD': 'DOTUSDT', 'MATICUSD': 'MATICUSDT', 'LINKUSD': 'LINKUSDT',
  'UNIUSD': 'UNIUSDT', 'AVAXUSD': 'AVAXUSDT', 'ATOMUSD': 'ATOMUSDT',
  'LTCUSD': 'LTCUSDT', 'BCHUSD': 'BCHUSDT', 'XLMUSD': 'XLMUSDT',
  'TRXUSD': 'TRXUSDT', 'FILUSD': 'FILUSDT', 'APTUSD': 'APTUSDT',
  'ARBUSD': 'ARBUSDT', 'OPUSD': 'OPUSDT', 'INJUSD': 'INJUSDT',
  'RUNEUSD': 'RUNEUSDT', 'AAVEUSD': 'AAVEUSDT', 'MKRUSD': 'MKRUSDT',
  'SNXUSD': 'SNXUSDT', 'CRVUSD': 'CRVUSDT', 'COMPUSD': 'COMPUSDT',
  'YFIUSD': 'YFIUSDT', 'SUSHIUSD': 'SUSHIUSDT', 'BLURUSD': 'BLURUSDT',
  'TONUSD': 'TONUSDT', 'SUIUSD': 'SUIUSDT', 'NEARUSD': 'NEARUSDT',
  'SEIUSD': 'SEIUSDT', 'KASUSD': 'KASUSDT', 'KAVAUSD': 'KAVAUSDT',
  'WLDUSD': 'WLDUSDT', 'PENDLEUSD': 'PENDLEUSDT', 'JUPUSD': 'JUPUSDT',
  'STXUSD': 'STXUSDT', 'POLUSD': 'POLUSDT',
  'BTCUSDT': 'BTCUSDT', 'ETHUSDT': 'ETHUSDT',
};

export function getApiBaseUrl(): string {
  return '';
}

function findCryptoPair(symbol: string): string | null {
  // Explicitly registered pair (any Binance market, not only USDT).
  const customPair = getCustomCryptoPair(symbol);
  if (customPair) return customPair;

  const upper = symbol.toUpperCase().replace(/ /g, '').replace(/^[A-Z0-9._-]{2,20}:/, '').replace(/[/\\_-]/g, '');
  if (CRYPTO_MAP[upper]) return CRYPTO_MAP[upper];
  if (upper.endsWith('USDT')) {
    const base = upper.slice(0, -4);
    if (base && base.length <= 10) return `${base}USDT`;
  }
  if (upper.endsWith('USD')) {
    const base = upper.slice(0, -3);
    if (base && base.length <= 10) return `${base}USDT`;
  }
  const knownCoins = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'DOT', 'MATIC', 'LINK',
    'UNI', 'AVAX', 'ATOM', 'LTC', 'BCH', 'XLM', 'TRX', 'FIL', 'APT', 'ARB', 'OP',
    'INJ', 'RUNE', 'AAVE', 'MKR', 'SNX', 'CRV', 'COMP', 'YFI', 'SUSHI', 'BLUR',
    'TON', 'SUI', 'NEAR', 'SEI', 'KAS', 'KAVA', 'WLD', 'PENDLE', 'JUP', 'STX', 'POL'];
  for (const coin of knownCoins) {
    if (upper.includes(coin)) return `${coin}USDT`;
  }
  return null;
}

function toYahooFormat(klines: any[][], symbol: string): any {
  return {
    chart: {
      result: [{
        meta: { symbol, regularMarketTime: Math.floor(Date.now() / 1000) },
        timestamp: klines.map(k => Math.floor(k[0] / 1000)),
        indicators: {
          quote: [{
            open: klines.map(k => parseFloat(k[1])),
            high: klines.map(k => parseFloat(k[2])),
            low: klines.map(k => parseFloat(k[3])),
            close: klines.map(k => parseFloat(k[4])),
            volume: klines.map(k => parseFloat(k[5])),
          }]
        }
      }]
    }
  };
}

export async function fetchFearGreedDirect(): Promise<{ value: number; classification: string }> {
  try {
    const url = `${ALTERNATIVE_BASE}/fng/?limit=1`;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    let r = await fetch(url, { signal: ac.signal });
    clearTimeout(timeout);
    if (!r.ok || r.status === 0) {
      const ac2 = new AbortController();
      const timeout2 = setTimeout(() => ac2.abort(), 10000);
      r = await fetchWithProxy(url);
      clearTimeout(timeout2);
    }
    const d = await r.json();
    const item = d?.data?.[0];
    return { value: Number(item?.value) || 50, classification: item?.value_classification || 'Neutral' };
  } catch {
    return { value: 50, classification: 'Neutral' };
  }
}

export async function fetchEconCalendarDirect(): Promise<any[]> {
  try {
    const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    let r = await fetch(url, { signal: ac.signal });
    clearTimeout(timeout);
    if (!r.ok || r.status === 0) {
      const ac2 = new AbortController();
      const timeout2 = setTimeout(() => ac2.abort(), 10000);
      r = await fetchWithProxy(url);
      clearTimeout(timeout2);
    }
    const data = await r.json();
    return (data || [])
      .filter((e: any) => e.impact === 'High')
      .slice(0, 8)
      .map((e: any) => {
        const eventDate = new Date(e.date);
        const now = new Date();
        const hoursUntil = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        let advice: 'avoid_entry' | 'caution' | 'safe' = 'safe';
        if (hoursUntil > 0 && hoursUntil <= 1) advice = 'avoid_entry';
        else if (hoursUntil > 0 && hoursUntil <= 24) advice = 'caution';
        return {
          title: e.title,
          country: e.country,
          date: e.date,
          impact: e.impact,
          forecast: e.forecast || '-',
          previous: e.previous || '-',
          advice,
          hoursUntil: Math.round(hoursUntil),
        };
      });
  } catch {
    return [];
  }
}

export async function fetchNewsDirect(query: string): Promise<any[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    let r = await fetch(url, { signal: ac.signal });
    clearTimeout(timeout);
    if (!r.ok || r.status === 0) {
      const ac2 = new AbortController();
      const timeout2 = setTimeout(() => ac2.abort(), 10000);
      r = await fetchWithProxy(url);
      clearTimeout(timeout2);
    }
    const xml = await r.text();
    const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(1).map(m => m[1]);
    const sources = [...xml.matchAll(/<source>(.*?)<\/source>/g)].map(m => m[1]);
    return titles.slice(0, 8).map((title, i) => ({ title, source: sources[i] || 'News' }));
  } catch {
    return [];
  }
}

export async function fetchCryptoPricesDirect(): Promise<any> {
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000);
    const r = await fetch(`${COINGECKO_BASE}/simple/price?ids=bitcoin,ethereum,litecoin,tron,solana,tether&vs_currencies=usd`, { signal: ac.signal });
    clearTimeout(timeout);
    if (r.ok) return await r.json();
    return {
      bitcoin: { usd: 67000 }, ethereum: { usd: 3200 },
      litecoin: { usd: 85 }, tron: { usd: 0.12 }, solana: { usd: 150 }, tether: { usd: 1 },
    };
  } catch {
    return {
      bitcoin: { usd: 67000 }, ethereum: { usd: 3200 },
      litecoin: { usd: 85 }, tron: { usd: 0.12 }, solana: { usd: 150 }, tether: { usd: 1 },
    };
  }
}

function symbolToYahooForex(symbol: string): string | null {
  // Custom TradingView inputs (NASDAQ:TSLA, FX:EURUSD, TSE:7203) are stored
  // with their exchange only for the chart; market data uses the bare ticker.
  const stripped = symbol.toUpperCase().replace(/ /g, '').replace(/^[A-Z0-9._-]{2,20}:/, '');
  const upper = stripped;

  // Metals mapping
  const metalMap: Record<string, string> = {
    'XAUUSD': 'GC=F', 'XAGUSD': 'SI=F', 'XPTUSD': 'PL=F',
    'XPDUSD': 'PA=F', 'XCUUSD': 'HG=F', 'XALUSD': 'ALI=F',
    'GOLD': 'GC=F', 'SILVER': 'SI=F', 'COPPER': 'HG=F',
  };
  if (metalMap[upper]) return metalMap[upper];

  // Index CFDs
  const indexCfds: Record<string, string> = {
    'US500': '^GSPC', 'US30': '^DJI', 'US100': '^NDX',
    'UK100': '^FTSE', 'DE40': '^GDAXI', 'JP225': '^N225',
    'HK50': '^HSI', 'AU200': '^AXJO',
  };
  if (indexCfds[upper]) return indexCfds[upper];

  // Forex pairs: EURUSD → EURUSD=X
  if (/^[A-Z]{6}$/.test(upper)) return `${upper}=X`;

  // Yahoo exchange suffixes (Tokyo 7203.T, London VOD.L, Paris MC.PA, ...).
  if (/^[A-Z0-9-]{1,20}\.[A-Z]{1,3}$/.test(upper)) return upper;

  // Crypto: BTCUSD → BTC-USD
  if (upper.endsWith('USD') && !upper.endsWith('USDT')) {
    const base = upper.replace('USD', '');
    return `${base}-USD`;
  }
  if (upper.endsWith('USDT')) {
    return upper.replace('USDT', '-USD');
  }

  // Stocks: AAPL → AAPL
  if (/^[A-Z]{1,5}$/.test(upper)) return upper;

  return null;
}

function yahooInterval(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '4h': '1h', '1d': '1d', '1w': '1wk', '1M': '1mo',
  };
  return map[timeframe] || '1d';
}

function yahooRange(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '5d', '5m': '5d', '15m': '1mo', '30m': '1mo',
    '1h': '3mo', '4h': '3mo', '1d': '1y', '1w': '2y', '1M': '5y',
  };
  return map[timeframe] || '1y';
}

async function fetchYahooFinance(symbol: string, timeframe: string): Promise<any> {
  const yahooSymbol = symbolToYahooForex(symbol);
  if (!yahooSymbol) throw new Error('Cannot convert symbol to Yahoo format');

  const interval = yahooInterval(timeframe);
  const range = yahooRange(timeframe);

  // Try multiple symbol formats like the old server did
  const base = symbol.toUpperCase().replace(/ /g, '').replace(/^[A-Z0-9._-]{2,20}:/, '').replace('USD', '').replace('-USD', '').replace('=X', '');
  const attempts = [
    yahooSymbol,                    // EURGBP=X
    `${base}-USD`,                  // EURGBP-USD (crypto fallback)
    `${base}=X`,                    // EURGBP=X again (different base)
  ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  const ranges = [range, '1mo']; // fallback to shorter range
  const intervals = [interval, '1d']; // fallback to daily

  for (const r of [range]) {
    for (const it of [interval, '1d']) {
      for (const attempt of attempts) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(attempt)}?interval=${it}&range=${r}`;

          // Try all 3 CORS proxies in shuffled order
          let resp: Response | null = null;
          const shuffled = [...CORS_PROXIES].sort(() => Math.random() - 0.5);
          for (const proxy of shuffled) {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 6000);
            try {
              resp = await fetch(`${proxy}${encodeURIComponent(url)}`, { signal: ac.signal });
              clearTimeout(timer);
              if (resp.ok) break;
              resp = null;
            } catch { clearTimeout(timer); resp = null; }
          }
          if (!resp || !resp.ok) continue;
          const data = await resp.json();
          const result = data?.chart?.result?.[0];
          if (!result) continue;

          const ts = result.timestamp;
          const q = result.indicators?.quote?.[0];
          if (!ts || !q || !q.close) continue;

          const closes = q.close.filter((c: any) => c != null);
          if (closes.length < 10) continue;

          const out = {
            chart: {
              result: [{
                meta: { symbol },
                timestamp: ts,
                indicators: {
                  quote: [{
                    open: q.open,
                    high: q.high,
                    low: q.low,
                    close: q.close,
                    volume: q.volume || ts.map(() => 0),
                  }]
                }
              }]
            }
          };
          // Yahoo has no 4h interval — the request fetched 1h bars, so build
          // genuine 4h candles before they reach the retrace filter.
          return timeframe === '4h' ? aggregateHourlyTo4h(out) : out;
        } catch {}
      }
    }
  }
  throw new Error('No Yahoo data found');
}

export async function fetchMarketDataDirect(symbol: string, timeframe: string): Promise<any> {
  const cacheKey = `${symbol}_${timeframe}`;
  const cached = _dataCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const binancePair = findCryptoPair(symbol);
  const isCrypto = !!binancePair;

  for (let attempt = 0; attempt < 2; attempt++) {
    // 1. Try server (Binance via server for crypto, Yahoo for forex/stocks/metals)
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 20000);
      const r = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`, { signal: ac.signal });
      clearTimeout(timeout);
      if (r.ok) {
        const d = await r.json();
        const hasData = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.length > 0;
        if (d && d.chart && hasData) { _dataCache.set(cacheKey, { data: sanitizeCandles(d), ts: Date.now() }); return sanitizeCandles(d); }
        console.warn(`[FetchData] ${symbol} server returned data but no valid close. hasData=${hasData}, d.chart=${!!d?.chart}`);
      } else {
        console.warn(`[FetchData] ${symbol} server responded ${r.status} ${r.statusText}`);
      }
    } catch (e: any) {
      console.warn(`[FetchData] ${symbol} attempt ${attempt + 1} error:`, e.message);
    }

    if (attempt < 1) await new Promise(r => setTimeout(r, 1000));
  }

  // Fallback: try Yahoo Finance directly via CORS proxy
  try {
    const data = await fetchYahooFinance(symbol, timeframe);
    if (data) { _dataCache.set(cacheKey, { data: sanitizeCandles(data), ts: Date.now() }); return sanitizeCandles(data); }
  } catch {}

  throw new Error('Market data currently unavailable from the source.');
}

export async function callAIDirect(prompt: string, apiKey: string): Promise<any> {
  if (!apiKey) return { error: 'No API key provided' };

  for (let attempt = 0; attempt < 2; attempt++) {
    const isGemini = apiKey.startsWith('AIzaSy') || apiKey.startsWith('AQ.');
    const isGroq = apiKey.startsWith('gsk_');

    // Try Groq first (preferred — faster, more reliable for batch)
    if (isGroq) {
      const groqResult = await callGroqDirect(prompt, apiKey);
      if (!groqResult?.error) return groqResult;
      if (attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }
      // If Groq fails, try Gemini as fallback — using THIS client's own key only.
      const k2 = getClientOwnKeyForAnalysis();
      if (k2 && k2 !== apiKey) {
        const gemResult = await callAIDirect(prompt, k2);
        if (!gemResult?.error) return gemResult;
      }
      return groqResult;
    }

    // Try Gemini
    if (isGemini) {
      const gemResult = await callGeminiDirect(prompt, apiKey);
      if (!gemResult?.error) return gemResult;
      if (attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }
      // If Gemini fails, try Groq as fallback — using THIS client's own key only.
      const k2 = getClientOwnKeyForAnalysis();
      if (k2 && k2 !== apiKey) {
        const groqResult = await callAIDirect(prompt, k2);
        if (!groqResult?.error) return groqResult;
      }
      return gemResult;
    }

    return { error: 'Unrecognized API key format. Use Google Gemini (AIza...) or Groq (gsk_...)' };
  }

  return { error: 'All AI attempts exhausted' };
}

async function callGeminiDirect(prompt: string, apiKey: string): Promise<any> {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
  for (const model of models) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 25000);
      let resp = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are a financial analyst. ${prompt}` }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        }),
        signal: ac.signal
      });
      clearTimeout(timeout);
      if (!resp.ok && (resp.status === 404 || resp.status === 400)) {
        const v1Resp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are a financial analyst. ${prompt}` }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" }
          }),
          signal: ac.signal
        });
        if (v1Resp.ok) resp = v1Resp;
      }
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || `Google: HTTP ${resp.status}`;
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) return { error: msg };
        continue;
      }
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { choices: [{ message: { content: text } }] };
    } catch (e: any) {
      if (e.name === 'AbortError') continue;
    }
  }
  return { error: 'Google AI: All models failed or timed out' };
}

async function callGroqDirect(prompt: string, apiKey: string): Promise<any> {
  const models = ["qwen/qwen3-32b", "openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct"];
  for (const model of models) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 25000);
      const resp = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: "You are a professional financial analyst AI. Always respond in valid JSON format." }, { role: "user", content: prompt }],
          temperature: 0,
          response_format: { type: "json_object" }
        }),
        signal: ac.signal
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const msg = err?.error?.message || `Groq: HTTP ${resp.status}`;
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) return { error: msg };
        continue;
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return { choices: [{ message: { content: text } }] };
    } catch (e: any) {
      if (e.name === 'AbortError') continue;
    }
  }
  return { error: 'Groq: All models exhausted' };
}

// Verify an API key actually works before the client activates their plan.
// Gemini keys start with AIzaSy/AQ., Groq keys with gsk_. Uses the cheapest
// probe (list models) so an invalid/expired key is caught immediately.
export async function validateAiKeyDirect(key: string): Promise<{ ok: boolean; error?: string }> {
  const k = (key || '').trim();
  if (!k) return { ok: false, error: 'No API key provided' };
  const isGemini = k.startsWith('AIzaSy') || k.startsWith('AQ.');
  const isGroq = k.startsWith('gsk_');
  if (isGemini) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 15000);
      const resp = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(k)}`, { signal: ac.signal });
      clearTimeout(timeout);
      if (resp.ok) return { ok: true };
      const err = await resp.json().catch(() => ({}));
      return { ok: false, error: err?.error?.message || `Google AI: HTTP ${resp.status}` };
    } catch (e: any) {
      if (e.name === 'AbortError') return { ok: false, error: 'Google AI: request timed out' };
      return { ok: false, error: 'Google AI: network error' };
    }
  }
  if (isGroq) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 15000);
      const resp = await fetch(`${GROQ_BASE}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${k}` },
        signal: ac.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) return { ok: true };
      const err = await resp.json().catch(() => ({}));
      return { ok: false, error: err?.error?.message || `Groq: HTTP ${resp.status}` };
    } catch (e: any) {
      if (e.name === 'AbortError') return { ok: false, error: 'Groq: request timed out' };
      return { ok: false, error: 'Groq: network error' };
    }
  }
  return { ok: false, error: 'Unrecognized key format. Use Google Gemini (AIza...) or Groq (gsk_...)' };
}
