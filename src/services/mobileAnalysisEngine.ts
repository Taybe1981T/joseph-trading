import { analyzeMarketBatch } from './geminiService';
import { MarketType, TradingStyle, StrategySettings, AutoAnalysisSettings, AnalysisResult } from '../types';
import { DEFAULT_STRATEGY_SETTINGS, SYMBOL_CATEGORIES, SYMBOL_GROUPS, ALL_SYMBOLS_DB, TIMEFRAMES, TRADING_STYLES } from '../constants';
import { getOpenStockExchanges, exchangeLabel } from '../lib/marketHours';
import { waitIfRateLimited } from './rateLimitTracker';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Language } from '../lib/i18n';
import { initAudio, playStart, playCompletion, playCategoryChange } from '../lib/audioEngine';

export interface MobileProgress {
  current: string; total: number; index: number; failed: number; exchange?: string; category?: string;
}

export function readMobileAuto(): AutoAnalysisSettings {
  try {
    const raw = localStorage.getItem('auto_settings');
    if (raw) return { ...(JSON.parse(raw)) };
  } catch {}
  return { isEnabled: false, interval: 15, timeframe: '1d', category: 'all', tradingStyle: TradingStyle.DAY_TRADING, volume: 0.8, showAllSignals: false } as AutoAnalysisSettings;
}

/** ── Category-aware symbol picker (same groups as AnalysisForm) ──
 * Ported from desktop AnalysisForm logic:
 * - same visible groups (SYMBOL_GROUPS) + same full symbol universe (ALL_SYMBOLS_DB)
 * - honors finalyze_hidden_symbols + finalyze_custom_symbols just like desktop
 * - helper below to add/remove custom or hide/unhide symbols (mirrors desktop modals)
 */
export function getMobileSymbolGroups(): { id: string; label: string; symbols: string[] }[] {
  try {
    const hidden: string[] = JSON.parse(localStorage.getItem('finalyze_hidden_symbols') || '[]');
    const custom: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
    const cats = [
      { id: 'forex', label: 'Forex' },
      { id: 'crypto', label: 'Crypto' },
      { id: 'stocks', label: 'Stocks' },
      { id: 'metals', label: 'Metals' },
    ];
    const out = cats.map((c) => ({
      id: c.id,
      label: c.label,
      // Desktop parity: SYMBOL_GROUPS[cat]?.flatMap(g => g.symbols)
      symbols: ((SYMBOL_GROUPS as any)[c.id] || []).flatMap((g: any) => g.symbols || []).filter((s: string) => !hidden.includes(s)),
    })).filter((g) => g.symbols.length > 0);
    // Desktop parity: custom symbols merged per category via ALL_SYMBOLS_DB
    const allKnown = new Set<string>();
    for (const v of Object.values(ALL_SYMBOLS_DB as any)) for (const s of (v as string[])) allKnown.add(s);
    for (const g of out) for (const s of g.symbols) allKnown.add(s);
    const extraCustom = custom.filter((s) => !hidden.includes(s) && !allKnown.has(s));
    if (extraCustom.length) out.push({ id: 'custom', label: 'Custom', symbols: extraCustom });
    return out;
  } catch { return []; }
}

/** All known symbols (visible + hidden + custom) — mirrors desktop ALL_SYMBOLS_DB (record). */
export function getMobileAllSymbols(): string[] {
  try {
    const custom: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
    const base = Object.values(ALL_SYMBOLS_DB as any).flat() as string[];
    const set = new Set<string>(base);
    for (const s of custom) set.add(s);
    return [...set];
  } catch {
    try { return Object.values(ALL_SYMBOLS_DB as any).flat() as string[]; }
    catch { return []; }
  }
}

/** Add a custom symbol (desktop: manual add via modal) — persists to finalyze_custom_symbols. */
export function addMobileCustomSymbol(sym: string): string[] {
  const s = (sym || '').trim().toUpperCase().replace(/[^A-Z0-9.\-=]/g, '');
  if (!s) return getMobileAllSymbols();
  try {
    const raw: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
    if (!raw.includes(s)) {
      const next = [...raw, s];
      localStorage.setItem('finalyze_custom_symbols', JSON.stringify(next));
    }
  } catch {}
  return getMobileAllSymbols();
}

/** Hide a symbol (desktop: delete icon) — persists to finalyze_hidden_symbols. */
export function hideMobileSymbol(sym: string): void {
  try {
    const raw: string[] = JSON.parse(localStorage.getItem('finalyze_hidden_symbols') || '[]');
    if (!raw.includes(sym)) localStorage.setItem('finalyze_hidden_symbols', JSON.stringify([...raw, sym]));
  } catch {}
}

/** Unhide a symbol previously hidden. */
export function unhideMobileSymbol(sym: string): void {
  try {
    const raw: string[] = JSON.parse(localStorage.getItem('finalyze_hidden_symbols') || '[]');
    localStorage.setItem('finalyze_hidden_symbols', JSON.stringify(raw.filter((s) => s !== sym)));
  } catch {}
}

/** Remove a custom symbol entirely (desktop: delete in custom section). */
export function removeMobileCustomSymbol(sym: string): void {
  try {
    const raw: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
    localStorage.setItem('finalyze_custom_symbols', JSON.stringify(raw.filter((s) => s !== sym)));
  } catch {}
  unhideMobileSymbol(sym);
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

export async function runMobileManual(symbols: string[], uid: string, onProgress?: (p: MobileProgress) => void, opts?: { timeframe?: string; tradingStyle?: TradingStyle }): Promise<{ results: AnalysisResult[]; failed: string[] }> {
  const auto = readMobileAuto();
  const timeframe = opts?.timeframe || auto.timeframe || '1d';
  const tradingStyle = opts?.tradingStyle || auto.tradingStyle || TradingStyle.DAY_TRADING;
  try { initAudio(); } catch {}
  try { playStart(Math.max(0, Math.min(1, Number((auto as any).volume ?? 0.5)))); } catch {}
  const strategy = readMobileStrategy();
  const lang = readMobileLang();
  const list = (symbols || []).map((s) => String(s || '').toUpperCase().trim()).filter(Boolean).slice(0, 10);
  const { results, errors } = await analyzeMarketBatch(
    list.map((sym) => ({ symbol: sym, type: detectMobileType(sym), timeframe, tradingStyle })),
    strategy, lang,
    (cur, tot, idx, failed) => onProgress?.({ current: cur, total: tot, index: idx, failed: failed || 0 })
  );
  const failed: string[] = errors.map((e) => `${e.symbol}: ${e.error}`);
  for (const r of results) r.userId = uid || 'anonymous';
  if (results.length > 0) await persistMobileResults(results, uid || 'anonymous');
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
  // Unified symbol source: same groups as Manual Analysis (SYMBOL_GROUPS flatMap + custom symbols, minus hidden)
  const groups = getMobileSymbolGroups();
  const rawCat = auto.category || 'all';
  // FIX: stable fixed order (forex → crypto → stocks → metals → custom) so the
  // radar always scans in the requested order instead of storage order.
  const FIXED_ORDER = ['forex', 'crypto', 'stocks', 'metals', 'custom'];
  const wanted = rawCat === 'all' ? FIXED_ORDER : rawCat.split(',').filter(Boolean);
  const catSet = FIXED_ORDER.filter((c) => wanted.includes(c))
    .concat(wanted.filter((c) => !FIXED_ORDER.includes(c)));
  const jobs: { cat: string; syms: string[]; exKey?: any }[] = [];
  for (const cat of catSet) {
    const g = groups.find((x) => x.id === cat);
    if (!g) continue;
    if (cat === 'stocks') {
      const exs = getOpenStockExchanges();
      if (exs.length > 0) {
        for (const ex of exs) jobs.push({ cat, syms: (ex.symbols as string[]).slice(0, 15), exKey: ex.key });
      } else {
        jobs.push({ cat, syms: g.symbols.slice(0, 15) });
      }
    } else {
      jobs.push({ cat, syms: g.symbols.slice(0, 15) });
    }
  }
  // FIX: grand total across ALL categories so the progress bar never jumps
  // backwards when the radar moves to the next category.
  const grandTotal = jobs.reduce((n, j) => n + j.syms.length, 0);
  let done = 0;
  let scanned: AnalysisResult[] = [];
  let failed = 0;
  for (const j of jobs) {
    if (!readMobileAuto().isEnabled) break;
    for (const sym of j.syms) {
      if (!readMobileAuto().isEnabled) break;
      done++;
      onProg?.({ current: sym, total: grandTotal, index: done, failed, exchange: j.exKey ? exchangeLabel(j.exKey, lang) : undefined, category: j.cat });
      try {
        await waitIfRateLimited();
        const b = await analyzeMarketBatch(
          [{ symbol: sym, type: detectMobileType(sym), timeframe: auto.timeframe || '1d', tradingStyle: auto.tradingStyle || TradingStyle.DAY_TRADING }],
          strategy, lang,
          () => onProg?.({ current: sym, total: grandTotal, index: done, failed, exchange: j.exKey ? exchangeLabel(j.exKey, lang) : undefined, category: j.cat })
        );
        if (b.results.length > 0) {
          for (const r of b.results) { r.userId = uid || 'anonymous'; scanned.push(r); }
          failed += b.errors.length;
          await persistMobileResults(b.results, uid || 'anonymous');
        } else { failed++; }
      } catch { failed++; await new Promise((r) => setTimeout(r, 3000)); }
    }
  }
  try { initAudio(); } catch {}
  try { playCompletion(Math.max(0, Math.min(1, Number((auto as any).volume ?? 0.5)))); } catch {}
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
let mRadarProg: MobileProgress | null = null;
let mRadarOnProg: ((p: MobileProgress) => void) | null = null;
let mRadarOnDone: ((r: any) => void) | null = null;
export function isMobileRadarOn(): boolean { return mRadarOn; }
export function getMobileRadarProgress(): MobileProgress | null { return mRadarProg; }
export function stopMobileRadar() { mRadarOn = false; if (mRadarTimer) { clearTimeout(mRadarTimer); mRadarTimer = null; } }
export async function startMobileRadar(uid: string, email: string, onProg?: (p: MobileProgress) => void, onDone?: (r: any) => void) {
  // Update callbacks even if already running
  if (onProg) mRadarOnProg = onProg;
  if (onDone) mRadarOnDone = onDone;
  if (mRadarOn) {
    // Already running - just update callbacks, don't restart
    if (mRadarProg) mRadarOnProg?.(mRadarProg);
    return;
  }
  mRadarOn = true;
  const loop = async () => {
    if (!mRadarOn || !readMobileAuto().isEnabled) { mRadarOn = false; return; }
    try { const r = await runMobileRadar(uid, email, (p) => { mRadarProg = p; mRadarOnProg?.(p); }); mRadarOnDone?.(r); mRadarProg = null; } catch {}
    if (!mRadarOn || !readMobileAuto().isEnabled) { mRadarOn = false; return; }
    mRadarTimer = setTimeout(loop, (readMobileAuto().interval || 15) * 60000);
  };
  await loop();
}