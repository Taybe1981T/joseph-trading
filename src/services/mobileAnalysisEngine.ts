import { analyzeMarketBatch } from './geminiService';
import { MarketType, TradingStyle, StrategySettings, AutoAnalysisSettings, AnalysisResult } from '../types';
import { DEFAULT_STRATEGY_SETTINGS, SYMBOL_CATEGORIES } from '../constants';
import { getOpenStockExchanges, exchangeLabel } from '../lib/marketHours';
import { waitIfRateLimited } from './rateLimitTracker';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Language } from '../lib/i18n';

export interface MobileProgress {
  current: string; total: number; index: number; failed: number; exchange?: string;
}

export function readMobileAuto(): AutoAnalysisSettings {
  try {
    const raw = localStorage.getItem('auto_settings');
    if (raw) return { ...(JSON.parse(raw)) };
  } catch {}
  return { isEnabled: false, interval: 15, timeframe: '1d', category: 'all', tradingStyle: TradingStyle.DAY_TRADING, volume: 0.8, showAllSignals: false } as AutoAnalysisSettings;
}

/** ── Category-aware symbol picker (same groups as AnalysisForm) ── */
export function getMobileSymbolGroups(): { id: string; label: string; symbols: string[] }[] {
  try {
    const raw = localStorage.getItem('finalyze_custom_symbols');
    const custom = raw ? JSON.parse(raw) : [];
    const groups: { id: string; label: string; symbols: string[] }[] = [];
    const map: Record<string, { label: string; symbols: string[] }> = {
      forex: { label: 'EUR Pairs', symbols: ['EURUSD', 'EURGBP', 'EURJPY', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF'] },
      crypto: { label: 'Top Crypto', symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'XRPUSD', 'ADAUSD', 'AVAXUSD', 'TONUSD'] },
      stocks: { label: 'US Tech', symbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX'] },
      metals: { label: 'Precious Metals', symbols: ['XAUUSD', 'XAGUSD', 'XPTUSD'] },
    };
    for (const [k, v] of Object.entries(map)) groups.push({ id: k, label: v.label, symbols: v.symbols });
    if (custom.length) groups.push({ id: 'custom', label: 'Custom', symbols: custom });
    return groups;
  } catch { return []; }
}

export function readMobileStrategy(): StrategySettings {
  try {
    const raw = localStorage.getItem('strategy_settings');
    if (raw) return { ...DEFAULT_STRATEGY_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_STRATEGY_SETTINGS;
}

export function readMobileLang(): Language {
  try {
    const s = localStorage.getItem('language');
    return (s === 'ar' || s === 'en') ? (s as Language) : 'en';
  } catch { return 'en'; }
}

export function detectMobileType(symbol: string): MarketType {
  const s = symbol.toUpperCase().replace(/[-_=]/g, '');
  for (const [cat, syms] of Object.entries(SYMBOL_CATEGORIES)) {
    if ((syms as string[]).includes(s)) return cat as MarketType;
  }
  if (/XAU|XAG|XPT|XCU|XPD|XAL|GOLD|SILVER/.test(s)) return MarketType.METALS;
  if (/BTC|ETH|BNB|SOL|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK|UNI|SHIB|LTC|ATOM/.test(s)) return MarketType.CRYPTO;
  if (/EUR|GBP|JPY|CHF|CAD|AUD|NZD|USD/.test(s)) return MarketType.FOREX;
  return MarketType.STOCKS;
}

export async function persistMobileResults(results: AnalysisResult[], uid: string) {
  for (const r of results) {
    try {
      await addDoc(collection(db, 'analysisResults'), {
        symbol: String(r.symbol || ''), type: String(r.type || ''),
        timeframe: String(r.timeframe || ''), signal: String(r.signal || 'neutral'),
        confidence: Number(r.confidence) || 0, summary: String(r.summary || ''),
        technicalScore: Number(r.technicalScore) || 0, sentimentScore: Number(r.sentimentScore) || 0,
        trendAge: Number(r.trendAge) || 0, trendMaturity: String(r.trendMaturity || 'unknown'),
        entryPrice: Number(r.entryPrice) || 0, stopLoss: Number(r.stopLoss) || 0,
        takeProfit: Number(r.takeProfit) || 0, timestamp: serverTimestamp(), userId: uid,
      });
    } catch {}
  }
}

export function mergeMobileTopSignals(all: AnalysisResult[], showAll: boolean): number {
  const filtered = showAll ? all : all.filter((s) => {
    const sig = String(s.signal || '');
    return sig !== 'neutral' && sig !== 'no_entry' && !s.isSideways;
  });
  try {
    const raw = localStorage.getItem('top_signals_persistent');
    const prev: any[] = raw ? JSON.parse(raw) : [];
    const seen = new Set(prev.map((p: any) => `${p.symbol}_${p.timeframe}_${p.signal}`));
    const fresh = filtered.filter((s) => !seen.has(`${s.symbol}_${(s as any).timeframe || '1d'}_${s.signal}`));
    if (fresh.length > 0) {
      localStorage.setItem('top_signals_persistent', JSON.stringify([...fresh, ...prev].slice(0, 100)));
      return fresh.length;
    }
  } catch {}
  return 0;
}

export async function runMobileManual(symbols: string[], uid: string, onProgress?: (p: MobileProgress) => void): Promise<{ results: AnalysisResult[]; failed: string[] }> {
  const auto = readMobileAuto();
  const strategy = readMobileStrategy();
  const lang = readMobileLang();
  const results: AnalysisResult[] = [];
  const failed: string[] = [];
  const list = (symbols || []).map((s) => String(s || '').toUpperCase().trim()).filter(Boolean).slice(0, 10);
  for (let i = 0; i < list.length; i++) {
    const sym = list[i];
    onProgress?.({ current: sym, total: list.length, index: i, failed: failed.length });
    try {
      await waitIfRateLimited();
      const batch = await analyzeMarketBatch(
        [{ symbol: sym, type: detectMobileType(sym), timeframe: auto.timeframe || '1d', tradingStyle: auto.tradingStyle || TradingStyle.DAY_TRADING }],
        strategy, lang,
        (cur, tot, idx) => onProgress?.({ current: cur, total: tot, index: idx, failed: failed.length })
      );
      for (const r of batch.results) { r.userId = uid || 'anonymous'; results.push(r); }
      for (const e of batch.errors) failed.push(`${e.symbol}: ${e.error}`);
      await persistMobileResults(batch.results, uid || 'anonymous');
    } catch (e: any) {
      failed.push(`${sym}: ${e?.message || 'error'}`);
    }
  }
  if (results.length > 0) {
    try {
      const strong = results.filter((r) => r.signal === 'strong_buy' || r.signal === 'strong_sell');
      const mixed = [...strong, ...results.filter((r) => r.signal === 'buy' || r.signal === 'sell')];
      localStorage.setItem('manual_results', JSON.stringify(mixed.slice(0, 30)));
      localStorage.setItem('manual_results_meta', JSON.stringify({ at: Date.now(), total: results.length }));
    } catch {}
    mergeMobileTopSignals(results, false);
  }
  return { results, failed };
}

export async function publishMobileShared(topTen: AnalysisResult[], email: string) {
  try {
    await setDoc(doc(db, 'shared_signals', 'latest'), {
      updatedAt: serverTimestamp(), developerEmail: email || '',
      signals: (topTen || []).slice(0, 10).map((s) => ({
        symbol: s.symbol, signal: s.signal, confidence: s.confidence,
        entryPrice: s.entryPrice ?? null, stopLoss: s.stopLoss ?? null,
        takeProfit: s.takeProfit ?? null, summary: (s.summary || '').slice(0, 300),
        timestamp: Date.now(),
      })),
    });
  } catch {}
  try {
    const { publishMirrorEventsFor } = await import('./tradeMirror');
    await publishMirrorEventsFor(topTen || [], { maxPerSymbol: 1, cooldownMs: 15 * 60 * 1000 });
  } catch {}
}

export async function runMobileRadar(uid: string, email: string, onProg?: (p: MobileProgress) => void) {
  const auto = readMobileAuto();
  const strategy = readMobileStrategy();
  const lang = readMobileLang();
  const cats = (auto.category || 'all') === 'all' ? ['forex', 'crypto', 'stocks', 'metals'] : [auto.category];
  const jobs: { cat: string; syms: string[]; exKey?: any }[] = [];
  for (const cat of cats) {
    if (cat === 'stocks') {
      for (const ex of getOpenStockExchanges()) jobs.push({ cat, syms: (ex.symbols as string[]).slice(0, 15), exKey: ex.key });
    } else {
      jobs.push({ cat, syms: ((SYMBOL_CATEGORIES as any)[cat] || []).slice(0, 15) });
    }
  }
  let scanned: AnalysisResult[] = [];
  let failed = 0;
  for (const j of jobs) {
    if (!readMobileAuto().isEnabled) break;
    for (const sym of j.syms) {
      if (!readMobileAuto().isEnabled) break;
      onProg?.({ current: sym, total: j.syms.length, index: scanned.length, failed, exchange: j.exKey ? exchangeLabel(j.exKey, lang) : undefined });
      try {
        await waitIfRateLimited();
        const b = await analyzeMarketBatch(
          [{ symbol: sym, type: detectMobileType(sym), timeframe: auto.timeframe || '1d', tradingStyle: auto.tradingStyle || TradingStyle.DAY_TRADING }],
          strategy, lang,
          (cur, tot, idx) => onProg?.({ current: cur, total: tot, index: idx, failed, exchange: j.exKey ? exchangeLabel(j.exKey, lang) : undefined })
        );
        if (b.results.length > 0) {
          for (const r of b.results) { r.userId = uid || 'anonymous'; scanned.push(r); }
          failed += b.errors.length;
          await persistMobileResults(b.results, uid || 'anonymous');
        } else { failed++; }
      } catch { failed++; await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  const fresh = mergeMobileTopSignals(scanned, !!auto.showAllSignals);
  const top = scanned.filter((s) => {
    const sig = String(s.signal || '');
    return sig !== 'neutral' && sig !== 'no_entry' && !s.isSideways;
  }).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 10);
  await publishMobileShared(top, email || '');
  try {
    const cur = readMobileAuto();
    localStorage.setItem('auto_settings', JSON.stringify({ ...cur, lastFinishedAt: Date.now() }));
  } catch {}
  return { scanned: scanned.length, failed, fresh };
}

let mRadarTimer: ReturnType<typeof setTimeout> | null = null;
let mRadarOn = false;
export function isMobileRadarOn(): boolean { return mRadarOn; }
export function stopMobileRadar() { mRadarOn = false; if (mRadarTimer) { clearTimeout(mRadarTimer); mRadarTimer = null; } }
export async function startMobileRadar(uid: string, email: string, onProg?: (p: MobileProgress) => void, onDone?: (r: any) => void) {
  if (mRadarOn) return;
  mRadarOn = true;
  const loop = async () => {
    if (!mRadarOn || !readMobileAuto().isEnabled) { mRadarOn = false; return; }
    try { const r = await runMobileRadar(uid, email, onProg); onDone?.(r); } catch {}
    if (!mRadarOn || !readMobileAuto().isEnabled) { mRadarOn = false; return; }
    mRadarTimer = setTimeout(loop, (readMobileAuto().interval || 15) * 60000);
  };
  await loop();
}