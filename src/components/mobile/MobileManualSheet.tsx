import React, { useState, useMemo } from 'react';
import { X, Play, Search, Loader2, CheckCircle2, XCircle, Plus, Trash2, Zap, Clock } from 'lucide-react';
import { AnalysisResult, TradingStyle } from '../../types';
import { MobileProgress, runMobileManual, getMobileSymbolGroups, addMobileCustomSymbol } from '../../services/mobileAnalysisEngine';
import { TIMEFRAMES, TRADING_STYLES, FREE_SYMBOLS, ALL_SYMBOLS_DB } from '../../constants';
import { Language } from '../../lib/i18n';
import { mobileT, detectMobileMode, hasClientPlan } from '../../lib/mobileMode';

interface Props { lang: Language; onClose: () => void; onDone: (r: AnalysisResult[]) => void; }

const STYLE_LBL: Record<string, { en: string; ar: string }> = {
  scalping: { en: 'Scalping', ar: 'سكالبينج' },
  day_trading: { en: 'Day Trading', ar: 'تداول يومي' },
  swing_trading: { en: 'Swing', ar: 'سوينج' },
};

function hasPlan(): boolean {
  // Same detection the app uses everywhere: email-based developer mode OR an active plan.
  try { if (detectMobileMode().mode === 'developer') return true; } catch {}
  try { if (hasClientPlan()) return true; } catch {}
  try { return !!localStorage.getItem('active_subscription'); } catch { return false; }
}

export function MobileManualSheet({ lang, onClose, onDone }: Props) {
  const isAr = lang === 'ar';
  const paid = hasPlan();
  const [groups, setGroups] = useState(getMobileSymbolGroups);
  const [selectedType, setSelectedType] = useState<string>(groups[0]?.id || 'forex');
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [tf, setTf] = useState('1d');
  const [style, setStyle] = useState<TradingStyle>(TradingStyle.DAY_TRADING);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<MobileProgress | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [hiddenTick, setHiddenTick] = useState(0);

  const allCategorySymbols = useMemo(() => {
    const g = groups.find((x) => x.id === selectedType);
    const groupSyms = g ? g.symbols : [];
    const allKnown = new Set<string>();
    for (const v of Object.values(ALL_SYMBOLS_DB as any)) for (const s of (v as string[])) allKnown.add(s);
    for (const s of groupSyms) allKnown.add(s);
    try {
      const custom: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
      const extra = custom.filter(s => !allKnown.has(s));
      return [...groupSyms, ...extra];
    } catch { return groupSyms; }
  }, [groups, selectedType]);

  const hidden: string[] = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('finalyze_hidden_symbols') || '[]'); } catch { return []; }
  }, [hiddenTick]);

  const restoreHidden = () => {
    try { localStorage.removeItem('finalyze_hidden_symbols'); } catch {}
    setHiddenTick(t => t + 1);
    setGroups(getMobileSymbolGroups());
  };

  const FREE_ALL: string[] = useMemo(() => {
    try {
      const fs = FREE_SYMBOLS as Record<string, string[]>;
      return Object.values(fs).flat();
    } catch { return []; }
  }, []);

  const visibleSymbols = useMemo(() => {
    return allCategorySymbols.filter(s => !hidden.includes(s) && s.toLowerCase().includes(q.toLowerCase()));
  }, [allCategorySymbols, hidden, q]);

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);
  };

  const selectAllInCategory = () => {
    if (!paid) return;
    const all = allCategorySymbols.filter(s => !hidden.includes(s));
    const areAllSelected = all.length > 0 && all.every(s => selectedSymbols.includes(s));
    if (areAllSelected) {
      setSelectedSymbols(prev => prev.filter(s => !all.includes(s)));
    } else {
      setSelectedSymbols(prev => [...new Set([...prev, ...all])]);
    }
  };

  const removeSymbol = (sym: string) => {
    setSelectedSymbols(prev => prev.filter(s => s !== sym));
    try {
      const custom: string[] = JSON.parse(localStorage.getItem('finalyze_custom_symbols') || '[]');
      if (custom.includes(sym)) {
        localStorage.setItem('finalyze_custom_symbols', JSON.stringify(custom.filter(s => s !== sym)));
        setGroups(getMobileSymbolGroups());
      } else {
        const hid: string[] = JSON.parse(localStorage.getItem('finalyze_hidden_symbols') || '[]');
        if (!hid.includes(sym)) localStorage.setItem('finalyze_hidden_symbols', JSON.stringify([...hid, sym]));
        setGroups(getMobileSymbolGroups());
      }
    } catch {}
  };

  const clearAll = () => { if (paid) setSelectedSymbols([]); };

  const uid = () => {
    try { return String(JSON.parse(localStorage.getItem('finalyze_user') || '{}')?.uid || 'anonymous'); }
    catch { return 'anonymous'; }
  };

  const analyze = async () => {
    const manualSyms = manualInput.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 1);
    const allSyms = [...new Set([...selectedSymbols, ...manualSyms])];
    if (busy || allSyms.length === 0) return;
    setBusy(true); setProg(null); setResults([]); setFailed([]);
    try {
      const r = await runMobileManual(allSyms, uid(), (p) => setProg(p), { timeframe: tf, tradingStyle: style });
      setResults(r.results); setFailed(r.failed);
      if (r.results.length > 0) onDone(r.results);
    } finally { setBusy(false); setProg(null); }
  };

  const pct = prog && prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;

  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '92vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="mt5-trade-title" style={{ margin: 0, textAlign: 'left' }}>{mobileT(lang, 'Manual Analysis', 'التحليل اليدوي')}</div>
          <button className="mt5-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>{mobileT(lang, 'Category', 'الفئة')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {groups.map((g) => {
            const on = selectedType === g.id;
            return (
              <button key={g.id} onClick={() => { setSelectedType(g.id); setQ(''); }}
                style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: on ? '#F59E0B' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {g.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={13} /> {mobileT(lang, 'Timeframe', 'الإطار')}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TIMEFRAMES.map((t) => {
                const locked = !paid && t.id !== '1d';
                const on = tf === t.id;
                return (
                  <button key={t.id} disabled={locked} onClick={() => setTf(t.id)}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#444' : on ? '#F59E0B' : '#bbb', fontSize: 12, fontWeight: 800, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1 }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}><Zap size={13} /> {mobileT(lang, 'Style', 'الأسلوب')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TRADING_STYLES.map((st) => {
                const locked = !paid && st.id !== 'day_trading';
                const on = style === st.id;
                const lbl = STYLE_LBL[st.id] || { en: st.label, ar: st.label };
                return (
                  <button key={st.id} disabled={locked} onClick={() => setStyle(st.id as TradingStyle)}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#444' : on ? '#F59E0B' : '#bbb', fontSize: 12, fontWeight: 800, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1, textAlign: 'left' }}>
                    {isAr ? lbl.ar : lbl.en}{locked ? ' 🔒' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder={mobileT(lang, 'Search symbol...', 'ابحث عن رمز...')}
              style={{ width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 10px 10px 32px', color: '#fff', fontSize: 14, outline: 'none' }} />
          </div>
          <button onClick={selectAllInCategory} disabled={!paid}
            style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', color: '#F59E0B', fontSize: 12, fontWeight: 800, cursor: paid ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', opacity: paid ? 1 : 0.5 }}>{mobileT(lang, 'Select All', 'تحديد الكل')}</button>
          {selectedSymbols.length > 0 && (
            <button onClick={clearAll} disabled={!paid}
              style={{ background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: paid ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', opacity: paid ? 1 : 0.5 }}>{mobileT(lang, 'Clear', 'مسح')}</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input value={customInput} onChange={(e) => setCustomInput(e.target.value.toUpperCase())} placeholder={mobileT(lang, 'New symbol (e.g. TSLA)...', 'رمز جديد (مثال: TSLA)...')}
            onKeyDown={(e) => { if (e.key === 'Enter') { const s = customInput.trim().toUpperCase(); if (s) { addMobileCustomSymbol(s); setGroups(getMobileSymbolGroups()); setCustomInput(''); } } }}
            style={{ flex: 1, background: '#0a0a0a', border: '1px dashed #444', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
          <button onClick={() => { const s = customInput.trim().toUpperCase(); if (s) { addMobileCustomSymbol(s); setGroups(getMobileSymbolGroups()); setCustomInput(''); } }}
            style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '9px 14px', color: '#F59E0B', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={14} /> {isAr ? 'أضف' : 'Add'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input value={manualInput} onChange={(e) => setManualInput(e.target.value.toUpperCase())} placeholder={mobileT(lang, 'Or type symbols separated by comma...', 'أو اكتب رموز مفصولة بفاصلة...')}
            style={{ flex: 1, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{visibleSymbols.length} {mobileT(lang, 'symbols', 'رموز')} · {mobileT(lang, 'selected', 'المحدد')} <b style={{ color: '#F59E0B' }}>{selectedSymbols.length}</b></span>
          {hidden.length > 0 && (
            <button onClick={restoreHidden}
              style={{ marginLeft: 'auto', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.4)', color: '#60A5FA', borderRadius: 8, padding: '4px 8px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
              {isAr ? `إظهار المخفي (${hidden.length})` : `Show hidden (${hidden.length})`}
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
          {visibleSymbols.map((s) => {
            const on = selectedSymbols.includes(s);
            const locked = !paid && !FREE_ALL.includes(s);
            return (
              <div key={s} onClick={() => { if (!locked) toggleSymbol(s); }}
                style={{ position: 'relative', padding: '10px 6px', borderRadius: 10, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: locked ? '#151515' : on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#555' : on ? '#F59E0B' : '#ddd', fontSize: 12, fontWeight: 800, cursor: locked ? 'not-allowed' : 'pointer', textAlign: 'center', opacity: locked ? 0.55 : 1 }}>
                {on && <span style={{ position: 'absolute', top: 3, right: 5, fontSize: 10, color: '#F59E0B' }}>✓</span>}
                {locked && <span style={{ position: 'absolute', top: 3, right: 5, fontSize: 10 }}>🔒</span>}
                {s}
                {!locked && (
                  <span onClick={(e) => { e.stopPropagation(); removeSymbol(s); }} style={{ position: 'absolute', bottom: 2, right: 5, color: '#666' }}><Trash2 size={10} /></span>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={analyze} disabled={busy || (selectedSymbols.length === 0 && manualInput.trim() === '')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 12, border: 'none', background: (selectedSymbols.length === 0 && manualInput.trim() === '') ? '#2a2a2a' : '#F59E0B', color: (selectedSymbols.length === 0 && manualInput.trim() === '') ? '#666' : '#000', fontSize: 15, fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
          {busy ? mobileT(lang, 'Analyzing...', 'جارٍ التحليل...') : mobileT(lang, 'Analyze', 'حلّل')}
        </button>
        {prog && (
          <div style={{ marginTop: 12, background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#F59E0B' }} />
              <span style={{ flex: 1 }}>{prog.current}</span>
              <span style={{ color: '#F59E0B' }}>{pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#2a2a2a', marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pct + '%', background: '#F59E0B', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
        {results.length > 0 && results.map((r) => (
          <div key={r.symbol} style={{ marginTop: 12, background: '#0a0a0a', border: '1px solid rgba(0,255,136,0.3)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800 }}>
              <CheckCircle2 size={16} style={{ color: '#00ff88' }} />
              {r.symbol}
              <span style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 999, background: String(r.signal).includes('buy') ? 'rgba(0,255,136,0.15)' : 'rgba(255,51,51,0.15)', color: String(r.signal).includes('buy') ? '#00ff88' : '#ff5555' }}>
                {String(r.signal).toUpperCase()} {r.confidence}%
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>{(r.summary || '').slice(0, 200)}</div>
          </div>
        ))}
        {failed.length > 0 && failed.map((f, i) => (
          <div key={i} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fca5a5' }}>
            <XCircle size={14} /> {f}
          </div>
        ))}
      </div>
    </div>
  );
}