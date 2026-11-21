import { analyzeMarketBatch } from './geminiService';
import { MarketType, TradingStyle, StrategySettings, AutoAnalysisSettings, AnalysisResult } from '../types';
import { DEFAULT_STRATEGY_SETTINGS, SYMBOL_CATEGORIES, SYMBOL_GROUPS, ALL_SYMBOLS_DB, TIMEFRAMES, TRADING_STYLES, CRYPTO_SCAN_LIMIT, mergeStrategySettings } from '../constants';
import { getOpenStockExchanges, exchangeLabel } from '../lib/marketHours';
import { topPerCategory } from '../lib/signalFeed';
import { waitIfRateLimited } from './rateLimitTracker';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Language } from '../lib/i18n';
import { isDeveloperEmail } from '../lib/clientIds';
import { consumeSymbolAnalyses } from './manualQuota';
import { registerCustomSymbol, readCustomTvMap } from '../lib/customSymbols';
import { initAudio, playStart, playCompletion, playCategoryChange } from '../lib/audioEngine';

export interface MobileProgress {
  current: string; total: number; index: number; failed: number; exchange?: string; category?: string;
  /** Position within the CURRENT category (e.g. crypto 37/100), so the UI never
   *  shows a global counter that looks like the category grew past its size. */
  catIndex?: number; catTotal?: number;
}

/** Scoped per-account signal storage key (mobile parity with desktop scoping). */
export function mobileSignalsStorageKey(): string {
  try {
    let email = '';
    try { const u = JSON.parse(localStorage.getItem('finalyze_user') || '{}'); email = String(u?.email || '').toLowerCase().trim(); } catch {}
    if (!email) { try { email = String(localStorage.getItem('finalyze_current_user_email') || '').toLowerCase().trim(); } catch {} }
    const e = email || 'guest';
    const safe = String(e).replace(/[^a-z0-9@._-]/g, '_');
    return `top_signals_persistent__${safe}`;
  } catch { return 'top_signals_persistent__guest'; }
}

export function readMobileAuto(): AutoAnalysisSettings {
  try {
    const raw = localStorage.getItem('auto_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Clients (free OR paid) may use Day Trading only — desktop parity.
      // An old stored scalping/swing value is normalized on load.
      try {
        const u = JSON.parse(localStorage.getItem('finalyze_user') || '{}');
        const email = String(u?.email || '').toLowerCase().trim();
        if (!isDeveloperEmail(email) && parsed?.tradingStyle && parsed.tradingStyle !== TradingStyle.DAY_TRADING) {
          parsed.tradingStyle = TradingStyle.DAY_TRADING;
        }
      } catch {}
      return { ...parsed };
    }
  } catch {}
  return { isEnabled: false, interval: 15, timeframe: '1d', category: 'all', tradingStyle: TradingStyle.DAY_TRADING, volume: 0.8, showAllSignals: false } as AutoAnalysisSettings;
}

/** The crypto category is a FIXED 100-symbol universe. The limit lives in
 *  constants.ts so desktop manual, radar and mobile all enforce the same value. */
export { CRYPTO_SCAN_LIMIT };

/** ── Category-aware symbol picker (same groups as AnalysisForm) ──
 * Ported from desktop AnalysisForm logic:
 * - same visible groups (SYMBOL_GROUPS) + same full symbol universe (ALL_SYMBOLS_DB)
 * - honors finalyze_hidden_symbols + finalyze_custom_symbols just like desktop
 * - crypto is hard-capped at exactly 100 symbols (never grows with custom symbols)
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
    const out = cats.map((c) => {
      // Desktop parity: SYMBOL_GROUPS[cat]?.flatMap(g => g.symbols)
      const base = ((SYMBOL_GROUPS as any)[c.id] || []).flatMap((g: any) => g.symbols || []).filter((s: string) => !hidden.includes(s));
      const unique = [...new Set<string>(base)];
      return {
        id: c.id,
        label: c.label,
        // Crypto can never exceed the curated 100-symbol universe.
        symbols: c.id === 'crypto' ? unique.slice(0, CRYPTO_SCAN_LIMIT) : unique,
      };
    }).filter((g) => g.symbols.length > 0);
    // Desktop parity: custom symbols merged per category via ALL_SYMBOLS_DB.
    // Truly new symbols (any Binance pair / any TradingView symbol) are placed in
    // the category they were registered under. Symbols with no registered
    // category go to "Custom" ONLY — they used to be appended to every category,
    // which is what pushed crypto past its 100-symbol limit.
    const allKnown = new Set<string>();
    for (const v of Object.values(ALL_SYMBOLS_DB as any)) for (const s of (v as string[])) allKnown.add(s);
    for (const g of out) for (const s of g.symbols) allKnown.add(s);
    const tvMap = readCustomTvMap();
    const extraCustom = custom.filter((s) => !hidden.includes(s) && !allKnown.has(s));
    for (const g of out) {
      if (g.id === 'crypto' || g.id === 'custom') continue;
      const extras = extraCustom.filter((s) => tvMap[s.toUpperCase()]?.category === g.id);
      if (extras.length) g.symbols = [...g.symbols, ...extras];
    }
    // Custom crypto entries stay reachable under "Custom" but never join the
    // fixed 100-symbol crypto category.
    const cryptoCustom = extraCustom.filter((s) => tvMap[s.toUpperCase()]?.category === 'crypto');
    const unmapped = extraCustom.filter((s) => !tvMap[s.toUpperCase()]?.category);
    const customSyms = [...new Set([...cryptoCustom, ...unmapped])];
    if (customSyms.length) out.push({ id: 'custom', label: 'Custom', symbols: customSyms });
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

/** Add a custom symbol (desktop: manual add via modal) — persists to finalyze_custom_symbols.
 *  When a category is supplied, Binance/TradingView input is normalized and its
 *  exact chart mapping is registered (any Binance pair / any TV symbol). */
export function addMobileCustomSymbol(sym: string, category?: MarketType): string[] {
  let s = (sym || '').trim();
  if (!s) return getMobileAllSymbols();
  if (category) {
    const norm = registerCustomSymbol(s, category);
    if (norm) s = norm.symbol;
  } else {
    s = s.toUpperCase().replace(/[^A-Z0-9.\-=:^]/g, '');
  }
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
    if (raw) return mergeStrategySettings(JSON.parse(raw));
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
    const key = mobileSignalsStorageKey();
    const raw = localStorage.getItem(key);
    const prev: any[] = raw ? JSON.parse(raw) : [];
    const seen = new Set(prev.map((p: any) => `${p.symbol}_${p.timeframe}_${p.signal}`));
    const fresh = filtered.filter((s) => !seen.has(`${s.symbol}_${(s as any).timeframe || '1d'}_${s.signal}`));
    if (fresh.length > 0) {
      localStorage.setItem(key, JSON.stringify([...fresh, ...prev].slice(0, 100)));
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
  // Desktop parity: only the developer publishes the SHARED feed. A paid-plan
  // client runs their own radar, but publishing here would overwrite the
  // signals every free client sees.
  if (!isDeveloperEmail(email)) return;
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

export async function runMobileRadar(uid: string, email: string, onProg?: (p: MobileProgress) => void, resumeFrom?: string | null) {
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
  // Desktop parity: forex/metals/stocks are closed on Saturday/Sunday (UTC) and
  // stocks are only scanned while their exchange is open. Crypto is 24/7.
  const utcDay = new Date().getUTCDay();
  const weekend = utcDay === 0 || utcDay === 6;
  for (const cat of catSet) {
    const g = groups.find((x) => x.id === cat);
    if (!g) continue;
    if (cat === 'custom') {
      // Custom symbols follow the market they belong to: at the weekend only the
      // crypto ones are scanned (desktop merges them into their own category).
      const syms = weekend
        ? g.symbols.filter((s) => detectMobileType(s) === MarketType.CRYPTO)
        : g.symbols;
      if (syms.length) jobs.push({ cat, syms });
      continue;
    }
    if (cat !== 'crypto' && weekend) continue;
    if (cat === 'stocks') {
      // Never scan stocks outside their session (desktop: getOpenStockExchanges).
      for (const ex of getOpenStockExchanges()) jobs.push({ cat, syms: ex.symbols as string[], exKey: ex.key });
      continue;
    }
    // FULL category list — the crypto category is EXACTLY the curated 100-symbol
    // universe (never more, even if custom symbols were registered).
    if (cat === 'crypto') {
      const cryptoSyms = [...new Set(g.symbols)].slice(0, CRYPTO_SCAN_LIMIT);
      if (cryptoSyms.length) jobs.push({ cat, syms: cryptoSyms });
      continue;
    }
    jobs.push({ cat, syms: [...new Set(g.symbols)] });
  }
  // Flatten the jobs into ONE ordered plan. The same deterministic order is
  // rebuilt on every run, so a refresh can resume at the exact symbol where the
  // previous page was interrupted. A fresh app open clears this state, so a
  // manual start always begins from the first symbol.
  const plan: { cat: string; sym: string; exKey?: any }[] = [];
  for (const j of jobs) for (const sym of j.syms) plan.push({ cat: j.cat, sym, exKey: j.exKey });
  const grandTotal = plan.length;
  // Per-category offsets: the counter can show "crypto 37/100" instead of a
  // global index that climbs past 100 while crypto is the active category.
  const catBounds = new Map<string, { start: number; total: number }>();
  plan.forEach((p, i) => {
    const b = catBounds.get(p.cat);
    if (b) b.total++;
    else catBounds.set(p.cat, { start: i, total: 1 });
  });
  let startIdx = 0;
  if (resumeFrom) {
    const at = plan.findIndex((p) => p.sym === String(resumeFrom).toUpperCase().trim());
    if (at > 0) startIdx = at;
  }
  let done = startIdx;
  const scanned: AnalysisResult[] = [];
  let failed = 0;
  let finished = true;
  for (let i = startIdx; i < plan.length; i++) {
    if (!mRadarOn) { finished = false; break; }
    const { cat, sym, exKey } = plan[i];
    // Paid-client analysis quota (desktop parity): 5 analyses per symbol per
    // UTC day, shared with manual analysis.
    if (email && !isDeveloperEmail(email)) {
      const q = consumeSymbolAnalyses(email, [sym], lang);
      if (q.allowed.length === 0) continue;
    }
    done = i + 1;
    // Persist the resume point BEFORE the network call: a refresh in the middle
    // of this symbol continues from it instead of restarting the whole scan.
    writeMobileRadarResume({ symbol: sym, index: i, total: grandTotal, category: cat });
    const prog: MobileProgress = {
      current: sym, total: grandTotal, index: done, failed,
      exchange: exKey ? exchangeLabel(exKey, lang) : undefined, category: cat,
      catIndex: (done - (catBounds.get(cat)?.start ?? 0)),
      catTotal: catBounds.get(cat)?.total ?? grandTotal,
    };
    // Emit synchronously: the progress bar must paint the instant the user
    // presses START, never after the first network round-trip.
    onProg?.(prog);
    try {
      await waitIfRateLimited();
      const b = await analyzeMarketBatch(
        [{ symbol: sym, type: detectMobileType(sym), timeframe: auto.timeframe || '1d', tradingStyle: auto.tradingStyle || TradingStyle.DAY_TRADING }],
        strategy, lang,
        () => onProg?.(prog)
      );
      if (b.results.length > 0) {
        for (const r of b.results) { r.userId = uid || 'anonymous'; scanned.push(r); }
        failed += b.errors.length;
        await persistMobileResults(b.results, uid || 'anonymous');
      } else { failed++; }
    } catch { failed++; await new Promise((r) => setTimeout(r, 3000)); }
    // Desktop parity: pace the scan so the shared key pool is never hammered.
    if (mRadarOn) await new Promise((r) => setTimeout(r, 2500));
  }
  // A completed scan has no resume point; an interrupted one keeps it.
  if (finished) writeMobileRadarResume(null);
  try { initAudio(); } catch {}
  try { playCompletion(Math.max(0, Math.min(1, Number((auto as any).volume ?? 0.5)))); } catch {}
  const fresh = mergeMobileTopSignals(scanned, !!auto.showAllSignals);
  // Desktop parity: give every category its own slots instead of letting crypto
  // push forex/metals out of a global top-10 list.
  const top = topPerCategory(scanned.filter((s) => {
    const sig = String(s.signal || '');
    return sig !== 'neutral' && sig !== 'no_entry' && !s.isSideways;
  }).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)), 3);
  await publishMobileShared(top, email || '');
  try {
    const cur = readMobileAuto();
    localStorage.setItem('auto_settings', JSON.stringify({ ...cur, lastFinishedAt: Date.now() }));
  } catch {}
  return { scanned: scanned.length, failed, fresh, completed: finished };
}

// ── Mobile radar run state (single source of truth for button + bar) ─────────
// The ON flag lives in sessionStorage: a page REFRESH keeps it (so an
// interrupted scan resumes from the last symbol), while closing the app clears
// it (a fresh open always starts at START/stopped). This is what makes the
// header button and the progress bar deterministic instead of flickering.
const M_RADAR_ON_KEY = 'finalyze_mobile_radar_on_v1';
const M_RADAR_RESUME_KEY = 'finalyze_mobile_radar_resume_v1';

interface MobileRadarResume { symbol: string; index: number; total: number; category?: string }

function readSessionValue(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeSessionValue(key: string, value: string | null) {
  try { if (value == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch {}
}
function writeMobileRadarResume(r: MobileRadarResume | null) {
  writeSessionValue(M_RADAR_RESUME_KEY, r ? JSON.stringify(r) : null);
}
export function readMobileRadarResume(): MobileRadarResume | null {
  try {
    const raw = readSessionValue(M_RADAR_RESUME_KEY);
    return raw ? (JSON.parse(raw) as MobileRadarResume) : null;
  } catch { return null; }
}

let mRadarTimer: ReturnType<typeof setTimeout> | null = null;
let mRadarOn = false;
let mRadarRunId = 0;
let mRadarProg: MobileProgress | null = null;
let mRadarOnProg: ((p: MobileProgress) => void) | null = null;
let mRadarOnDone: ((r: any) => void) | null = null;
const mRadarSubs = new Set<(s: { running: boolean; progress: MobileProgress | null }) => void>();

function emitMobileRadar() {
  const snapshot = { running: mRadarOn, progress: mRadarProg };
  for (const cb of mRadarSubs) { try { cb(snapshot); } catch {} }
}

export function isMobileRadarOn(): boolean { return mRadarOn; }
export function getMobileRadarProgress(): MobileProgress | null { return mRadarProg; }

/** TRUE only when this page session already had the radar ON. A refresh keeps
 * it; closing the app clears it. Used to know whether to resume a scan. */
export function isMobileRadarPersisted(): boolean { return readSessionValue(M_RADAR_ON_KEY) === '1'; }

/** Subscribe the button/bar to the engine. Emits the current state at once, so
 * a remount paints the correct ON/OFF + progress without waiting. */
export function subscribeMobileRadar(cb: (s: { running: boolean; progress: MobileProgress | null }) => void): () => void {
  mRadarSubs.add(cb);
  try { cb({ running: mRadarOn, progress: mRadarProg }); } catch {}
  return () => { mRadarSubs.delete(cb); };
}

export function stopMobileRadar() {
  mRadarOn = false;
  // Supersede any in-flight run so its finalizer cannot turn a NEW run off.
  mRadarRunId++;
  if (mRadarTimer) { clearTimeout(mRadarTimer); mRadarTimer = null; }
  mRadarProg = null;
  writeSessionValue(M_RADAR_ON_KEY, null);
  writeMobileRadarResume(null);
  emitMobileRadar();
}

export async function startMobileRadar(
  uid: string,
  email: string,
  onProg?: (p: MobileProgress) => void,
  onDone?: (r: any) => void,
  opts?: { immediate?: boolean; resume?: boolean },
) {
  // Update callbacks even if already running
  if (onProg) mRadarOnProg = onProg;
  if (onDone) mRadarOnDone = onDone;
  if (mRadarOn) {
    if (mRadarProg) mRadarOnProg?.(mRadarProg);
    emitMobileRadar();
    return;
  }
  mRadarOn = true;
  const runId = ++mRadarRunId;
  writeSessionValue(M_RADAR_ON_KEY, '1');
  emitMobileRadar();

  // Resume only the FIRST run after a page refresh; a manual start is a full scan.
  let pendingResume = opts?.resume ? readMobileRadarResume() : null;

  /** Schedule the NEXT pass after the configured interval. The radar stays ON,
   *  so auto-analysis repeats until the user presses STOP in the app. Only the
   *  owning run may schedule, so a stop+start during a network call cannot be
   *  revived by an old loop. The finish timestamp was already written by
   *  runMobileRadar() (lastFinishedAt, GMT epoch ms). */
  const scheduleNextPass = () => {
    if (!mRadarOn || runId !== mRadarRunId) return;
    if (mRadarTimer) clearTimeout(mRadarTimer);
    mRadarProg = null;
    emitMobileRadar();
    const ms = (readMobileAuto().interval || 15) * 60000;
    mRadarTimer = setTimeout(() => { mRadarTimer = null; void loop(); }, ms);
  };

  const loop = async () => {
    mRadarTimer = null;
    if (!mRadarOn || runId !== mRadarRunId) { if (runId === mRadarRunId) { mRadarProg = null; emitMobileRadar(); } return; }
    const resumeSym = pendingResume?.symbol ?? null;
    pendingResume = null;
    try {
      const r = await runMobileRadar(uid, email, (p) => {
        if (runId !== mRadarRunId) return;
        mRadarProg = p;
        mRadarOnProg?.(p);
        emitMobileRadar();
      }, resumeSym);
      if (runId !== mRadarRunId) return;
      mRadarOnDone?.(r);
    } catch {}
    // CONTINUOUS AUTO-ANALYSIS: keep the radar ON and repeat this pass after
    // the configured interval (measured from the GMT finish timestamp). The
    // loop ends only when stopMobileRadar() is called from the app's STOP.
    scheduleNextPass();
  };

  const auto = readMobileAuto();
  const ms = (auto.interval || 15) * 60000;
  const last = Number(auto.lastFinishedAt || 0);
  const elapsed = last ? Date.now() - last : Infinity;
  // Resume an interrupted scan immediately; otherwise honour the re-analysis
  // interval. This function is only called from a manual START or from the
  // refresh-resume path, never from a cold app open.
  const immediate = opts?.immediate === true || !!pendingResume || elapsed >= ms;
  if (immediate) {
    await loop();
  } else {
    mRadarTimer = setTimeout(() => { mRadarTimer = null; void loop(); }, Math.max(1000, ms - elapsed));
  }
}

// A fresh page with no session marker means the app was closed and reopened:
// never keep a stale resume point (a manual start must begin at symbol #1).
try { if (!isMobileRadarPersisted()) writeMobileRadarResume(null); } catch {}