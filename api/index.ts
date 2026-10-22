// ⚠️ STALE / UNUSED — do NOT mount this in production or local dev.
// Root server.ts now imports ./api/server.ts (the same file Vercel serves via
// the /api/(.*) rewrite). This file is an older, partial copy: it has no
// /api/quote or /api/quotes route and no quote caching, so mobile live prices
// would fall back to the heavier /api/market-data and re-hit upstream on every
// poll. Keep it only for reference; prefer api/server.ts.
import express from "express";
import nodemailer from "nodemailer";

const FALLBACK_PRICES = {
  bitcoin: { usd: 67000 }, ethereum: { usd: 3200 }, litecoin: { usd: 85 },
  tron: { usd: 0.12 }, solana: { usd: 150 },
};

const app = express();
app.use(express.json());

// API Route: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "4.0-Institutional", node: process.version });
});

// API Route: Send verification email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'taybemohamed10@gmail.com',
    pass: process.env.EMAIL_APP_PASSWORD || 'chxq jkcg wcia isgi',
  },
});

app.post("/api/send-verification", async (req, res) => {
  try {
    const { email, verifyLink } = req.body;
    if (!email || !verifyLink) {
      return res.status(400).json({ error: "email and verifyLink required" });
    }
    await transporter.sendMail({
      from: '"Finalyze AI" <taybemohamed10@gmail.com>',
      to: email,
      subject: '✅ تأكيد حسابك في Finalyze AI',
      html: `
        <div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f9fafb;border-radius:16px;">
          <h2 style="color:#1e293b;text-align:center;">مرحباً بك في Finalyze AI</h2>
          <p style="color:#475569;text-align:center;font-size:15px;">
            اضغط على الزر أدناه لتأكيد حسابك وتفعيل المنصة:
          </p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${verifyLink}" style="display:inline-block;background:#10b981;color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:bold;">
              ✅ تأكيد الحساب
            </a>
          </div>
          <p style="color:#94a3b8;text-align:center;font-size:12px;">
            إذا لم تطلب هذا، تجاهل هذه الرسالة.
          </p>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error("Email send error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API Route: Register new client with API key
app.post("/api/register-client-with-key", async (req, res) => {
  try {
    const { email, uid, apiKeyType } = req.body;
    if (!email || !uid) {
      return res.status(400).json({ error: "email and uid required" });
    }

    // Store client registration with timestamp
    const clientData = {
      email: email.toLowerCase().trim(),
      uid,
      status: 'active',
      plan: 'free',
      planExpiry: null,
      registeredAt: new Date().toISOString(),
      apiKeyType: apiKeyType || 'gemini',
    };

    console.log("Registering client:", clientData);
    res.json({ success: true, message: "Client registered successfully", client: clientData });
  } catch (error: any) {
    console.error("Client registration error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API Route: Market Context - Fear & Greed Index
app.get("/api/context-fear-greed", async (_req, res) => {
  try {
    const response = await fetch("https://api.alternative.me/fng/?limit=1");
    const data = await response.json();
    const item = data?.data?.[0];
    res.json({ value: Number(item?.value) || 50, classification: item?.value_classification || "Neutral" });
  } catch {
    res.json({ value: 50, classification: "Neutral" });
  }
});

// API Route: Market Context - Latest News
app.get("/api/context-news", async (req, res) => {
  try {
    const query = (req.query.query as string) || "financial markets";
    const upper = query.toUpperCase();
    let category = 'general';
    if (upper.includes('BTC') || upper.includes('ETH') || upper.includes('SOL') || upper.includes('XRP') || upper.includes('DOGE') || upper.includes('CRYPTO')) category = 'crypto';
    else if (upper.includes('EUR') || upper.includes('GBP') || upper.includes('JPY') || upper.includes('AUD') || upper.includes('CAD') || upper.includes('NZD') || upper.includes('CHF') || upper.includes('FOREX')) category = 'forex';
    else if (upper.includes('XAU') || upper.includes('XAG') || upper.includes('XPT') || upper.includes('XPD') || upper.includes('XCU') || upper.includes('GOLD') || upper.includes('SILVER') || upper.includes('COPPER')) category = 'commodity';

    // Client sends its Finnhub key via header; fallback to env or DEMO
    const clientKey = req.headers['x-finnhub-key'] as string;
    const finnhubKey = clientKey || process.env.FINNHUB_API_KEY || 'DEMO';
    const finnhubUrl = `https://finnhub.io/api/v1/news?category=${category}&token=${finnhubKey}`;
    const resp = await fetch(finnhubUrl);
    if (resp.ok) {
      const data = await resp.json();
      const articles = (data || []).slice(0, 8).map((a: any) => ({
        title: a.headline || '',
        source: a.source || 'Finnhub'
      })).filter((a: any) => a.title);
      if (articles.length > 0) return res.json({ articles });
    }
  } catch {}
  // Fallback: Google News RSS
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(req.query.query as string || "financial markets")}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(rssUrl);
    const xml = await response.text();
    const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(1).map(m => m[1]);
    const sources = [...xml.matchAll(/<source>(.*?)<\/source>/g)].map(m => m[1]);
    const articles = titles.slice(0, 8).map((title, i) => ({
      title,
      source: sources[i] || "News"
    }));
    return res.json({ articles });
  } catch {
    res.json({ articles: [] });
  }
});

// API Route: Market Context - Economic Calendar
app.get("/api/context-econ-calendar", async (_req, res) => {
  try {
    const response = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    const data = await response.json();
    const events = (data || []).filter((e: any) => e.impact === "High" || e.impact === "Medium").slice(0, 10).map((e: any) => ({
      title: e.title,
      country: e.country,
      date: e.date,
      impact: e.impact,
      forecast: e.forecast || "-",
      previous: e.previous || "-"
    }));
    res.json({ events });
  } catch {
    res.json({ events: [] });
  }
});

// API Route: Crypto Prices (from Coingecko) for Payment Modal
app.get("/api/crypto-prices", async (_req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,litecoin,tron,solana&vs_currencies=usd", {
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (data.bitcoin?.usd) return res.json(data);
    res.json(FALLBACK_PRICES);
  } catch {
    res.json(FALLBACK_PRICES);
  }
});

// Helper: Yahoo Finance Fetch
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const fetchMarketData = async (sym: string, rangeStr: string, intervalStr: string, retries: number = 3, cacheBust: string = '') => {
  for (const host of YAHOO_HOSTS) {
    try {
      const ETF_ALTS: Record<string, string> = {
        '^GSPC': 'SPY', '^DJI': 'DIA', '^NDX': 'QQQ',
        '^FTSE': 'ISF.L', '^GDAXI': 'EWG', '^N225': 'EWJ',
        '^HSI': 'EWH', '^AXJO': 'EWA',
      };
      const yahooSym = ETF_ALTS[sym] || sym;
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=${rangeStr}&interval=${intervalStr}${cacheBust}`;
      // Try several times on the same host to ride out transient rate-limits / cold-start delays.
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Origin': 'https://finance.yahoo.com',
              'Referer': 'https://finance.yahoo.com/'
            }
          });
          clearTimeout(timeout);
          if (response.ok) {
            const data = await response.json();
            if (data.chart?.result?.[0]) {
              if (yahooSym !== sym && data.chart?.result?.[0]?.meta) {
                data.chart.result[0].meta.symbol = sym;
              }
              return data;
            }
          }
          // Small backoff before retrying the same host
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        } catch (e) {
          clearTimeout(timeout);
          // Backoff before next retry
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    } catch (e) {
      // move to next host
    }
  }
  return null;
};

// Helper: Binance Klines → Yahoo format
const SERVER_CRYPTO_MAP: Record<string, string> = {
  'BTCUSD': 'BTCUSDT', 'ETHUSD': 'ETHUSDT', 'SOLUSD': 'SOLUSDT',
  'XRPUSD': 'XRPUSDT', 'DOGEUSD': 'DOGEUSDT', 'ADAUSD': 'ADAUSDT',
  'DOTUSD': 'DOTUSDT', 'MATICUSD': 'MATICUSDT', 'LINKUSD': 'LINKUSDT',
  'UNIUSD': 'UNIUSDT', 'AVAXUSD': 'AVAXUSDT', 'ATOMUSD': 'ATOMUSDT',
  'LTCUSD': 'LTCUSDT', 'BCHUSD': 'BCHUSDT', 'XLMUSD': 'XLMUSDT',
  'TRXUSD': 'TRXUSDT', 'FILUSD': 'FILUSDT', 'APTUSD': 'APTUSDT',
  'ARBUSD': 'ARBUSDT', 'OPUSD': 'OPUSDT', 'INJUSD': 'INJUSDT',
  'TONUSD': 'TONUSDT', 'SUIUSD': 'SUIUSDT', 'NEARUSD': 'NEARUSDT',
  'SEIUSD': 'SEIUSDT', 'KASUSD': 'KASUSDT', 'KAVAUSD': 'KAVAUSDT',
  'WLDUSD': 'WLDUSDT', 'PENDLEUSD': 'PENDLEUSDT', 'JUPUSD': 'JUPUSDT',
  'STXUSD': 'STXUSDT', 'POLUSD': 'POLUSDT',
  'BTCUSDT': 'BTCUSDT', 'ETHUSDT': 'ETHUSDT', 'SOLUSDT': 'SOLUSDT',
};

function findServerCryptoPair(symbol: string): string | null {
  const upper = symbol.toUpperCase().replace(/ /g, '');
  if (SERVER_CRYPTO_MAP[upper]) return SERVER_CRYPTO_MAP[upper];
  const FIAT = new Set(['AUD','EUR','GBP','USD','JPY','NZD','CAD','CHF','MXN','ZAR','TRY','SEK','NOK','DKK','SGD','HKD','CNH','THB','INR','PLN','CZK','HUF','ILS','KRW','TWD', 'XAU','XAG','XPT','XPD','XCU','XAL']);
  if (upper.endsWith('USD') || upper.endsWith('USDT')) {
    const base = upper.replace(/USD(T)?$/, '');
    // Never misinterpret fiat-quotes like AUDUSD/GBPUSD/NZDUSD as crypto pairs.
    if (base && base.length <= 10 && !FIAT.has(base)) return `${base}USDT`;
  }
  const knownCoins = ['BTC','ETH','SOL','XRP','DOGE','ADA','DOT','MATIC','LINK',
    'UNI','AVAX','ATOM','LTC','BCH','XLM','TRX','FIL','APT','ARB','OP','INJ',
    'TON','SUI','NEAR','SEI','KAS','KAVA','WLD','PENDLE','JUP','STX','POL'];
  for (const coin of knownCoins) {
    if (upper.startsWith(coin)) return `${coin}USDT`;
  }
  return null;
}

const SERVER_INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M',
};
const SERVER_LIMIT_MAP: Record<string, number> = {
  '1m': 100, '5m': 100, '15m': 200, '1h': 200, '4h': 500,
  '1d': 365, '1w': 200, '1M': 200,
};

const BINANCE_ENDPOINTS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api3.binance.com',
  'https://data-api.binance.vision',
];

const fetchBinanceData = async (symbol: string, timeframe: string): Promise<any> => {
  const pair = findServerCryptoPair(symbol);
  if (!pair) return null;
  const interval = SERVER_INTERVAL_MAP[timeframe] || '1d';
  const limit = SERVER_LIMIT_MAP[timeframe] || 100;

  // Try ALL endpoints in parallel — first valid response wins
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 10000);
  const results = await Promise.allSettled(
    BINANCE_ENDPOINTS.map(async (base) => {
      const url = `${base}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
      const resp = await fetch(url, { signal: ac.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const klines = await resp.json();
      if (!klines || klines.length < 10) throw new Error('Too few klines');
      return klines;
    })
  );
  clearTimeout(timeout);

  const klines = results.find(r => r.status === 'fulfilled')?.value;
  if (!klines) return null;

  return {
    chart: {
      result: [{
        meta: { symbol, regularMarketTime: Math.floor(Date.now() / 1000) },
        timestamp: klines.map((k: any[]) => Math.floor(k[0] / 1000)),
        indicators: {
          quote: [{
            open: klines.map((k: any[]) => parseFloat(k[1])),
            high: klines.map((k: any[]) => parseFloat(k[2])),
            low: klines.map((k: any[]) => parseFloat(k[3])),
            close: klines.map((k: any[]) => parseFloat(k[4])),
            volume: klines.map((k: any[]) => parseFloat(k[5])),
          }]
        }
      }]
    }
  };
};

// Helper: Twelve Data OHLC → Yahoo format
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const TWELVE_DATA_INTERVALS: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week', '1M': '1month',
};
const TWELVE_DATA_OUTPUTSIZE: Record<string, number> = {
  '1m': 100, '5m': 100, '15m': 100, '30m': 100,
  '1h': 200, '4h': 200, '1d': 200, '1w': 100, '1M': 60,
};

function twelveDataSymbol(symbol: string): string | null {
  const s = symbol.toUpperCase().trim();
  
  // Forex pairs: EURUSD → EUR/USD
  const clean = s.replace(/[^A-Z]/g, '');
  if (clean.length === 6 && /^[A-Z]{6}$/.test(clean)) {
    return `${clean.slice(0, 3)}/${clean.slice(3)}`;
  }
  
  // Japanese stocks: 7203.T → 7203.T
  if (/^\d{4}\.T$/.test(s)) return s;
  
  // European stocks: ASML.AS, MC.PA, SAP.DE, SHEL.L, NESN.SW, NOVO-B.CO
  if (/\.(AS|PA|DE|L|SW|CO|MI|MCX|WSE|STO|HEL|OSL|COP)$/.test(s)) return s;
  
  // US stocks: AAPL, MSFT, TSLA, SPY, QQQ
  if (/^[A-Z]{1,5}$/.test(clean)) return s;
  
  // Crypto: BTCUSD → BTC/USD
  if (clean.length === 6 && /USD$/.test(clean)) {
    return `${clean.slice(0, 3)}/USD`;
  }
  
  return null;
}

// Yahoo symbol candidates for a forex pair, in order of reliability.
// Yahoo exposes steady daily OHLC for "EURUSD=X" (and most pairs also as
// "EUR-USD"). Used to prefer clean Yahoo candles over Twelve Data's daily
// series which can carry implausible outlier candles.
function attemptsYahooFor(symbol: string): string[] {
  const s = (symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 6) {
    return [`${s}=X`, `${s.slice(0, 3)}-${s.slice(3)}`];
  }
  return [`${s}=X`];
}

// Remove implausible outlier candles from a chart.result[0] payload. Some forex
// sources (Twelve Data, and occasionally Yahoo e.g. USDJPY=X) include isolated
// candles whose high-low range is many times the local daily median (EURUSD
// median ~0.005 but an occasional 0.10). Those become the long-wicked "hammer /
// pin bar" candles that look broken vs other platforms. We drop any candle
// whose range exceeds 5x the median range, which strips genuine data glitches
// without removing real (usually <3x) volatile days.
function sanitizeCandles(data: any): any {
  try {
    const result = (data as any)?.chart?.result?.[0];
    if (!result) return data;
    const quote = result?.indicators?.quote?.[0];
    const close = quote?.close;
    if (!Array.isArray(result.timestamp) || !Array.isArray(close)) return data;

    const ranges: number[] = [];
    for (let i = 0; i < close.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = close[i];
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
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = close[i];
      const t = result.timestamp[i];
      if (o == null || h == null || l == null || c == null || t == null) continue;
      const range = Math.abs(h - l);
      if (range > limit) { dropped++; continue; }
      keep.push(i);
    }

    if (dropped > 0 && keep.length > 0) {
      result.timestamp = keep.map((i) => result.timestamp[i]);
      quote.open = keep.map((i) => quote.open[i]);
      quote.high = keep.map((i) => quote.high[i]);
      quote.low = keep.map((i) => quote.low[i]);
      quote.close = keep.map((i) => quote.close[i]);
      if (Array.isArray(quote.volume)) quote.volume = keep.map((i) => quote.volume[i]);
      console.log(`[sanitize] dropped ${dropped} outlier candles`);
    }
  } catch (e) {
    console.warn('[sanitize] failed:', e);
  }
  return data;
}

const fetchTwelveDataOHLC = async (symbol: string, timeframe: string): Promise<any> => {
  if (!TWELVE_DATA_API_KEY) return null;
  const tdSymbol = twelveDataSymbol(symbol);
  if (!tdSymbol) return null;
  const interval = TWELVE_DATA_INTERVALS[timeframe] || '1day';
  const outputsize = TWELVE_DATA_OUTPUTSIZE[timeframe] || 200;

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12000);
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_API_KEY}`;
    const resp = await fetch(url, { signal: ac.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status === 'error' || !data.values || data.values.length === 0) return null;

    const values = [...data.values].reverse();
    return {
      chart: {
        result: [{
          meta: {
            symbol,
            dataGranularity: interval,
            regularMarketTime: Math.floor(Date.now() / 1000),
            regularMarketPrice: parseFloat(values[values.length - 1]?.close || '0'),
          },
          timestamp: values.map((v: any) => Math.floor(new Date(v.datetime).getTime() / 1000)),
          indicators: {
            quote: [{
              open: values.map((v: any) => parseFloat(v.open)),
              high: values.map((v: any) => parseFloat(v.high)),
              low: values.map((v: any) => parseFloat(v.low)),
              close: values.map((v: any) => parseFloat(v.close)),
              volume: values.map((v: any) => parseInt(v.volume || '0', 10)),
            }]
          }
        }]
      }
    };
  } catch {
    return null;
  }
};

// API Route: Market Data
app.get("/api/market-data", async (req, res) => {
  try {
    const symbol = req.query.symbol as string;
    const timeframe = (req.query.timeframe as string) || '1d';
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    const rawSymbol = symbol.toUpperCase().replace(/ /g, '');
    const customMappings: Record<string, string> = {
      'XAUUSD': 'GC=F', 'XAGUSD': 'SI=F', 'XPTUSD': 'PL=F', 'XPDUSD': 'PA=F',
      'XCUUSD': 'HG=F', 'XALUSD': 'ALI=F',
    };

    // Index CFDs → Yahoo Finance tickers
    const indexCfds: Record<string, string> = {
      'US500': '^GSPC', 'US30': '^DJI', 'US100': '^NDX',
      'UK100': '^FTSE', 'DE40': '^GDAXI', 'JP225': '^N225',
      'HK50': '^HSI', 'AU200': '^AXJO',
    };

    const isIndexCfd = !!indexCfds[rawSymbol];
    const isMetal = !!customMappings[rawSymbol] && !isIndexCfd;
    let yahooSymbol = isIndexCfd ? indexCfds[rawSymbol] : isMetal ? customMappings[rawSymbol] : rawSymbol;

    let interval = '1d';
    let range = '14d';
    
    // Timeframe Mapping
    if (timeframe === '1m') { interval = '1m'; range = '1d'; }
    else if (timeframe === '5m') { interval = '5m'; range = '5d'; }
    else if (timeframe === '15m') { interval = '15m'; range = '5d'; }
    else if (timeframe === '1h') { interval = '60m'; range = '1mo'; }
    else if (timeframe === '4h') { interval = '1h'; range = '3mo'; } 
    else if (timeframe === '1d') { interval = '1d'; range = '6mo'; }
    else if (timeframe === '1w') { interval = '1wk'; range = '2y'; }
    else if (timeframe === '1M') { interval = '1mo'; range = '5y'; }

    const hasEquals = yahooSymbol.includes('=');
    const cryptoPair = findServerCryptoPair(rawSymbol);
    const isCrypto = !!cryptoPair && !isMetal;

    // All recognized forex quote currencies
    const forexQuotes = [
      'USD', 'EUR', 'JPY', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF',
      'MXN', 'ZAR', 'TRY', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD',
      'CNH', 'THB', 'INR', 'PLN', 'CZK', 'HUF', 'ILS', 'KRW', 'TWD',
    ];
    const isForex = !isMetal && !isCrypto && !isIndexCfd && yahooSymbol.length === 6 &&
      forexQuotes.some(q => yahooSymbol.endsWith(q)) &&
      forexQuotes.some(q => yahooSymbol.startsWith(q));

    if (isCrypto) {
      const binanceData = await fetchBinanceData(rawSymbol, timeframe);
      if (binanceData) return res.json(binanceData);
    }

    // Forex data source. Twelve Data historically returned these candles first,
    // but its higher-timeframe (1d/1w/1M) series occasionally contains isolated
    // outlier candles with implausible ranges (e.g. an EURUSD daily range of 0.10
    // when the real median is ~0.005). Those become the long-wicked "hammer /
    // pin bar" candles users see vs other platforms. Yahoo's daily series is
    // clean and directly comparable to other charting platforms, so prefer it
    // for daily+ and keep Twelve Data for intraday + as a fallback.
    if (isForex) {
      const dailyUp = timeframe === '1d' || timeframe === '1w' || timeframe === '1M';
      const primary = dailyUp ? 'yahoo' : 'twelve';

      const yahooFor = dailyUp ? attemptsYahooFor(rawSymbol) : [];
      if (primary === 'yahoo') {
        for (const attempt of yahooFor) {
          const cacheBust = dailyUp ? `&_cb=${Date.now()}` : '';
          const cand = await fetchMarketData(attempt, dailyUp ? (timeframe === '1d' ? '6mo' : timeframe === '1w' ? '2y' : '5y') : '6mo', dailyUp ? (timeframe === '1d' ? '1d' : timeframe === '1w' ? '1wk' : '1mo') : '1d', 3, cacheBust);
          if (cand) {
            console.log(`[Yahoo] ${rawSymbol} ${timeframe} OK`);
            const sanitized = sanitizeCandles(cand);
            return res.json(sanitized);
          }
        }
        // Daily+: NO Twelve Data fallback — Yahoo is the only trusted source.
        // Twelve Data daily candles carry outlier spikes that corrupt charts.
        // If Yahoo failed above, fall through to the generic path (which retries Yahoo).
      } else {
        const twelveData = await fetchTwelveDataOHLC(rawSymbol, timeframe);
        if (twelveData) {
          console.log(`[TwelveData] ${rawSymbol} ${timeframe} OK`);
          return res.json(sanitizeCandles(twelveData));
        }
      }
      console.log(`[$primary] ${rawSymbol} ${timeframe} failed, falling back to generic path`);
    }

    let attempts: string[] = [];
    if (isMetal || hasEquals || isIndexCfd) {
      attempts = [yahooSymbol];
    } else if (isForex) {
      attempts = [`${yahooSymbol}=X`];
      const base = yahooSymbol.slice(0, 3);
      const quote = yahooSymbol.slice(3);
      if (base.length === 3 && quote.length === 3) {
        attempts.push(`${base}-${quote}`);
      }
    } else {
      attempts = [yahooSymbol];
      if (!yahooSymbol.includes('-')) {
        attempts.push(`${yahooSymbol}-USD`);
      }
    }

    let finalData = null;
    for (const attempt of attempts) {
      finalData = await fetchMarketData(attempt, range, interval);
      if (finalData) break;
    }

    if (!finalData) return res.status(404).json({ error: "No data found" });

    const hasQuotes = finalData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.length > 0;
    if (!hasQuotes) return res.status(404).json({ error: "No data found" });
    res.json(sanitizeCandles(finalData));
  } catch (error: any) {
    res.status(500).json({ error: "Server Error" });
  }
});

// API Route: Factory Reset — trigger redeploy from stable-v1
const STABLE_VERSION_HASH = '62c47deed780f1122533632a688f7760ff0c71f5';
const STABLE_VERSION_TAG = 'stable-v1';
const GITHUB_REPO = 'Taybe1981T/joseph-trading';
const GITHUB_ACTIONS_URL = `https://github.com/${GITHUB_REPO}/actions/new`;

app.post("/api/factory-reset", async (req, res) => {
  const errors: string[] = [];
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;

  try {
    // Strategy 1: Vercel Deploy Hook
    if (deployHookUrl) {
      const resp = await fetch(deployHookUrl, { method: 'POST' });
      if (resp.ok || resp.status < 500) {
        return res.json({
          success: true, method: 'vercel-hook',
          stableVersion: STABLE_VERSION_HASH, stableTag: STABLE_VERSION_TAG,
          message: `Factory reset via Vercel hook. Redeploying ${STABLE_VERSION_TAG}...`
        });
      }
      errors.push(`Vercel hook returned ${resp.status}`);
    }

    // Strategy 2: GitHub API force-push (uses PAT from env or request header)
    const githubToken = process.env.GITHUB_PAT || (req.body?.pat as string);
    if (githubToken) {
      const stableSha = STABLE_VERSION_HASH;
      const patchResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: stableSha, force: true })
      });
      if (patchResp.ok) {
        return res.json({
          success: true, method: 'github-force-push',
          stableVersion: STABLE_VERSION_HASH, stableTag: STABLE_VERSION_TAG,
          message: `Factory reset via GitHub force-push. Main branch reset to ${STABLE_VERSION_TAG}. Vercel will redeploy shortly.`
        });
      }
      const errData = await patchResp.json().catch(() => ({}));
      errors.push(`GitHub force-push failed: ${errData?.message || patchResp.status}`);
    }
  } catch (e: any) {
    errors.push(e.message);
  }

  // Fallback: return instructions with redirect URL
  return res.json({
    success: true, stableVersion: STABLE_VERSION_HASH, stableTag: STABLE_VERSION_TAG,
    message: `لإعادة التعيين، زُر صفحة GitHub Actions يدوياً.`,
    methods: {
      vercelHook: deployHookUrl ? 'configured' : 'missing (set VERCEL_DEPLOY_HOOK_URL)',
      githubActions: GITHUB_ACTIONS_URL,
      manual: `git fetch --tags && git push --force origin ${STABLE_VERSION_TAG}:main`
    },
    errors: errors.length > 0 ? errors : undefined,
    redirectUrl: GITHUB_ACTIONS_URL
  });
});

// API Route: Save Current Version as Stable
app.post("/api/save-stable", async (req, res) => {
  try {
    const githubToken = process.env.GITHUB_PAT || (req.body?.pat as string);
    if (!githubToken) {
      return res.json({ success: false, message: 'GitHub PAT required (set GITHUB_PAT env var or send pat in body)' });
    }

    const headers = { 'Authorization': `Bearer ${githubToken}`, 'Content-Type': 'application/json' };

    // 1. Get latest commit SHA on main
    const mainRef = await (await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, { headers })).json();
    const latestSha = mainRef.object?.sha;
    if (!latestSha) return res.json({ success: false, message: 'Could not get latest commit' });

    // 2. Update stable-v1 tag to point to latest commit
    const tagResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/tags/${STABLE_VERSION_TAG}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ sha: latestSha, force: true })
    });

    if (!tagResp.ok && tagResp.status === 404) {
      // Tag doesn't exist yet — create it
      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs`, {
        method: 'POST', headers,
        body: JSON.stringify({ ref: `refs/tags/${STABLE_VERSION_TAG}`, sha: latestSha })
      });
    } else if (!tagResp.ok) {
      const err = await tagResp.json().catch(() => ({}));
      return res.json({ success: false, message: `Tag update failed: ${err.message || tagResp.status}` });
    }

    // 3. Update stable-ref.json
    const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const commitMsg = await (await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits/${latestSha}`, { headers })).json();
    const refContent = JSON.stringify({
      stableVersion: latestSha,
      description: `${latestSha.substring(0, 7)} ${(commitMsg.message || '').split('\n')[0]}`,
      savedAt: dateStr,
      autoUpdate: true
    }, null, 2);

    // Check if stable-ref.json exists
    let existingSha: string | null = null;
    const existingResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/.backups/stable-ref.json`, { headers });
    if (existingResp.ok) {
      const existing = await existingResp.json();
      existingSha = existing.sha;
    }

    await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/.backups/stable-ref.json`, {
      method: 'PUT', headers,
      body: JSON.stringify({
        message: `Update stable-ref to ${latestSha.substring(0, 7)}`,
        content: Buffer.from(refContent).toString('base64'),
        sha: existingSha
      })
    });

    return res.json({
      success: true,
      stableVersion: latestSha,
      message: `✅ Stable version updated to ${latestSha.substring(0, 7)}`
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// API Route: AI Analysis Proxy — Groq (gsk_) or Google Gemini (AIzaSy)
app.post("/api/ai-analysis", async (req, res) => {
  try {
    const { prompt, userApiKey } = req.body;
    
    // Developer system keys are NEVER mixed into client requests. Only the
    // caller's own key is used, and it is never cached server-side.
    const key = (userApiKey || '').trim();

    if (!key) {
      return res.status(400).json({ 
        error: "API Key is required. Please set your own Google Gemini or Groq API key in the settings modal." 
      });
    }

    let result: any = null;

    // Use the client's custom key exclusively
    if (key.startsWith('AIzaSy') || key.startsWith('AQ.')) {
      result = await callGoogle(key, prompt);
    } else {
      result = await callGroq(key, prompt);
    }
    
    // If client key failed, return their specific error immediately! Never fall back to system keys.
    if (!result || result.error || !result.content) {
      const errMsg = result?.error || 'Your API key could not be successfully executed.';
      return res.status(400).json({ error: errMsg });
    }

    // If we reach here, we are guaranteed to have result.content
    return res.json({ choices: [{ message: { content: result.content } }] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function callGroq(apiKey: string, prompt: string) {
  const models = [process.env.GROQ_MODEL || "llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  let lastError = 'Groq: all models exhausted due to rate limits or invalid key';
  for (const model of models) {
    const body = {
      model: model,
      messages: [
        { role: "system", content: "You are a professional financial analyst AI. Always respond in valid JSON format." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    };
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 5000);
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ac.signal
      });
      clearTimeout(timeout);
      
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        lastError = errData?.error?.message || `Groq: HTTP ${resp.status}`;
        // If the key is invalid (400, 401, 403), abort immediately.
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
          return { error: lastError };
        }
        continue; // Try next model
      }
      
      const data = await resp.json().catch(() => ({}));
      const text = data?.choices?.[0]?.message?.content || '';
      if (text) return { content: text };
    } catch (e: any) {
      lastError = e.name === 'AbortError' ? 'Groq: Request timed out' : e.message;
    }
  }
  return { error: lastError };
}

async function callGoogle(apiKey: string, prompt: string) {
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
  let lastError = 'Google: all models exhausted due to rate limits or invalid key';
  for (const model of models) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 5000);
      
      let resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are a financial analyst. ${prompt}` }] }],
          generationConfig: { 
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        }),
        signal: ac.signal
      });
      clearTimeout(timeout);
      
      // If v1beta returns 404 (Not Found) or 400 (Bad Request), fallback immediately to stable v1 API endpoint!
      if (!resp.ok && (resp.status === 404 || resp.status === 400)) {
        const v1Ac = new AbortController();
        const v1Timeout = setTimeout(() => v1Ac.abort(), 5000);
        try {
          const v1Resp = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `You are a financial analyst. ${prompt}` }] }],
              generationConfig: { 
                temperature: 0.1,
                responseMimeType: "application/json"
              }
            }),
            signal: v1Ac.signal
          });
          clearTimeout(v1Timeout);
          if (v1Resp.ok) {
            resp = v1Resp;
          }
        } catch {
          clearTimeout(v1Timeout);
        }
      }
      
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        lastError = errData?.error?.message || `Google: HTTP ${resp.status}`;
        // If the key is invalid or expired (400, 401, 403), abort immediately.
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
          return { error: lastError };
        }
        continue; // Try next model
      }
      
      const data = await resp.json().catch(() => ({}));
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) return { content: text };
    } catch (e: any) {
      lastError = e.name === 'AbortError' ? 'Google: Request timed out' : e.message;
    }
  }
  return { error: lastError };
}

export default app;
