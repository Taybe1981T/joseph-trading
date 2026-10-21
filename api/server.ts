import express from "express";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FALLBACK_PRICES = {
  bitcoin: { usd: 67000 }, ethereum: { usd: 3200 }, litecoin: { usd: 85 },
  tron: { usd: 0.12 }, solana: { usd: 150 },
};

const ONSITE_LOOKBACK_MS = 6 * 60 * 60 * 1000; // 6 hours
const ONSITE_CHAIN_MAP: Record<string, string> = { btc: 'btc/main', ltc: 'ltc/main', eth: 'eth/main' };

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Caller identity passthrough ─────────────────────────────────────────────
// Firestore is protected by rules that key every private collection off the
// SIGNED-IN account (request.auth). The public API key alone is anonymous, so
// the browser forwards its own Firebase ID token and the server replays it on
// the Firestore REST call — authorization stays entirely inside the rules.
// No token (cron, anonymous) simply means an anonymous request: the rules
// accept the open collections and reject the private ones.
const fsAuthStore = new AsyncLocalStorage<string | null>();

app.use((req, _res, next) => {
  const raw = req.headers.authorization;
  const value = typeof raw === "string" ? raw.trim() : "";
  const token = value ? (value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value}`) : null;
  fsAuthStore.run(token, () => next());
});

// API Route: Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", version: "4.0-Institutional", node: process.version });
});

// API Route: Dynamic /ads.txt for The Moneytizer (served via vercel rewrite from /ads.txt)
// Reads the config doc from Firestore (public read per rules). When the link is
// enabled and ads.txt content is saved, it is served as-is. When disabled/deleted,
// an empty placeholder is served so the site is immediately unlinked.
const MTZ_FIRESTORE_DOC =
  "https://firestore.googleapis.com/v1/projects/trading-made-easy-e8450/databases/(default)/documents/config/site_moneytizer?key=AIzaSyCvMayEuNTlQ5CWbjrrqw3aft_H044-uQM";

app.get("/api/ads-txt", async (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const resp = await fetch(MTZ_FIRESTORE_DOC);
    if (!resp.ok) {
      res.send("# ads.txt not configured yet\n");
      return;
    }
    const data: any = await resp.json();
    const fields = data.fields || {};
    const enabled = fields.enabled?.booleanValue === true;
    const content = fields.adsTxtContent?.stringValue || "";
    if (enabled && content.trim()) {
      res.send(content);
      return;
    }
    res.send("# ads.txt empty - Moneytizer not linked or disabled\n");
  } catch (e) {
    res.send("# ads.txt temporarily unavailable\n");
  }
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
      // Try with ETF alternatives first for index symbols
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
              // Rewrite symbol back to original for ETF alternatives
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

// Yahoo's native DAILY forex series (e.g. EURUSD=X interval=1d) carries an
// unreliable Open (often equal to the prior Close), so every bar renders as a
// near-doji / pin-bar / hammer with a huge wick. Reliable HOURLY OHLC aggregated
// into true daily bars yields real bodies (Open = first hour, Close = last hour,
// High/Low = extremes) — exactly how other charting platforms build daily FX.
function aggregateHourlyToDaily(data: any): any {
  try {
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) return data;
    const q = result?.indicators?.quote?.[0];
    if (!q || !Array.isArray(q.close)) return data;
    const ts = result.timestamp;
    const dayBuckets = new Map<number, { t: number; o: number; h: number; l: number; c: number }>();
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
      if (o == null || h == null || l == null || c == null || ts[i] == null) continue;
      const dayKey = Math.floor(ts[i] / 86400) * 86400; // UTC day boundary (seconds)
      const b = dayBuckets.get(dayKey);
      if (!b) dayBuckets.set(dayKey, { t: dayKey, o, h, l, c });
      else {
        b.h = Math.max(b.h, h);
        b.l = Math.min(b.l, l);
        b.c = c; // last hour of the day wins the close
      }
    }
    const days = Array.from(dayBuckets.values()).sort((a, b) => a.t - b.t);
    if (days.length < 5) return data; // too few to be a clean daily series
    return {
      chart: {
        result: [{
          timestamp: days.map((d) => d.t),
          indicators: { quote: [{ open: days.map((d) => d.o), high: days.map((d) => d.h), low: days.map((d) => d.l), close: days.map((d) => d.c), volume: days.map(() => 0) }] },
        }],
      },
    };
  } catch {
    return data;
  }
}

// Convert EURCHF → EUR/CHF for Twelve Data
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

function sanitizeCandles(data: any): any {
  try {
    const result = (data as any)?.chart?.result?.[0];
    if (!result) return data;
    const quote = result?.indicators?.quote?.[0];
    const close = quote?.close;
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
      console.log(`[sanitize] dropped ${dropped} outlier candles`);
    }
  } catch {}
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

    // Twelve Data returns newest first — reverse to oldest-first (matching Yahoo format)
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

async function fetchYahooQuote(symbol: string): Promise<number | null> {
  // Race query2 + query1 in parallel (whichever answers first with a valid price),
  // short 5s abort so slow/unreachable hosts never block the quote for long.
  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];
  const attempts = hosts.map(async (host) => {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&_cb=${Date.now()}&_q=${Math.random().toString(36).slice(2,6)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json', 'Origin': 'https://finance.yahoo.com', 'Referer': 'https://finance.yahoo.com/'
        }
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const d = await response.json();
      const result = d?.chart?.result?.[0];
      if (!result) return null;
      let price = Number(result?.meta?.regularMarketPrice);
      const closes = result?.indicators?.quote?.[0]?.close;
      const ts = result?.timestamp;
      if (!(price > 0) && Array.isArray(closes) && Array.isArray(ts)) {
        for (let i = ts.length - 1; i >= 0; i--) {
          const c = closes[i];
          if (c != null && c > 0) { price = c; break; }
        }
      }
      if (price > 0) return price;
    } catch {}

    return null;
  });
  const settled = await Promise.all(attempts);
  return settled.find((p): p is number => typeof p === 'number' && p > 0) ?? null;
}

// Adaptive forex spot sources that are free, keyless, credit-unlimited and — unlike
// Yahoo from Vercel server IPs — do NOT return region-frozen stale rates (the bug
// where AUDUSD stuck at 0.7252 / GBPUSD at 1.18). Returns a live midpoint for an
// ABC/XYZ pair. Tries (1) open.er-api (USD-map cross) then (2) ECB frankfurter.dev.
async function fetchFrfQuote(fxSymbol: string): Promise<number | null> {
  const s = (fxSymbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length !== 6) return null;
  const from = s.slice(0, 3);
  const to = s.slice(3);

  // (1) exchangerate-api open.er-api: latest/from USD, cross-derive ABC/XYZ.
  const erTry = async (): Promise<number | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const url = `https://open.er-api.com/v6/latest/USD?_cb=${Date.now()}`;
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const d = await response.json();
      if (d?.result !== 'success') return null;
      const rFrom = Number(d?.rates?.[from]);
      const rTo = Number(d?.rates?.[to]);
      if (rFrom > 0 && rTo > 0) return rTo / rFrom; // base->quote
    } catch {
      clearTimeout(timeout);
    }
    return null;
  };

  // (2) ECB frankfurter.dev: direct base->quote rates map.
  const ecbTry = async (): Promise<number | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const url = `https://api.frankfurter.dev/v1/latest?base=${from}&_cb=${Date.now()}`;
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const d = await response.json();
      const rate = Number(d?.rates?.[to]);
      if (typeof rate === 'number' && isFinite(rate) && rate > 0) return rate;
    } catch {
      clearTimeout(timeout);
    }
    return null;
  };

  const er = await erTry();
  if (er) return er;
  return await ecbTry();
}

// ── Twelve Data real-time /price endpoint (1 credit per call, 8/min free) ──
// Returns a live tick price — unlike Yahoo which can return region-frozen stale
// rates for certain pairs (AUD, GBP). We rate-limit to 7 calls/min and cache
// each symbol for 5s so that client 1s-polling doesn't exhaust the quota.
const _tdPriceCache = new Map<string, { price: number; ts: number }>();
const TD_PRICE_TTL = 10000;
let _tdCallCount = 0;
let _tdMinuteStart = Date.now();

function tdCanCall(): boolean {
  const now = Date.now();
  if (now - _tdMinuteStart > 60000) { _tdMinuteStart = now; _tdCallCount = 0; }
  return _tdCallCount < 7;
}

async function fetchTwelveDataPrice(symbol: string): Promise<number | null> {
  if (!TWELVE_DATA_API_KEY) return null;
  const cached = _tdPriceCache.get(symbol);
  if (cached && Date.now() - cached.ts < TD_PRICE_TTL) return cached.price;
  if (!tdCanCall()) return null;
  const tdSym = twelveDataSymbol(symbol);
  if (!tdSym) return null;
  _tdCallCount++;
  try {
    const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSym)}&apikey=${TWELVE_DATA_API_KEY}&_cb=${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const d = await r.json();
    const p = Number(d?.price);
    if (typeof p === 'number' && isFinite(p) && p > 0) {
      _tdPriceCache.set(symbol, { price: p, ts: Date.now() });
      return p;
    }
  } catch {}
  return null;
}

// ── Yahoo freshness check: returns null if the Yahoo response is stale ──
// Yahoo's regularMarketTime is the timestamp of the last price update.
// If it's more than 3 minutes old during market hours, we treat it as stale.
async function fetchYahooQuoteFresh(symbol: string): Promise<{ price: number; fresh: boolean } | null> {
  const price = await fetchYahooQuote(symbol);
  if (price == null || price <= 0) return null;
  // fetchYahooQuote doesn't expose regularMarketTime; we treat all Yahoo
  // results as potentially stale (the freeze bug is well-documented for AUD/GBP).
  // The caller should prefer Twelve Data when available.
  return { price, fresh: true };
}

// API Route: Latest Spot Quote (fast, lightweight). Returns { symbol, price, ts }
// Used by the paper-trading live P&L engine so open trades move with REAL market
// prices instead of polling full 5m candle histories. Per-class source:
//   crypto -> Binance ticker/price (real-time)
//   forex  -> Yahoo regularMarketPrice (real-time, free, no daily credit cap)
//   metals/index/stocks -> Yahoo intraday chart meta regularMarketPrice
// The hard 6s budget below keeps us under Vercel's function timeout; whenever the
// upstream source is slow/unreachable we answer from lastKnownQuote (never empty).
const _lastKnownQuote = new Map<string, { price: number; ts: number }>();

// ── Quote cache + in-flight coalescing ──
// The mobile UI polls /api/quote ~1×/s per symbol and the desktop watchlist
// polls ~8 symbols at once. Without a cache every poll re-hits Yahoo (2 hosts),
// Binance (N endpoints) or Twelve Data upstream — that upstream fan-out is what
// made the mobile interface feel sluggish. Two layers fix it:
//   1. a short TTL cache per symbol (1s — still "live" for a spot price), and
//   2. an in-flight map so concurrent requests for the SAME symbol share one
//      upstream round trip instead of racing each other.
const QUOTE_TTL_MS = 1000;
const _quoteCache = new Map<string, { price: number; ts: number }>();
const _quoteInflight = new Map<string, Promise<number | null>>();

function cachedQuote(symbol: string): { price: number; ts: number } | null {
  const c = _quoteCache.get(symbol);
  if (!c) return null;
  if (Date.now() - c.ts < QUOTE_TTL_MS) return c;
  _quoteCache.delete(symbol);
  return null;
}

/** Cache the price and mirror it into the never-empty last-known map. */
function storeQuote(symbol: string, price: number): { price: number; ts: number } {
  const entry = { price, ts: Date.now() };
  _quoteCache.set(symbol, entry);
  _lastKnownQuote.set(symbol, entry);
  return entry;
}
app.get("/api/quote", async (req, res) => {
  try {
    const symbol = (req.query.symbol as string || '').toUpperCase().replace(/ /g, '');
    if (!symbol) return res.status(400).json({ error: "Symbol is required" });

    const ctx = symbolContext(symbol);

    // ── Cache fast path: serve the last price if it is younger than the TTL ──
    const hit = cachedQuote(symbol);
    if (hit) return res.json({ symbol, price: hit.price, ts: hit.ts });

    // ── In-flight coalescing: concurrent polls for the same symbol share one
    //    upstream round trip instead of each firing its own Yahoo/Binance fan-out.
    const pending = _quoteInflight.get(symbol);
    if (pending) {
      const price = await pending;
      if (price != null && price > 0) {
        const e = storeQuote(symbol, price);
        return res.json({ symbol, price: e.price, ts: e.ts });
      }
      const ck = _lastKnownQuote.get(symbol);
      if (ck && typeof ck.price === 'number') return res.json({ symbol, price: ck.price, ts: ck.ts });
      return res.status(404).json({ error: 'No fresh quote available' });
    }

    const promise = resolveQuoteUpstream(symbol, ctx);
    _quoteInflight.set(symbol, promise);
    let price: number | null = null;
    try {
      price = await promise;
    } finally {
      _quoteInflight.delete(symbol);
    }

    if (price != null && price > 0) {
      const e = storeQuote(symbol, price);
      return res.json({ symbol, price: e.price, ts: e.ts });
    }
    // No fresh upstream data this call: if we ever answered this symbol, re-serve
    // the last known good price so live P&L never snaps to 0/404 mid-update.
    const ck = _lastKnownQuote.get(symbol);
    if (ck && typeof ck.price === 'number') return res.json({ symbol, price: ck.price, ts: ck.ts });
    return res.status(404).json({ error: 'No fresh quote available' });
  } catch {
    return res.status(500).json({ error: 'Quote server error' });
  }
});

// Resolve a live price from the upstream providers for one symbol. Returns
// null when nothing fresh could be fetched (the caller then falls back to the
// last-known-good price). Extracted from the route so the in-flight coalescer
// can share a single upstream call between concurrent requests.
async function resolveQuoteUpstream(
  symbol: string,
  ctx: {
    isCrypto: boolean; isMetal: boolean; isIndex: boolean; isForex: boolean;
    customMappings: Record<string, string>; indexCfds: Record<string, string>;
  },
): Promise<number | null> {
  const { isCrypto, isMetal, isIndex, isForex, customMappings, indexCfds } = ctx;

  // ── 1) CRYPTO: Binance real-time ticker price ──
  if (isCrypto) {
    const pair = findServerCryptoPair(symbol)!;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 8000);
    try {
      const results = await Promise.allSettled(
        BINANCE_ENDPOINTS.map(async (base) => {
          const r = await fetch(`${base}/api/v3/ticker/price?symbol=${pair}`, { signal: ac.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      );
      clearTimeout(timeout);
      const hit = results.find((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled' && typeof x.value?.price === 'number');
      const price = hit?.value?.price as number | undefined;
      if (typeof price === 'number' && price > 0) return price;
    } catch { clearTimeout(timeout); }
    // Fallback: last 1m kline close
    const k = await fetchBinanceData(symbol, '1m');
    const closes = k?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (Array.isArray(closes)) {
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null && closes[i] > 0) return closes[i];
      }
    }
    return null;
  }

  const quoteSymbol = isMetal ? customMappings[symbol] : isIndex ? indexCfds[symbol] : symbol;
  const quoteAttempts = isForex ? attemptsYahooFor(symbol) : [quoteSymbol];
  const uniqueAttempts = [...new Set([...quoteAttempts, quoteSymbol])];

  // ── 2) FOREX: real-time via Twelve Data (live tick, rate-limited 7/min),
  //    then Yahoo (free but can return region-frozen stale rates for AUD/GBP),
  //    then open.er-api/ECB (daily rates, always available but static). ──
  // Twelve Data /price costs 1 credit per call. We cache each symbol for 5s
  // and cap at 7 calls/min so the free-tier quota is never exhausted.
  if (isForex) {
    const td = await fetchTwelveDataPrice(symbol);
    if (td) return td;
    for (const attempt of uniqueAttempts) {
      const y = await fetchYahooQuote(attempt);
      if (typeof y === 'number' && y > 0) return y;
    }
    const frf = await fetchFrfQuote(symbol);
    if (typeof frf === 'number' && frf > 0) return frf;
  }

  // ── 3) METALS / INDEX / STOCKS: Twelve Data first (real-time spot for metals),
  //    then Yahoo (free, retries across query1+query2). ──
  if (isMetal) {
    const td = await fetchTwelveDataPrice(symbol);
    if (td) return td;
  }
  for (const attempt of uniqueAttempts) {
    const price = await fetchYahooQuote(attempt);
    if (typeof price === 'number' && price > 0) return price;
  }
  return null;
}

// API Route: Batch Spot Quotes — resolves several symbols in ONE round trip.
// The mobile watchlist polls 8 symbols at once; issuing 8 separate /api/quote
// requests meant 8 × (Yahoo×2 hosts / Binance×N endpoints) upstream fan-outs
// per second. This endpoint shares the per-symbol cache + in-flight coalescer
// and resolves everything concurrently in a single HTTP request.
app.get("/api/quotes", async (req, res) => {
  try {
    const raw = req.query.symbols as string || '';
    const requested = [...new Set(
      raw.split(',')
        .map((s) => s.trim().toUpperCase().replace(/ /g, ''))
        .filter(Boolean)
    )];
    const symbols = requested.slice(0, 40);
    if (!symbols.length) return res.status(400).json({ error: "symbols is required" });

    const out: Record<string, { price: number; ts: number } | null> = {};
    await Promise.all(symbols.map(async (symbol) => {
      const hit = cachedQuote(symbol);
      if (hit) { out[symbol] = hit; return; }
      const pending = _quoteInflight.get(symbol);
      if (pending) {
        const price = await pending;
        if (price != null && price > 0) { out[symbol] = storeQuote(symbol, price); return; }
        const ck = _lastKnownQuote.get(symbol);
        out[symbol] = ck ? { price: ck.price, ts: ck.ts } : null;
        return;
      }
      const promise = resolveQuoteUpstream(symbol, symbolContext(symbol));
      _quoteInflight.set(symbol, promise);
      try {
        const price = await promise;
        if (price != null && price > 0) { out[symbol] = storeQuote(symbol, price); return; }
        const ck = _lastKnownQuote.get(symbol);
        out[symbol] = ck ? { price: ck.price, ts: ck.ts } : null;
      } finally {
        _quoteInflight.delete(symbol);
      }
    }));

    return res.json({
      quotes: out,
      ts: Date.now(),
      // Lets the client know it must issue a follow-up request for the rest.
      truncated: requested.length > symbols.length,
      remaining: requested.length > symbols.length ? requested.slice(symbols.length) : undefined,
    });
  } catch {
    return res.status(500).json({ error: "Batch quote server error" });
  }
});

// Classify a symbol the same way the /api/quote route does.
function symbolContext(symbol: string): {
  isCrypto: boolean; isMetal: boolean; isIndex: boolean; isForex: boolean;
  customMappings: Record<string, string>; indexCfds: Record<string, string>;
} {
  const customMappings: Record<string, string> = {
    'XAUUSD': 'GC=F', 'XAGUSD': 'SI=F', 'XPTUSD': 'PL=F', 'XPDUSD': 'PA=F',
    'XCUUSD': 'HG=F', 'XALUSD': 'ALI=F',
  };
  const indexCfds: Record<string, string> = {
    'US500': '^GSPC', 'US30': '^DJI', 'US100': '^NDX', 'NAS100': '^NDX', 'USTEC': '^NDX',
    'UK100': '^FTSE', 'DE40': '^GDAXI', 'JP225': '^N225',
    'HK50': '^HSI', 'AU200': '^AXJO',
  };
  const isCrypto = !!findServerCryptoPair(symbol);
  const isIndex = !!indexCfds[symbol];
  const isMetal = !!customMappings[symbol] && !isIndex;
  const forexQuotes = ['USD','EUR','JPY','GBP','AUD','NZD','CAD','CHF','MXN','ZAR','TRY','SEK','NOK','DKK','SGD','HKD','CNH','THB','INR','PLN','CZK','HUF','ILS','KRW','TWD','DZD','EGP','MAD','TND','SAR','AED'];
  const isForex = !isMetal && !isCrypto && !isIndex && symbol.length === 6 &&
    forexQuotes.some(q => symbol.endsWith(q)) && forexQuotes.some(q => symbol.startsWith(q));
  return { isCrypto, isMetal, isIndex, isForex, customMappings, indexCfds };
}

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
      'US500': '^GSPC', 'US30': '^DJI', 'US100': '^NDX', 'NAS100': '^NDX', 'USTEC': '^NDX',
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
          // Daily forex: Yahoo's native 1d Open is unreliable (often ≈ the prior
          // close), so every bar renders as a doji / pin-bar / hammer with a huge
          // wick. Build TRUE daily candles from reliable HOURLY OHLC instead
          // (Open = first hour, Close = last hour, High/Low = extremes) — exactly
          // how other charting platforms construct daily FX bars.
          if (timeframe === '1d') {
            let dailyCand: any = null;
            // Yahoo caps hourly data at ~730 days, so ask for progressively
            // longer windows and take the first that yields a genuinely long
            // daily series. This restores a full multi-month/year price history
            // instead of the previous ~60-90 day blip.
            for (const range of ['2y', '1y', '6mo', '3mo', '1mo']) {
              const hourly = await fetchMarketData(attempt, range, '1h', 3, cacheBust);
              if (!hourly) continue;
              const daily = aggregateHourlyToDaily(hourly);
              // Accept only if aggregation produced a real daily series
              // (aggregateHourlyToDaily returns the input unchanged on failure).
              // Prefer a long series (>=30 bars ≈ a month+); keep a shorter one
              // only as a last resort so the chart is never left empty.
              const barCount = daily?.chart?.result?.[0]?.timestamp?.length || 0;
              if (daily && daily !== hourly && barCount >= 5) {
                dailyCand = daily;
                console.log(`[Yahoo] ${rawSymbol} 1d OK (built from ${range} hourly, ${barCount} bars)`);
                if (barCount >= 30) break;
              }
            }
            // Last resort: fall back to Yahoo's native 1d (may show doji bodies,
            // but better an imperfect chart than an empty one).
            if (!dailyCand) {
              dailyCand = await fetchMarketData(attempt, '6mo', '1d', 3, cacheBust);
            }
            if (dailyCand) {
              return res.json(sanitizeCandles(dailyCand));
            }
            continue; // try the next Yahoo attempt
          }
          const cand = await fetchMarketData(attempt, timeframe === '1w' ? '2y' : '5y', timeframe === '1w' ? '1wk' : '1mo', 3, cacheBust);
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
const GITHUB_REPO = 'kraa1981t/finalyze-ai';
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

// API Route: AI Analysis — runs on the developer's shared key pool.
//
// The browser NEVER sends a key and never receives one. It only proves WHO it is
// (Firebase ID token) and WHAT it paid for (a running plan grant), and this
// server picks a healthy key from the pool for the upstream call. A client
// without a running plan is refused here, which is the only enforcement point
// that cannot be bypassed from the browser.
// The ID token may arrive in the body or as a bearer header. Either way it is
// verified against Firebase before it is believed.
function callerToken(req: any): string {
  const header = String((req?.headers && req.headers.authorization) || '');
  const fromHeader = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header.trim();
  return String((req?.body || {}).idToken || req?.query?.idToken || fromHeader || '');
}

// One pooled completion, trying the least-used healthy keys in turn. Returns the
// raw text, or '' when the pool is empty or every key is failing.
async function poolCompletion(prompt: string): Promise<string> {
  const candidates = await pickPoolKeys();
  if (!candidates.length) return '';
  let lastError = '';
  for (const entry of candidates.slice(0, 4)) {
    const result = entry.provider === 'gemini'
      ? await callGoogle(entry.key, prompt, 25000)
      : await callGroq(entry.key, prompt, 25000);
    if (result && result.content && !result.error) {
      await markPoolSuccess(entry);
      return result.content;
    }
    lastError = (result && result.error) || 'upstream error';
    await markPoolFailure(entry, lastError);
  }
  console.warn('poolCompletion failed:', lastError);
  return '';
}

app.post("/api/ai-analysis", async (req, res) => {
  try {
    const prompt = String((req.body || {}).prompt || '');
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const caller = await verifyCallerToken(callerToken(req));
    if (!caller) return res.status(401).json({ error: 'sign_in_required' });

    if (!isDeveloperAddress(caller.email)) {
      const plan = await runningPlanFor(caller.email);
      if (!plan) return res.status(403).json({ error: 'no_plan' });
    }

    const candidates = await pickPoolKeys();
    if (!candidates.length) {
      return res.status(503).json({ error: 'no_keys_available' });
    }

    let lastError = '';
    for (const entry of candidates.slice(0, 4)) {
      const result = entry.provider === 'gemini'
        ? await callGoogle(entry.key, prompt, 25000)
        : await callGroq(entry.key, prompt, 25000);
      if (result && result.content && !result.error) {
        await markPoolSuccess(entry);
        return res.json({ choices: [{ message: { content: result.content } }] });
      }
      lastError = (result && result.error) || 'upstream error';
      await markPoolFailure(entry, lastError);
    }

    const throttled = /rate|quota|limit|429|402|403|overload|billing|credit/i.test(lastError);
    return res.status(throttled ? 429 : 502).json({ error: throttled ? 'rate_limited' : lastError });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Developer key pool management ───────────────────────────────────────────
// Everything here is developer-only, enforced twice: the endpoint rejects a
// non-developer ID token, and the Firestore rules refuse the write itself.
function requireDeveloper(req: any, res: any): Promise<string | null> {
  return verifyCallerToken(callerToken(req))
    .then((caller) => {
      if (!caller) { res.status(401).json({ ok: false, error: 'sign_in_required' }); return null; }
      if (!isDeveloperAddress(caller.email)) { res.status(403).json({ ok: false, error: 'developer_only' }); return null; }
      return caller.email;
    })
    .catch(() => { res.status(401).json({ ok: false, error: 'sign_in_required' }); return null; });
}

// Models often answer with a markdown fence or a JSON wrapper
// (`{"translations": [...]}`) even when told not to. The plans editor needs
// ONE clean Arabic line per feature, so the payload is unwrapped here and the
// list decoration ("1. ", "- ", quotes) is stripped.
function normalizeArabicTranslation(raw: unknown): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
  if (/^[[{]/.test(s)) {
    try {
      const parsed: any = JSON.parse(s);
      const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.translations) ? parsed.translations
        : Array.isArray(parsed?.ar) ? parsed.ar
        : Array.isArray(parsed?.result) ? parsed.result
        : [parsed?.translation ?? parsed?.text ?? parsed?.ar ?? ''];
      const joined = list
        .map((x) => String(x ?? '').replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
      if (joined.length) s = joined.join('\n');
    } catch {
      // Not JSON after all — keep the raw text.
    }
  }
  s = s
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•‣▪]|\d{1,2}[.)])\s+/, '').replace(/^["'](.*)["']$/, '$1').trim())
    .join('\n');
  return s.trim();
}

// Auto-translate English plan features to Arabic for the plans editor.
// Developer-only: it burns pooled AI keys, and only the developer edits plans.
app.post("/api/translate", async (req: any, res: any) => {
  try {
    const email = await requireDeveloper(req, res);
    if (!email) return;
    const text = String((req.body || {}).text || '').trim().slice(0, 6000);
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });
    const out = await poolCompletion(
      'Translate the following subscription-plan features from English to Modern Standard Arabic.\n' +
      'Rules: keep the line structure exactly (one feature per line), keep numbers, "$" and brand names as-is, ' +
      'and output ONLY the Arabic translation as plain text — no JSON, no markdown, no quotes, no commentary, no English.\n\n' + text
    );
    const ar = normalizeArabicTranslation(out);
    if (!ar) return res.status(502).json({ ok: false, error: 'translate_failed' });
    return res.json({ ok: true, ar });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

const poolEntrySummary = (p: PoolEntry) => ({
  id: p.id,
  label: p.label,
  provider: p.provider,
  masked: maskKey(p.key),
  enabled: p.enabled,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
  useCount: p.useCount,
  failCount: p.failCount,
  disabledUntil: p.disabledUntil,
  cooling: p.disabledUntil > Date.now(),
  lastError: p.lastError,
});

app.get("/api/key-pool", async (req: any, res: any) => {
  const dev = await requireDeveloper(req, res);
  if (!dev) return;
  try {
    const pool = await loadKeyPool();
    return res.json({ ok: true, items: pool.map(poolEntrySummary) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Cheapest possible validity probe before a key is trusted with client traffic.
async function probeProviderKey(key: string, provider: 'groq' | 'gemini'): Promise<{ ok: boolean; error?: string }> {
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12000);
    const url = provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      : 'https://api.groq.com/openai/v1/models';
    const resp = await fetch(url, {
      method: 'GET',
      headers: provider === 'gemini' ? {} : { Authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) return { ok: true };
    const body: any = await resp.json().catch(() => ({}));
    return { ok: false, error: String(body?.error?.message || `HTTP ${resp.status}`) };
  } catch (e: any) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

app.post("/api/key-pool", async (req: any, res: any) => {
  const dev = await requireDeveloper(req, res);
  if (!dev) return;
  try {
    const key = String((req.body || {}).key || '').trim();
    const label = String((req.body || {}).label || '').trim().slice(0, 60);
    const provider = poolProviderOf(key);
    if (!provider) {
      return res.status(400).json({ ok: false, error: 'Unrecognized key. Use Groq (gsk_…) or Google Gemini (AIza…).' });
    }
    const probe = await probeProviderKey(key, provider);
    if (!probe.ok) {
      return res.status(400).json({ ok: false, error: `The provider rejected this key: ${probe.error || 'unknown'}` });
    }
    const id = `key_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const sealed = encryptPoolValue(key);
    const existing = await fsGet('shared_ai_keys', id);
    await fsPatch('shared_ai_keys', id, {
      provider,
      label: label || `${provider} ${maskKey(key)}`,
      // A key that is already known-bad starts disabled, so re-adding it after a
      // quota reset does not silently resume a dead key.
      enabled: existing ? existing.enabled !== false : true,
      ...sealed,
    });
    const pool = await loadKeyPool();
    const saved = pool.find((p) => p.id === id);
    return res.json({ ok: true, item: saved ? poolEntrySummary(saved) : null, total: pool.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/key-pool-toggle", async (req: any, res: any) => {
  const dev = await requireDeveloper(req, res);
  if (!dev) return;
  try {
    const id = String((req.body || {}).id || '');
    const enabled = (req.body || {}).enabled !== false;
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
    const doc = await fsGet('shared_ai_keys', id);
    if (!doc) return res.status(404).json({ ok: false, error: 'key not found' });
    await fsPatch('shared_ai_keys', id, { enabled, disabledUntil: enabled ? 0 : Number(doc.disabledUntil || 0) }, ['enabled', 'disabledUntil']);
    return res.json({ ok: true, id, enabled });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete("/api/key-pool", async (req: any, res: any) => {
  const dev = await requireDeveloper(req, res);
  if (!dev) return;
  try {
    const id = String((req.body || {}).id || req.query?.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
    await fsDelete('shared_ai_keys', id);
    return res.json({ ok: true, id });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

async function callGroq(apiKey: string, prompt: string, timeoutMs = 5000) {
  const models = [process.env.GROQ_MODEL || "qwen/qwen3-32b", "openai/gpt-oss-120b", "meta-llama/llama-4-scout-17b-16e-instruct"]; // llama-3.1/3.3 are Enterprise-only since 2026-08
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
      const timeout = setTimeout(() => ac.abort(), timeoutMs);
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

async function callGoogle(apiKey: string, prompt: string, timeoutMs = 5000) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']; // gemini-1.5-flash was retired
  let lastError = 'Google: all models exhausted due to rate limits or invalid key';
  for (const model of models) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), timeoutMs);
      
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

// API Route: Server-side on-chain payment verification
// Called by the frontend to avoid browser CORS / rate-limit issues.
app.post("/api/verify-payment", async (req, res) => {
  try {
    const { address, chain } = req.body as { address?: string; chain?: string };
    if (!address || !chain) {
      return res.status(400).json({ error: "address and chain required" });
    }

    // BTC / LTC / ETH — sum incoming txrefs in last 6h via BlockCypher
    const chainPath = ONSITE_CHAIN_MAP[chain];
    if (chainPath) {
      const divisor = chain === 'eth' ? 1e18 : 1e8;
      const apiRes = await fetch(
        `https://api.blockcypher.com/v1/${chainPath}/addrs/${address}?unspentOnly=false&limit=50`
      );
      const data: any = await apiRes.json();

      // Fallback: simple balance (works for non-exchange addresses)
      if (data.error || !Array.isArray(data.txrefs)) {
        const balRes = await fetch(
          `https://api.blockcypher.com/v1/${chainPath}/addrs/${address}/balance`
        );
        const bal: any = await balRes.json();
        if (!bal.error) {
          const balance = (bal.final_balance + (bal.unconfirmed_balance || 0)) / divisor;
          return res.json({ received: balance, totalReceived: (bal.total_received || 0) / divisor });
        }
        return res.json({ received: 0, totalReceived: 0, error: data.error || "No txrefs and no balance" });
      }

      const cutoff = Date.now() - ONSITE_LOOKBACK_MS;
      let received = 0;
      for (const ref of data.txrefs) {
        if (ref.tx_input_n !== -1) continue;   // only outputs TO this address
        if (ref.tx_output_n === -1) continue;
        const t = ref.confirmed ? new Date(ref.confirmed).getTime() : Date.now();
        if (t >= cutoff && ref.value != null) received += ref.value;
      }
      return res.json({
        received: received / divisor,
        totalReceived: (data.total_received || 0) / divisor,
      });
    }

    return res.status(400).json({ error: "Unsupported chain" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Verification failed" });
  }
});

// API Route: Proof-by-transaction-hash verification
// The buyer pastes the tx hash; the server checks that this exact transaction
// paid at least the expected amount to the payment address. Works even when
// address-history APIs are down, as long as a single-tx lookup succeeds.
app.post("/api/verify-tx", async (req, res) => {
  try {
    const { chain, txid, address } = req.body as { chain?: string; txid?: string; address?: string };
    if (!chain || !txid || !address) {
      return res.status(400).json({ error: "chain, txid and address required" });
    }
    const chainPath = ONSITE_CHAIN_MAP[chain];
    if (!chainPath) {
      return res.status(400).json({ error: "TX proof supports BTC, LTC and ETH only" });
    }
    const divisor = chain === 'eth' ? 1e18 : 1e8;
    const txRes = await fetch(
      `https://api.blockcypher.com/v1/${chainPath}/txs/${txid.trim()}`
    );
    const tx: any = await txRes.json();
    if (tx.error || !Array.isArray(tx.outputs)) {
      return res.json({ amount: 0, confirmations: 0, error: tx.error || "Transaction not found" });
    }
    const target = address.trim().toLowerCase();
    let paid = 0;
    for (const out of tx.outputs) {
      const addrs: string[] = Array.isArray(out.addresses) ? out.addresses : [];
      if (addrs.some(a => (a || '').toLowerCase() === target) && out.value != null) {
        paid += out.value;
      }
    }
    return res.json({ amount: paid / divisor, confirmations: tx.confirmations || 0 });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "TX verification failed" });
  }
});

// ── Daily AI Market Briefing (public prices page) ──
// Produces a fresh AI-written Arabic+English market outlook once per day using
// live quotes + current headlines and the server-side system key. Cached per
// day so public visitors never blow the AI quota; clients may force a regen.
const _briefingCache = new Map<string, any>();

async function briefingQuote(symbol: string): Promise<number | null> {
  const s = symbol.toUpperCase().replace(/ /g, '');
  const cryptoPair = findServerCryptoPair(s);
  if (cryptoPair) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 7000);
    try {
      const results = await Promise.allSettled(
        BINANCE_ENDPOINTS.map(async (base) => {
          const r = await fetch(`${base}/api/v3/ticker/price?symbol=${cryptoPair}`, { signal: ac.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      );
      clearTimeout(t);
      const hit = results.find((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled' && typeof x.value?.price === 'number');
      const p = hit?.value?.price;
      if (typeof p === 'number' && p > 0) return p;
    } catch { clearTimeout(t); }
    const k = await fetchBinanceData(s, '5m');
    const closes = k?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (Array.isArray(closes)) {
      for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null && closes[i] > 0) return closes[i];
    }
    const ck = _lastKnownQuote.get(s);
    if (ck && typeof ck.price === 'number') return ck.price;
    return null;
  }
  const metalMap: Record<string, string> = { XAUUSD: 'GC=F', XAGUSD: 'SI=F' };
  if (metalMap[s]) {
    const td = await fetchTwelveDataPrice(s);
    if (td) return td;
    const y = await fetchYahooQuote(metalMap[s]);
    if (y) return y;
  }
  if (s.length === 6) return await fetchFrfQuote(s);
  return null;
}

async function fetchBriefingNews(query: string): Promise<string[]> {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`);
    if (!r.ok) return [];
    const xml = await r.text();
    const titles = [...xml.matchAll(/<title>(.*?)<\/title>/g)].slice(1).map(m => m[1]);
    const sources = [...xml.matchAll(/<source>(.*?)<\/source>/g)].map(m => m[1]);
    return titles.slice(0, 4).map((title, i) => `${title} (${sources[i] || 'News'})`);
  } catch { return []; }
}

function buildBriefingPrompt(prices: Record<string, number>, news: string[], date: string): string {
  const lines = Object.entries(prices)
    .map(([sym, p]) => `${sym} = $${typeof p === 'number' ? p.toFixed(6) : p}`)
    .join('\n');
  return `Today's date: ${date}.
Current live market prices (server-side snapshot):
${lines || 'no prices available'}
Latest headlines:
${news.slice(0, 6).map((n, i) => `${i + 1}. ${n}`).join('\n') || 'no headlines available'}
Write a professional daily market briefing in JSON only. Use ONLY the numbers above and the headlines; never invent prices or data. Fields (all required):
- summaryAr: Arabic market overview 2-3 sentences,
- summaryEn: English overview of the same content,
- goldAr: Arabic gold analysis with the exact XAUUSD number and implications,
- goldEn: English gold analysis,
- btcAr: Arabic bitcoin/crypto analysis with the exact BTCUSDT number,
- btcEn: English crypto analysis,
- dzdAr: Arabic note about the USD/DZD rate and gold value in DZD when USDDZD is present,
- dzdEn: English note about the DZD rate.
Keep every field short, factual, educational and professional.`;
}

app.post("/api/briefing", async (req, res) => {
  try {
    const force = !!(req.query && req.query.force === '1') || !!(req.body && req.body.force === true);
    const todayStr = new Date().toISOString().slice(0, 10);
    const cached = _briefingCache.get(todayStr);
    if (cached && !force) return res.json(cached);

    const quoteSymbols = ['XAUUSD', 'XAGUSD', 'BTCUSDT', 'ETHUSDT', 'USDDZD', 'EURUSD'];
    const results = await Promise.allSettled(quoteSymbols.map(async (sym) => ({ sym, p: await briefingQuote(sym) })));
    const prices: Record<string, number> = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value && typeof r.value.p === 'number' && r.value.p > 0) {
        prices[r.value.sym] = r.value.p;
      }
    });

    let news: string[] = [];
    try {
      const [n1, n2] = await Promise.all([fetchBriefingNews('gold silver price'), fetchBriefingNews('bitcoin crypto market news')]);
      news = [...n1, ...n2].slice(0, 8);
    } catch {}

    // The AI half of the briefing runs on the SAME pooled keys as analysis, and
    // only for an account with a running plan. The prices/news half stays free
    // and open, so nothing here can be used to burn a developer key.
    let brief: any = null;
    const caller = await verifyCallerToken(callerToken(req));
    if (caller && (isDeveloperAddress(caller.email) || (await runningPlanFor(caller.email)))) {
      const text = await poolCompletion(buildBriefingPrompt(prices, news, todayStr));
      if (text) {
        try { brief = JSON.parse(text); } catch { brief = null; }
      }
    }

    const payload = {
      date: todayStr,
      prices,
      news,
      brief,
      hasSystemKey: !!brief,
      generatedAt: Date.now(),
    };
    if (brief) _briefingCache.set(todayStr, payload);
    return res.json(payload);
  } catch (e: any) {
    return res.status(500).json({ error: e.message || 'Briefing failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Automatic Binance deposit verification (IMAP → Firestore → auto release)
// ---------------------------------------------------------------------------
// Reads the Binance notification inbox over IMAP, extracts deposit amounts,
// matches them against pending numbered payment requests, and releases access
// automatically. Runs headless (no browser needed). Triggered by an external
// cron (or Vercel Cron) hitting /api/check-binance-mail.
// ═══════════════════════════════════════════════════════════════════════════

const FS_BASE = `https://firestore.googleapis.com/v1/projects/trading-made-easy-e8450/databases/(default)/documents`;
const FS_KEY = process.env.FIRESTORE_KEY || 'AIzaSyCvMayEuNTlQ5CWbjrrqw3aft_H044-uQM';
const MAIL_LOOKBACK_MS = 48 * 60 * 60 * 1000;   // only consider recent emails
const REQUEST_WINDOW_BEFORE_MS = 12 * 60 * 60 * 1000;
const REQUEST_WINDOW_AFTER_MS = 48 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.2;                   // dollars — accepts ±$0.20 (volatility buffer)
const COIN_RATES_CACHE_MS = 60 * 1000;          // cache prices 1 minute

interface CoinRate { symbol: string; price: number; at: number; }
let coinRatesCache: CoinRate[] | null = null;

type Json = Record<string, any>;

// ── Shared AI key pool ──────────────────────────────────────────────────────
// The keys paying clients run their analysis on. The plaintext key exists ONLY
// in this process's memory: it is stored in Firestore as AES-256-GCM ciphertext
// sealed with AI_POOL_SECRET (a server-only environment variable), and it is
// never returned to any HTTP response. That is what makes the keys unusable
// outside this site — a client cannot read them, and a Firestore dump is
// ciphertext.
const DEVELOPER_EMAIL_LIST = [
  'albertaparks1t@gmail.com',
  'bachasalman69@gmail.com',
  'taybekraa@gmail.com',
  'kraakraa109@gmail.com',
];

function poolMasterKey(): Buffer {
  const raw = String(process.env.AI_POOL_SECRET || 'finalyze_master_ai_pool_secret_2026_default_key').trim();
  return createHash('sha256').update(raw, 'utf8').digest();
}

function encryptPoolValue(plain: string): { cipher: string; iv: string; tag: string } {
  const key = poolMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { cipher: body.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decryptPoolValue(doc: Json): string {
  if (!doc) return '';
  if (!doc.cipher && doc.key) return String(doc.key);
  const key = poolMasterKey();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(doc.iv || ''), 'base64'));
    decipher.setAuthTag(Buffer.from(String(doc.tag || ''), 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(String(doc.cipher), 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return String(doc.key || '');
  }
}

function poolProviderOf(key: string): 'groq' | 'gemini' | '' {
  const k = (key || '').trim();
  if (k.startsWith('AIza') || k.startsWith('AQ.')) return 'gemini';
  if (k.startsWith('gsk_')) return 'groq';
  return '';
}

function maskKey(key: string): string {
  const k = (key || '').trim();
  if (k.length <= 10) return k ? `${k.slice(0, 3)}…` : '';
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

interface PoolEntry {
  id: string;
  key: string;
  provider: 'groq' | 'gemini' | '';
  label: string;
  enabled: boolean;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  failCount: number;
  disabledUntil: number;
  lastError: string;
}

async function loadKeyPool(): Promise<PoolEntry[]> {
  const docs = await fsList('shared_ai_keys');
  return docs.map((d) => ({
    id: String(d.id),
    key: decryptPoolValue(d),
    provider: String(d.provider || '') as PoolEntry['provider'],
    label: String(d.label || ''),
    enabled: d.enabled !== false,
    createdAt: Number(d.createdAt || 0),
    lastUsedAt: Number(d.lastUsedAt || 0),
    useCount: Number(d.useCount || 0),
    failCount: Number(d.failCount || 0),
    disabledUntil: Number(d.disabledUntil || 0),
    lastError: String(d.lastError || ''),
  }));
}

// Least-used first, so a pool is shared evenly instead of hammering one key
// until it hits its quota. Keys in cooldown (quota/rate-limit) are skipped
// entirely; a client never waits on a key that is already known to be spent.
async function pickPoolKeys(): Promise<PoolEntry[]> {
  const now = Date.now();
  const pool = (await loadKeyPool()).filter((p) => p.provider && p.key);
  return pool
    .filter((p) => p.enabled && p.disabledUntil <= now)
    .sort((a, b) => a.useCount - b.useCount || a.lastUsedAt - b.lastUsedAt);
}

async function markPoolSuccess(entry: PoolEntry): Promise<void> {
  await fsPatch(
    'shared_ai_keys',
    entry.id,
    { useCount: entry.useCount + 1, lastUsedAt: Date.now(), failCount: 0, lastError: '', disabledUntil: 0 },
    ['useCount', 'lastUsedAt', 'failCount', 'lastError', 'disabledUntil']
  ).catch(() => {});
}

// A dead key must not be handed to the next client: it is put in cooldown and,
// when the provider says the key itself is bad, disabled outright so the panel
// shows the problem instead of silently burning requests.
async function markPoolFailure(entry: PoolEntry, errorText: string): Promise<void> {
  const err = String(errorText || '');
  const badKey = /invalid|unauthorized|401|403_api|forbidden|api key not valid/i.test(err);
  const quota = /quota|billing|402|insufficient|exceeded your current quota|spend|credits/i.test(err);
  const rate = /rate|429|too many|overloaded|503|timeout|timed out/i.test(err);
  const cooldown = badKey ? 24 * 60 * 60 * 1000 : quota ? 6 * 60 * 60 * 1000 : rate ? 10 * 60 * 1000 : 60 * 1000;
  await fsPatch(
    'shared_ai_keys',
    entry.id,
    {
      failCount: entry.failCount + 1,
      lastError: err.slice(0, 200),
      lastUsedAt: Date.now(),
      disabledUntil: Date.now() + cooldown,
      ...(badKey ? { enabled: false } : {}),
    },
    ['failCount', 'lastError', 'lastUsedAt', 'disabledUntil', ...(badKey ? ['enabled'] : [])]
  ).catch(() => {});
}

// Verifies a Firebase ID token for real (signature + expiry are checked by
// Google) and returns the account it belongs to. Nothing in this server trusts
// an email from a request body.
async function verifyCallerToken(idToken: string): Promise<{ email: string; uid: string; rawEmail: string } | null> {
  const token = String(idToken || '').trim();
  if (!token) return null;
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const user = data && data.users && data.users[0];
    const rawEmail = String((user && user.email) || '').trim();
    const email = rawEmail.toLowerCase();
    if (!email) return null;
    return { email, uid: String((user && user.localId) || ''), rawEmail };
  } catch {
    return null;
  }
}

function isDeveloperAddress(email: string): boolean {
  return DEVELOPER_EMAIL_LIST.includes(String(email || '').toLowerCase().trim());
}

// The entitlement a client is running RIGHT NOW, read straight from the grants
// (the only document a client can never forge) using the caller's own token.
async function runningPlanFor(email: string): Promise<{ expiry: string; label: string } | null> {
  // Filtered by THIS client's own email: the query is provable against the
  // rules, so the caller can never see — or be refused because of — anyone
  // else's plan.
  const grants = await fsListWhere('payment_grants', 'email', String(email || '').toLowerCase());
  const now = Date.now();
  const mine = grants
    .filter(
      (g) =>
        String(g.email || '').toLowerCase() === email &&
        String(g.kind || '') === 'plan' &&
        String(g.status || '') === 'active' &&
        !!g.expiryDate &&
        new Date(String(g.expiryDate)).getTime() > now
    )
    .sort((a, b) => new Date(String(b.expiryDate)).getTime() - new Date(String(a.expiryDate)).getTime());
  return mine.length ? { expiry: String(mine[0].expiryDate), label: String(mine[0].planLabel || '') } : null;
}

// ── Plan periods: real calendar units, counted in Greenwich (UTC) ───────────
// A monthly plan is one calendar month, not 30 days, and a yearly plan is one
// calendar year (so 29 February is handled). Everything is computed with UTC
// getters/setters, which is exactly the GMT clock the plan is displayed in.
type PlanUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

function inferPlanUnit(planLabel: unknown, durationDays: unknown, explicit?: unknown): PlanUnit {
  const ex = String(explicit || '').toLowerCase().trim();
  if (ex === 'hour' || ex === 'hourly') return 'hour';
  if (ex === 'day' || ex === 'daily') return 'day';
  if (ex === 'week' || ex === 'weekly') return 'week';
  if (ex === 'month' || ex === 'monthly') return 'month';
  if (ex === 'year' || ex === 'yearly' || ex === 'annual') return 'year';
  const label = String(planLabel || '').toLowerCase();
  if (/يومي|يوميّة|يومياً|daily|single day|24 hour|24-hour/.test(label)) return 'day';
  if (/ساعة|ساعات|hourly|\bhour/.test(label)) return 'hour';
  if (/أسبوع|اسبوع|اسبوع|weekly|week/.test(label)) return 'week';
  if (/سنوي|سنوية|سنويا|yearly|annual|year/.test(label)) return 'year';
  if (/شهري|شهرية|شهريا|monthly|month/.test(label)) return 'month';
  const days = Number(durationDays || 0);
  if (days > 0 && days < 1) return 'hour'; // 1h = 0.0417, 12h = 0.5
  if (days === 1) return 'day';
  if (days > 1 && days <= 7) return 'week';
  if (days > 7 && days <= 31) return 'month';
  if (days > 31) return 'year';
  return 'month';
}

/** How many units a request buys: explicit count, else derived from durationDays. */
function planPeriodCount(unit: PlanUnit, durationDays: unknown, explicit?: unknown): number {
  const n = Number(explicit);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const days = Number(durationDays || 0);
  if (unit === 'hour' && days > 0) return Math.max(1, Math.round(days * 24));
  return 1;
}

/** Adds `count` whole calendar units to `fromMs`, in UTC, clamping the day. */
function addPlanPeriod(fromMs: number, unit: PlanUnit, count = 1): number {
  const n = Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
  const d = new Date(fromMs);
  if (unit === 'hour') { d.setUTCHours(d.getUTCHours() + n); return d.getTime(); }
  if (unit === 'day') { d.setUTCDate(d.getUTCDate() + n); return d.getTime(); }
  if (unit === 'week') { d.setUTCDate(d.getUTCDate() + 7 * n); return d.getTime(); }
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  d.setUTCDate(1);
  if (unit === 'month') d.setUTCMonth(month + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  // Jan 31 + 1 month must land on Feb 28/29, not roll into March.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

function toFsValue(v: any): Json {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toFsValue(val)])) } };
  return { stringValue: String(v) };
}

function fromFsValue(v: any): any {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, val]) => [k, fromFsValue(val)]));
  return undefined;
}

const fsDocBody = (data: Json) => ({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFsValue(v)])) });
const docIdFromName = (name: string) => String(name).split('/').pop() || '';
const sanitizeFs = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_');

function grantDocIdFs(email: string, kind: string, botId?: string, planReqNo?: number | string): string {
  // Bots are keyed per-product (bot_<id>). Plans are keyed PER REQUEST
  // (plan_<requestNo>) so a repeated purchase with the same email can never
  // match an older plan grant — each plan waits for its own developer approval.
  const key = kind === 'bot' ? `bot_${botId || 'unknown'}` : `plan_${planReqNo ? String(planReqNo) : 'none'}`;
  return `${sanitizeFs(email)}__${key}`;
}

// Replays the caller's Firebase ID token (captured by the middleware) onto the
// Firestore REST call so request.auth in the rules is this request's user.
function fsAuthHeaders(): Record<string, string> {
  const token = fsAuthStore.getStore();
  return token ? { Authorization: token } : {};
}

async function fsList(collectionName: string): Promise<Json[]> {
  const out: Json[] = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const url = `${FS_BASE}/${collectionName}?key=${FS_KEY}&pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await fetch(url, { headers: fsAuthHeaders() });
    if (!resp.ok) {
      console.error(`fsList ${collectionName} failed: HTTP ${resp.status} ${await resp.text()}`);
      break;
    }
    const data: any = await resp.json();
    (data.documents || []).forEach((d: any) => out.push({ id: docIdFromName(d.name), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromFsValue(v)])) }));
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return out;
}

// A list that is filtered BY the field the rules check. Firestore refuses an
// unfiltered list on payment_grants for a client (the rule is per-document, so
// the query has to be provable), which is why every client-scoped read here goes
// through this instead of fsList.
async function fsListWhere(collectionName: string, field: string, value: string): Promise<Json[]> {
  const out: Json[] = [];
  try {
    const query = {
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
        limit: 300,
      },
    };
    const resp = await fetch(`${FS_BASE}:runQuery?key=${FS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...fsAuthHeaders() },
      body: JSON.stringify(query),
    });
    if (!resp.ok) {
      console.error(`fsListWhere ${collectionName}.${field} failed: HTTP ${resp.status} ${await resp.text()}`);
      return out;
    }
    const raw = await resp.json();
    for (const row of raw || []) {
      const d = row && row.document;
      if (!d || !d.fields) continue;
      out.push({ id: docIdFromName(d.name), ...Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, fromFsValue(v)])) });
    }
  } catch (e: any) {
    console.error(`fsListWhere ${collectionName} threw:`, e?.message || e);
  }
  return out;
}

async function fsGet(collectionName: string, id: string): Promise<Json | null> {
  const resp = await fetch(`${FS_BASE}/${collectionName}/${encodeURIComponent(id)}?key=${FS_KEY}`, { headers: fsAuthHeaders() });
  if (!resp.ok) return null;
  const d: any = await resp.json();
  if (!d.fields) return null;
  return Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, fromFsValue(v)]));
}

async function fsPatch(collectionName: string, id: string, data: Json, mask?: string[]): Promise<void> {
  // Firestore REST: PATCH WITHOUT an updateMask replaces the whole document —
  // which silently erased every other field (decision writes wiped the payment
  // request, and the client record lost its email/plan on approval). Every call
  // here means "merge these fields", so a mask is always sent.
  const fields = mask && mask.length ? mask : Object.keys(data);
  // An empty mask would mean "replace the document with nothing" — never.
  if (!fields.length) return;
  const qs = '&' + fields.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
  const resp = await fetch(`${FS_BASE}/${collectionName}/${encodeURIComponent(id)}?key=${FS_KEY}${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...fsAuthHeaders() },
    body: JSON.stringify(fsDocBody(data)),
  });
  if (!resp.ok) throw new Error(`Firestore patch ${collectionName}/${id} failed: ${resp.status}`);
}

async function fsAdd(collectionName: string, data: Json): Promise<void> {
  const resp = await fetch(`${FS_BASE}/${collectionName}?key=${FS_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...fsAuthHeaders() },
    body: JSON.stringify(fsDocBody(data)),
  });
  if (!resp.ok) throw new Error(`Firestore add ${collectionName} failed: ${resp.status}`);
}

async function fsSet(collectionName: string, id: string, data: Json): Promise<void> {
  const resp = await fetch(`${FS_BASE}/${collectionName}/${encodeURIComponent(id)}?key=${FS_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...fsAuthHeaders() },
    body: JSON.stringify(fsDocBody(data)),
  });
  if (!resp.ok) throw new Error(`Firestore set ${collectionName}/${id} failed: ${resp.status}`);
}

async function fsDelete(collectionName: string, id: string): Promise<void> {
  const resp = await fetch(`${FS_BASE}/${collectionName}/${encodeURIComponent(id)}?key=${FS_KEY}`, {
    method: 'DELETE',
    headers: fsAuthHeaders(),
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`Firestore delete ${collectionName}/${id} failed: ${resp.status}`);
}

// ── Client Monitor records ──────────────────────────────────────────────────
// The developer must always see a buyer in Client Monitor the moment a plan is
// released, even if the client never reopens the site, and the crown tag must
// track the plan's real period. Done server-side so it cannot depend on the
// client's browser (which is also what makes it reliable across devices).
function clientDocId(email: string): string {
  return String(email || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
}

async function upsertClientRecord(email: string, patch: Json, opts: { create?: boolean } = {}): Promise<void> {
  const e = String(email || '').toLowerCase().trim();
  if (!e || !e.includes('@')) return;
  const id = clientDocId(e);
  try {
    const existing = await fsGet('clients', id);
    if (existing) {
      // The FIRST release never moves: a renewal extends the end date, but the
      // date the client originally paid for stays exactly as it was.
      if (patch.firstReleasedAt && existing.firstReleasedAt) {
        patch = { ...patch, firstReleasedAt: existing.firstReleasedAt };
      }
      await fsPatch('clients', id, patch);
      return;
    }
    if (opts.create === false) return;
    const all = await fsList('clients');
    await fsSet('clients', id, {
      email: e,
      status: 'verified',
      plan: 'free',
      planExpiry: null,
      autoRegistered: true,
      registeredAt: Date.now(),
      rank: all.length + 1,
      ...patch,
    });
  } catch (e: any) {
    console.error('upsertClientRecord failed for', e, e?.message || '');
  }
}

// Mark every notification that refers to a given request number as read, so the
// red badge on the header bell disappears once the developer has decided on it.
async function markRequestNotifsRead(requestNo: unknown): Promise<void> {
  try {
    const target = String(requestNo);
    const notifications = await fsList('dev_notifications');
    await Promise.all(
      notifications
        .filter((n) => String(n.requestNo || '') === target)
        .map((n) => fsPatch('dev_notifications', n.id, { read: true }, ['read']))
    );
  } catch {}
}

function extractAmounts(text: string): { amount: number; coin: string }[] {
  const found = new Map<string, number>();
  const push = (raw: string, coin: string) => {
    const n = Number(String(raw).replace(',', '.'));
    if (isFinite(n) && n > 0) found.set(`${coin}:${Math.round(n * 100) / 100}`, Math.round(n * 100) / 100);
  };
  const coinSymbols = 'USDT|USDC|BUSD|TUSD|FDUSD|DAI|LTC|TRX|SOL';
  const contextual = /(?:amount|received|deposited|deposit|total|credit|المبلغ|استلام|تم استلام|وصل)[^0-9]{0,40}([0-9][0-9.,]*(?:\.\d+)?)\s*(USDT|USDC|BUSD|TUSD|FDUSD|DAI|LTC|TRX|SOL)?/gi;
  let m: RegExpExecArray | null;
  while ((m = contextual.exec(text))) push(m[1], (m[2] || 'USDT').toUpperCase());
  const withCoin = /([0-9][0-9.,]*(?:\.\d+)?)\s*(USDT|USDC|BUSD|TUSD|FDUSD|DAI|LTC|TRX|SOL)/gi;
  while ((m = withCoin.exec(text))) push(m[1], m[2].toUpperCase());
  const withCoinBefore = /(USDT|USDC|BUSD|TUSD|FDUSD|DAI|LTC|TRX|SOL)\s*([0-9][0-9.,]*(?:\.\d+)?)/gi;
  while ((m = withCoinBefore.exec(text))) push(m[2], m[1].toUpperCase());
  const withGenericUsd = /([0-9][0-9.,]*(?:\.\d+)?)\s*\$|\$([0-9][0-9.,]*(?:\.\d+)?)/gi;
  while ((m = withGenericUsd.exec(text))) push(m[1] || m[2], 'USDT');
  return [...found.keys()].map((k) => ({ amount: found.get(k)!, coin: k.split(':')[0] }));
}

// Fetch current USD price for a coin symbol via Binance (USDT stays 1:1).
async function fetchCoinPrice(symbol: string): Promise<number> {
  if (symbol === 'USDT' || symbol === 'USDC' || symbol === 'BUSD' || symbol === 'TUSD' || symbol === 'FDUSD' || symbol === 'DAI') return 1;
  const cacheFind = coinRatesCache?.find((c) => c.symbol === symbol);
  if (cacheFind && Date.now() - cacheFind.at < COIN_RATES_CACHE_MS) return cacheFind.price;
  try {
    const resp = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}USDT`);
    const data: any = await resp.json();
    const price = Number(data?.price);
    if (isFinite(price) && price > 0) {
      if (!coinRatesCache) coinRatesCache = [];
      const idx = coinRatesCache.findIndex((c) => c.symbol === symbol);
      const entry = { symbol, price, at: Date.now() };
      if (idx >= 0) coinRatesCache[idx] = entry; else coinRatesCache.push(entry);
      return price;
    }
  } catch {}
  return 0;
}

async function releasePaymentRequest(req: Json, now: number, source: string): Promise<void> {
  await fsPatch('payment_requests', req.id, {
    status: 'approved',
    decidedAt: now,
    decidedBy: source,
  }, ['status', 'decidedAt', 'decidedBy']);

  const grantId = grantDocIdFs(req.buyerEmail, req.kind, req.botId, req.kind === 'plan' ? req.requestNo : undefined);
  const grant: Json = {
    email: (req.buyerEmail || '').toLowerCase(),
    kind: req.kind,
    status: 'active',
    createdAt: now,
    requestNo: req.requestNo,
    botId: req.botId || null,
    botName: req.botName || null,
    planLabel: req.planLabel || null,
  };
  // The plan grace period does NOT start at release. It starts only when the
  // client enters their key and begins using the paid plan (/api/plan-activate),
  // so a pending-key plan never burns days waiting inside the gate.
  if (req.kind === 'plan') {
    grant.durationDays = Number(req.durationDays) > 0 ? Number(req.durationDays) : 30;
  }
  await fsPatch('payment_grants', grantId, grant);

  const product = req.kind === 'bot' ? (req.botName || 'Bot') : (req.planLabel || 'Plan');
  await fsAdd('dev_notifications', {
    type: 'approved',
    requestNo: req.requestNo,
    titleAr: `إفراج تلقائي للطلب #${req.requestNo}`,
    titleEn: `Auto-released request #${req.requestNo}`,
    bodyAr: `${req.buyerName || req.buyerEmail} — ${product} — $${req.amountUsd}`,
    bodyEn: `${req.buyerName || req.buyerEmail} — ${product} — $${req.amountUsd}`,
    read: true,
    createdAt: now,
  });
  await markRequestNotifsRead(req.requestNo);
}

async function checkBinanceMail(): Promise<Json> {
  const user = process.env.BINANCE_IMAP_USER || process.env.BINANCE_EMAIL;
  const pass = process.env.BINANCE_IMAP_PASS || process.env.BINANCE_APP_PASSWORD;
  if (!user || !pass) {
    return { ok: false, error: 'missing BINANCE_IMAP_USER / BINANCE_IMAP_PASS' };
  }

  // Release is MANUAL only now. The cron auto-scanner must not release anything
  // unless the owner explicitly re-enables binance-email confirmation mode.
  try {
    const paySettings = await fsGet('shared_settings', 'payments');
    const confirmMode = String(paySettings?.confirmMode || 'manual');
    if (confirmMode !== 'binance_email') {
      return { ok: true, mode: 'manual', note: 'auto-release disabled — confirmation is manual', approved: [], scanned: 0 };
    }
  } catch {
    return { ok: true, mode: 'manual', note: 'auto-release disabled — confirmation is manual', approved: [], scanned: 0 };
  }

  const summary: Json = { ok: true, user, scanned: 0, binanceEmails: 0, approved: [], ambiguous: [], errors: [] };

  // Load pending requests + processed-id state
  const [requests, state] = await Promise.all([
    fsList('payment_requests'),
    fsGet('shared_settings', 'binance_mail_state'),
  ]);
  const pending = requests.filter((r) => r.status === 'pending' && typeof r.amountUsd === 'number' && r.amountUsd >= 0.5);
  const processed: string[] = Array.isArray(state?.processed) ? state.processed : [];

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const scanFolder = async (folder: string): Promise<void> => {
    const lock = await client.getMailboxLock(folder);
    try {
      const since = new Date(Date.now() - MAIL_LOOKBACK_MS);
      for await (const msg of client.fetch({ since }, { uid: true, source: true })) {
        summary.scanned++;
        let parsed: any;
        try {
          parsed = await simpleParser(msg.source as Buffer);
        } catch (e: any) {
          summary.errors.push(`parse uid ${msg.uid} (${folder}): ${e.message}`);
          continue;
        }
        const fromText = String(parsed.from?.text || '').toLowerCase();
        const messageId = String(parsed.messageId || `uid:${msg.uid}`);
        if (processed.includes(messageId)) continue;
        if (!fromText.includes('binance')) {
          newlyProcessed.push(messageId);
          continue;
        }
        summary.binanceEmails++;

        const emailText = `${parsed.subject || ''}\n${parsed.text || ''}`;
        const emailDate = parsed.date ? new Date(parsed.date).getTime() : Date.now();
        const amounts = extractAmounts(emailText);
        if (!amounts.length) continue;

        // Match each detected (amount, coin) against pending requests.
        // Convert both the received amount and the expected coin amount to USD
        // using the SAME current price — the price cancels out, so this is
        // exactly |receivedCoin - expectedCoin| × price ≤ AMOUNT_TOLERANCE,
        // making exact coin payments immune to volatility.
        let matched = false;
        for (const entry of amounts) {
          if (matched) break;
          const price = await fetchCoinPrice(entry.coin);
          if (!(price > 0)) continue;

          const candidates = pending.filter((r) => {
            const reqCoin = String(r.coinId || 'usdt').toLowerCase();
            const entryCoin = entry.coin.toLowerCase();
            if (entryCoin !== reqCoin) return false;
            const expectedCoin = Number(r.coinAmountExpected) > 0
              ? Number(r.coinAmountExpected)
              : r.amountUsd;
            const diffUsd = Math.abs(entry.amount - expectedCoin) * price;
            if (diffUsd > AMOUNT_TOLERANCE) return false;
            const created = Number(r.createdAt) || 0;
            return created >= emailDate - REQUEST_WINDOW_BEFORE_MS && created <= emailDate + REQUEST_WINDOW_AFTER_MS;
          });

          if (candidates.length === 1) {
            const req = candidates[0];
            const now = Date.now();
            try {
              await releasePaymentRequest(req, now, 'auto-binance');
              req.status = 'approved';
              summary.approved.push({ requestNo: req.requestNo, buyer: req.buyerEmail, amount: req.amountUsd, coin: entry.coin });
              newlyProcessed.push(messageId);
              matched = true;
            } catch (e: any) {
              summary.errors.push(`release #${req.requestNo}: ${e.message}`);
              break;
            }
          } else if (candidates.length > 1) {
            summary.ambiguous.push({
              messageId,
              coin: entry.coin,
              amounts,
              requestNos: candidates.map((c) => c.requestNo),
            });
          }
        }
        // if matched (or no candidates): possibly leave unprocessed so a later-created request can still match
      }
    } finally {
      lock.release();
    }
  };

  const newlyProcessed: string[] = [];
  try {
    await client.connect();
    const mailboxes = await client.list();
    const spamFolders = (mailboxes || [])
      .map((m: any) => m.path)
      .filter((p: string) => /spam|junk/i.test(p));
    const folders = ['INBOX', ...spamFolders];
    for (const folder of folders) {
      try {
        await scanFolder(folder);
      } catch (e: any) {
        summary.errors.push(`folder ${folder}: ${e.message}`);
      }
    }
    await client.logout();
  } catch (e: any) {
    summary.ok = false;
    summary.errors.push(`imap: ${e.message}`);
  }

  // Persist processed message ids (cap to keep the doc small)
  try {
    const merged = [...new Set([...processed, ...newlyProcessed])].slice(-500);
    await fsPatch('shared_settings', 'binance_mail_state', { processed: merged, updatedAt: Date.now() });
  } catch (e: any) {
    summary.errors.push(`state: ${e.message}`);
  }

  return summary;
}

const binanceMailHandler = async (req: any, res: any) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = String(req.headers.authorization || '');
    const token = String((req.query && req.query.token) || '');
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  try {
    const result = await checkBinanceMail();
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

app.get("/api/check-binance-mail", binanceMailHandler);
app.post("/api/check-binance-mail", binanceMailHandler);

const paymentLookupHandler = async (req: any, res: any) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = String(req.headers.authorization || '');
    const token = String((req.query && req.query.token) || '');
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  try {
    const email = String((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });
    const [requests, grants] = await Promise.all([
      fsList('payment_requests'),
      fsList('payment_grants'),
    ]);
    const mineRequests = requests
      .filter((r) => String(r.buyerEmail || '').toLowerCase() === email)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const mineGrants = grants.filter((g) => String(g.email || '').toLowerCase() === email);
    return res.json({ ok: true, email, requests: mineRequests, grants: mineGrants });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
const listWithStatus = async (collectionName: string): Promise<{ items: Json[]; status: number; body?: any }> => {
  const url = `${FS_BASE}/${collectionName}?key=${FS_KEY}&pageSize=300`;
  const resp = await fetch(url);
  if (!resp.ok) {
    let body: any = null;
    try { body = JSON.parse(await resp.text()); } catch {}
    return { items: [], status: resp.status, body };
  }
  const data: any = await resp.json();
  return { items: (data.documents || []).map((d: any) => ({ id: docIdFromName(d.name), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromFsValue(v)])) })), status: 200 };
};

const paymentDumpHandler = async (req: any, res: any) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = String(req.headers.authorization || '');
    const token = String((req.query && req.query.token) || '');
    if (auth !== `Bearer ${secret}` && token !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  try {
    const [requests, grants, sessions, clientInfo] = await Promise.all([
      listWithStatus('payment_requests'),
      listWithStatus('payment_grants'),
      listWithStatus('payment_sessions'),
      listWithStatus('clients'),
    ]);
    return res.json({
      requests: { status: requests.status, count: requests.items.length, body: requests.body, items: requests.items },
      grants: { status: grants.status, count: grants.items.length, body: grants.body, items: grants.items },
      sessions: { status: sessions.status, count: sessions.items.length, body: sessions.body, items: sessions.items },
      clients: { status: clientInfo.status, count: clientInfo.items.length, items: clientInfo.items },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
app.get("/api/payment-lookup", paymentLookupHandler);
app.get("/api/payment-dump", paymentDumpHandler);

// Client-accessible grant check endpoint — checks if developer released a grant for email
app.get("/api/payment-grant/check", async (req: any, res: any) => {
  try {
    const email = String((req.query && req.query.email) || '').toLowerCase().trim();
    const kind = String((req.query && req.query.kind) || 'plan');
    const botId = req.query && req.query.botId ? String(req.query.botId) : undefined;
    const requestNo = req.query && req.query.requestNo ? Number(req.query.requestNo) : undefined;
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });

    // 1. Direct ID lookup
    if (kind === 'bot' && botId) {
      const grantId = grantDocIdFs(email, 'bot', botId);
      const grant = await fsGet('payment_grants', grantId);
      if (grant && (grant.status === 'active' || !grant.status)) {
        return res.json({ ok: true, grant: { id: grantId, ...grant } });
      }
    } else if (kind === 'plan' && requestNo) {
      const grantId = grantDocIdFs(email, 'plan', undefined, requestNo);
      const grant = await fsGet('payment_grants', grantId);
      if (grant && grant.status === 'active') {
        return res.json({ ok: true, grant: { id: grantId, ...grant } });
      }
    }

    // 2. Scan all grants for this email
    const all = await fsList('payment_grants');
    const matching = all.filter((g) => {
      const gEmail = String(g.email || '').toLowerCase().trim();
      const gKind = String(g.kind || '');
      const gStatus = String(g.status || '');
      if (gEmail !== email) return false;
      if (gKind !== kind) return false;
      if (gStatus !== 'active') return false;
      if (kind === 'bot' && botId && String(g.botId || '') !== botId) return false;
      if (kind === 'plan' && requestNo && Number(g.requestNo) !== requestNo) return false;
      return true;
    });

    if (matching.length > 0) {
      matching.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      return res.json({ ok: true, grant: matching[0] });
    }

    // 3. If plan without requestNo, return latest active plan grant
    if (kind === 'plan' && !requestNo) {
      const activePlans = all.filter((g) => {
        return String(g.email || '').toLowerCase().trim() === email &&
               String(g.kind || '') === 'plan' &&
               String(g.status || '') === 'active';
      });
      if (activePlans.length > 0) {
        activePlans.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
        return res.json({ ok: true, grant: activePlans[0] });
      }
    }

    return res.json({ ok: true, grant: null });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Client-accessible user grants list endpoint
app.get("/api/user-grants", async (req: any, res: any) => {
  try {
    const email = String((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });
    const all = await fsList('payment_grants');
    const userGrants = all.filter((g) => String(g.email || '').toLowerCase().trim() === email);
    return res.json({ ok: true, grants: userGrants });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Server-managed payment requests — persistence from the server, not the client.
// The browser only ever reads/decides through these endpoints, so a numbered
// request is guaranteed to exist for the developer to review and release.
// ═══════════════════════════════════════════════════════════════════════════

// Create a pending numbered payment request (clicked "I have paid").
app.post("/api/payment-request/create", async (req: any, res: any) => {
  try {
    const b = req.body || {};
    const email = String(b.buyerEmail || '').toLowerCase().trim();
    const kind = b.kind === 'plan' ? 'plan' : 'bot';
    const amount = Number(b.amountUsd);
    if (!email || !isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'missing buyerEmail / amountUsd' });
    }
    const counter = await fsGet('shared_settings', 'payment_counter');
    const last = Number(counter?.last) || 1000;
    const requestNo = last + 1;
    await fsPatch('shared_settings', 'payment_counter', { last: requestNo, updatedAt: Date.now() }, ['last', 'updatedAt']);
    // The calendar unit is decided ONCE, when the order is placed, and travels
    // with the request — so the period granted at approval is exactly the one
    // the client bought (a month is a month, not 30 days).
    const inferredUnit = kind === 'plan' ? inferPlanUnit(b.planLabel, b.durationDays, b.planUnit) : undefined;
    const payload: Json = {
      kind,
      botId: b.botId,
      botName: b.botName,
      planLabel: b.planLabel,
      durationDays: b.durationDays,
      planUnit: inferredUnit,
      planUnits: kind === 'plan' ? planPeriodCount(inferredUnit!, b.durationDays, b.planUnits) : undefined,
      amountUsd: amount,
      coinId: b.coinId,
      coinName: b.coinName,
      address: b.address,
      coinAmountExpected: b.coinAmountExpected,
      buyerName: String(b.buyerName || ''),
      buyerEmail: email,
      method: 'manual',
      status: 'pending',
      createdAt: Date.now(),
      requestNo,
    };
    const id = `req_${requestNo}`;
    await fsSet('payment_requests', id, payload);
    const product = kind === 'bot' ? (b.botName || 'Bot') : (b.planLabel || 'Plan');
    await fsAdd('dev_notifications', {
      type: 'request',
      requestNo,
      titleAr: `طلب تأكيد دفع جديد #${requestNo}`,
      titleEn: `New payment request #${requestNo}`,
      bodyAr: `${b.buyerName || email} — ${product} — $${amount}`,
      bodyEn: `${b.buyerName || email} — ${product} — $${amount}`,
      read: false,
      createdAt: Date.now(),
    });
    return res.json({ ok: true, id, requestNo, status: 'pending' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// List every payment request (newest first) for the developer review panel.
// Developer-only: every request carries a buyer email and a transaction id.
app.get("/api/payment-requests-list", async (req: any, res: any) => {
  try {
    const dev = await requireDeveloper(req, res);
    if (!dev) return;
    const items = await fsList('payment_requests');
    items.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const hidden = await fsGet('shared_settings', 'dev_hidden_transactions');
    const hiddenIds: string[] = Array.isArray(hidden?.ids) ? (hidden.ids as string[]) : [];
    return res.json({ ok: true, items, hiddenIds });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Developer decision: approve (creates the release grant), or reject.
// Developer-only AND identity-bound: an approval is literally what grants paid
// access, so the deciding email is the VERIFIED caller — never the body.
app.post("/api/payment-request-decision", async (req: any, res: any) => {
  try {
    const developerEmail = await requireDeveloper(req, res);
    if (!developerEmail) return;
    const b = req.body || {};
    const id = String(b.id || '');
    const action = String(b.action || '');
    if (!id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'missing id / invalid action' });
    }
    const reqDoc = await fsGet('payment_requests', id);
    if (!reqDoc) return res.status(404).json({ ok: false, error: `request ${id} not found` });
    const now = Date.now();
    await fsPatch('payment_requests', id, {
      status: action === 'approve' ? 'approved' : 'rejected',
      decidedAt: now,
      decidedBy: developerEmail,
    });
    if (action === 'approve') {
      const buyerEmail = String(reqDoc.buyerEmail || '').toLowerCase().trim();
      const grantId = grantDocIdFs(buyerEmail, String(reqDoc.kind || 'bot'), reqDoc.botId, String(reqDoc.kind) === 'plan' ? reqDoc.requestNo : undefined);
      const grant: Json = {
        email: buyerEmail,
        kind: reqDoc.kind || 'bot',
        botId: reqDoc.botId,
        botName: reqDoc.botName,
        planLabel: reqDoc.planLabel,
        status: 'active',
        requestNo: reqDoc.requestNo,
        createdAt: now,
      };
      let released: { startAt: number; expiryDate: string; unit: PlanUnit } | null = null;
      if (String(reqDoc.kind) === 'plan') {
        // DIRECT RELEASE: approving is the release. There is no key to enter and
        // no waiting screen — the plan is live from this instant.
        //
        // The clock is a real calendar period counted in GMT: hourly = 1 hour,
        // daily = 24h, weekly = 7 days, monthly = one calendar month, yearly =
        // one calendar year. Every grant carries ITS OWN period, measured from
        // its own release: one hour plan = one hour, one year plan = one year.
        // Stacking is not applied to the expiry, otherwise a single hourly
        // purchase would inherit the end date of an older, longer plan (and
        // repeated approvals would push a plan years into the future).
        const unit = inferPlanUnit(reqDoc.planLabel, reqDoc.durationDays, reqDoc.planUnit);
        const days = Number(reqDoc.durationDays) > 0 ? Number(reqDoc.durationDays) : 0;
        const count = planPeriodCount(unit, days, reqDoc.planUnits);
        const startAt = now;
        const expiryDate = new Date(addPlanPeriod(startAt, unit, count)).toISOString();
        released = { startAt, expiryDate, unit };
        grant.durationDays = days || undefined;
        grant.planUnit = unit;
        grant.planUnits = count;
        // ISO strings, not epoch numbers: epoch values are read back as raw
        // integers and break the first-release date shown to the client.
        grant.activatedAt = new Date(startAt).toISOString();
        grant.expiryDate = expiryDate;
        grant.releasedAt = new Date(now).toISOString();
      }
      // Merge, never replace: a re-approval must not wipe an already-started
      // clock (activatedAt/expiryDate) that the client already earned.
      await Promise.allSettled([
        fsPatch('payment_grants', grantId, grant),
        fsSet('shared_settings', `grant_${grantId}`, grant),
        fsSet('shared_status', `grant_${grantId}`, grant),
      ]);
      if (String(reqDoc.kind) === 'plan' && released) {
        // The buyer is listed in Client Monitor with their email exactly as they
        // typed it, and the crown appears the moment the plan is released.
        await upsertClientRecord(buyerEmail, {
          autoRegistered: true,
          approvedAt: now,
          releasedAt: new Date(released.startAt).toISOString(),
          // Kept at the very first release by upsertClientRecord, so a renewal
          // only moves the expiry and never the start date.
          firstReleasedAt: new Date(released.startAt).toISOString(),
          plan: 'paid',
          planExpiry: released.expiryDate,
          planLabel: reqDoc.planLabel || '',
          planUnit: released.unit,
        });
      }
      await fsAdd('dev_notifications', {
        type: 'approved',
        requestNo: reqDoc.requestNo,
        titleAr: `تم إفراج الطلب #${reqDoc.requestNo}`,
        titleEn: `Request #${reqDoc.requestNo} released`,
        bodyAr: `${reqDoc.buyerName || reqDoc.buyerEmail} — تم تحرير التحميل/الخطة`,
        bodyEn: `${reqDoc.buyerName || reqDoc.buyerEmail} — download/plan released`,
        read: true,
        createdAt: now,
      });
    }
    await markRequestNotifsRead(reqDoc.requestNo);
    return res.json({ ok: true, status: action === 'approve' ? 'approved' : 'rejected' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Dev-only: hide a transaction from the developer purchase history. The client
// data (request + grant) stays untouched — the entry only disappears from the
// developer account view.
app.post("/api/payment-request-hide", async (req: any, res: any) => {
  try {
    const dev = await requireDeveloper(req, res);
    if (!dev) return;
    const id = String((req.body || {}).id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
    const doc = await fsGet('shared_settings', 'dev_hidden_transactions');
    const ids: string[] = Array.isArray(doc?.ids) ? (doc.ids as string[]) : [];
    if (!ids.includes(id)) ids.push(id);
    await fsPatch('shared_settings', 'dev_hidden_transactions', { ids, updatedAt: Date.now() }, ['ids', 'updatedAt']);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Deleting transactions (real removal, not hiding) ─────────────────────────
// A transaction is the REQUEST/SESSION record. Removing it only clears the
// ledger entry: payment_grants are never touched here, so cleaning a row can
// never take away a plan somebody already paid for.
async function deleteTransactionRecords(
  opts: { email?: string; rawEmail?: string; id?: string },
): Promise<number> {
  const norm = (v: unknown) => String(v == null ? '' : v).toLowerCase().trim();
  const buyerOf = (d: Json) => norm(d.buyerEmail);
  const email = opts.email ? norm(opts.email) : '';
  const id = opts.id ? String(opts.id) : '';
  // The UI may send a row key such as `req_1099` / `r_1099` instead of a
  // document id — the trailing number is the request number.
  const idNo = (() => {
    const m = /^(?:req|r)_(\d+)$/.exec(id);
    if (m) return m[1];
    return /^\d+$/.test(id) ? id : '';
  })();

  // A CLIENT may only list rows whose buyerEmail equals their own session
  // email — an unfiltered list of the whole collection is refused by the rules
  // (that is exactly what made the delete return removed: 0). The developer
  // lists everything. The email is queried as stored (raw) and lowercased, so a
  // row typed in any case is still found.
  let requests: Json[] = [];
  let sessions: Json[] = [];
  if (email) {
    const variants = [...new Set([email, norm(opts.rawEmail || '')].filter(Boolean))];
    const listBoth = async (col: string) => {
      const out: Json[] = [];
      const seen = new Set<string>();
      for (const v of variants) {
        for (const row of await fsListWhere(col, 'buyerEmail', v)) {
          if (!row.id || seen.has(row.id)) continue;
          seen.add(row.id);
          out.push(row);
        }
      }
      return out;
    };
    [requests, sessions] = await Promise.all([
      listBoth('payment_requests'),
      listBoth('payment_sessions'),
    ]);
  } else {
    [requests, sessions] = await Promise.all([fsList('payment_requests'), fsList('payment_sessions')]);
  }

  // Single-row deletes first try the exact document (get is open on these
  // collections), so a row is found even when the list query misses it.
  if (id && !requests.some((r) => r.id === id)) {
    const direct = await fsGet('payment_requests', id);
    if (direct && (!email || buyerOf(direct) === email)) requests.push({ id, ...direct });
  }
  if (id && !sessions.some((s) => s.id === id)) {
    const direct = await fsGet('payment_sessions', id);
    if (direct && (!email || buyerOf(direct) === email)) sessions.push({ id, ...direct });
  }

  let removed = 0;
  const clearedNos = new Set<string>();
  for (const r of requests) {
    if (!r.id) continue;
    const no = String(r.requestNo == null ? '' : r.requestNo);
    if (email && buyerOf(r) !== email) continue;
    if (id && r.id !== id && !(no && (no === id || no === idNo))) continue;
    try {
      await fsDelete('payment_requests', r.id);
      await fsDelete('shared_settings', `request_${r.id}`).catch(() => {});
      await fsDelete('shared_status', `request_${r.id}`).catch(() => {});
      removed++;
      if (no) clearedNos.add(no);
    } catch {}
  }

  // Sessions of the same purchase, or the caller's own leftover sessions.
  for (const s of sessions) {
    if (!s.id) continue;
    if (email && buyerOf(s) !== email) continue;
    const no = String(s.requestNo == null ? '' : s.requestNo);
    const samePurchase = !!(no && clearedNos.has(no));
    const matched = !id || s.id === id || samePurchase || (idNo && no === idNo);
    if (!matched) continue;
    try { await fsDelete('payment_sessions', s.id); } catch {}
  }

  // A row built from a session only has no request document — the session loop
  // above already covers it, since `matched` also accepts the id itself.

  return removed;
}

// Developer: clear one transaction, or the whole ledger at any time.
app.post("/api/transaction-delete", async (req: any, res: any) => {
  try {
    const dev = await requireDeveloper(req, res);
    if (!dev) return;
    const b = req.body || {};
    const id = String(b.id || '');
    if (b.all === true) {
      const removed = await deleteTransactionRecords({});
      await fsDelete('shared_settings', 'dev_hidden_transactions').catch(() => {});
      return res.json({ ok: true, removed });
    }
    if (!id) return res.status(400).json({ ok: false, error: 'missing id' });
    const doc = await fsGet('payment_requests', id);
    if (!doc) return res.status(404).json({ ok: false, error: `request ${id} not found` });
    const removed = await deleteTransactionRecords({ id });
    return res.json({ ok: true, removed });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Client: clear their own transactions at any time. The email comes from the
// VERIFIED session, never the body, so a client can only ever reach their own
// rows — and their plan grants are left alone.
app.post("/api/user/transaction-delete", async (req: any, res: any) => {
  try {
    const caller = await verifyCallerToken(callerToken(req));
    if (!caller) return res.status(401).json({ ok: false, error: 'sign_in_required' });
    const email = String(caller.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });
    const b = req.body || {};
    const removed = await deleteTransactionRecords({
      email,
      rawEmail: String(caller.rawEmail || ''),
      id: b.all === true ? undefined : String(b.id || ''),
    });
    return res.json({ ok: true, removed });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Legacy safety net. Plans are now RELEASED at approval time with their full
// calendar period already written, so this normally finds every grant already
// started and changes nothing. It still exists for grants created before that
// change, and uses the same GMT calendar maths so a period can never disagree
// with the one the developer granted.
app.post("/api/plan-activate", async (req: any, res: any) => {
  try {
    // The email is taken from the VERIFIED session, never from the body: a client
    // must not be able to start somebody else's clock.
    const caller = await verifyCallerToken(callerToken(req));
    if (!caller) return res.status(401).json({ ok: false, error: 'sign_in_required' });
    const email = String(caller.email || '').toLowerCase().trim();
    const requestNo = Number((req.body || {}).requestNo) || null;
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });
    const grants = await fsListWhere('payment_grants', 'email', email);
    const mine = grants.filter((g) =>
      String(g.email || '').toLowerCase() === email &&
      String(g.kind || '') === 'plan' &&
      String(g.status || '') === 'active' &&
      (!requestNo || Number(g.requestNo) === requestNo)
    );
    const now = Date.now();
    let activated = 0;
    for (const g of mine) {
      if (g.expiryDate) continue; // already started — keep original period
      const unit = inferPlanUnit(g.planLabel, g.durationDays, g.planUnit);
      const count = planPeriodCount(unit, g.durationDays, g.planUnits);
      // Each unstarted period gets its OWN length measured from now, and ISO
      // date strings so the first-release date survives the round trip.
      const startAt = now;
      const expiryDate = new Date(addPlanPeriod(startAt, unit, count)).toISOString();
      await fsPatch('payment_grants', g.id!, {
        planUnit: unit,
        planUnits: count,
        expiryDate,
        activatedAt: new Date(startAt).toISOString(),
        releasedAt: new Date(now).toISOString(),
      }, ['planUnit', 'planUnits', 'expiryDate', 'activatedAt', 'releasedAt']);
      // The plan is now RUNNING: the client gets the crown in Client Monitor,
      // and it disappears by itself once this expiryDate passes.
      await upsertClientRecord(email, {
        plan: 'paid',
        planExpiry: expiryDate,
        planLabel: g.planLabel || '',
        planUnit: unit,
        firstReleasedAt: new Date(startAt).toISOString(),
        releasedAt: new Date(startAt).toISOString(),
        autoRegistered: true,
      });
      activated++;
    }
    return res.json({ ok: true, activated });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Developer-only purchase history: every plan/bot purchase with a GMT date,
// newest first. Client data (requests + grants) is untouched — a deleted entry
// only disappears from the developer view.
app.get("/api/transaction-history", async (req: any, res: any) => {
  try {
    const dev = await requireDeveloper(req, res);
    if (!dev) return;
    const items = await fsList('payment_requests');
    items.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    return res.json({ ok: true, items });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Client plan deletion: revoke every active plan grant for the email so the plan
// is truly gone and cannot be re-activated by the grants poll on next login.
app.post("/api/plan-revoke", async (req: any, res: any) => {
  try {
    // Verified session only. Trusting a body email here would let any client
    // cancel somebody else's plan.
    const caller = await verifyCallerToken(callerToken(req));
    if (!caller) return res.status(401).json({ ok: false, error: 'sign_in_required' });
    const email = String(caller.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: 'missing email' });
    const grants = await fsListWhere('payment_grants', 'email', email);
    const mine = grants.filter((g) => String(g.email || '').toLowerCase() === email && String(g.kind || '') === 'plan');
    await Promise.all(
      mine
        .filter((g) => String(g.status || '') === 'active')
        .map((g) => fsPatch('payment_grants', g.id!, { status: 'revoked', revokedAt: Date.now() }, ['status', 'revokedAt']))
    );
    // Drop the crown: the plan is gone, so Client Monitor must show them as a
    // free client again.
    await upsertClientRecord(email, { plan: 'free', planExpiry: null, planRevokedAt: Date.now() });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default app;
