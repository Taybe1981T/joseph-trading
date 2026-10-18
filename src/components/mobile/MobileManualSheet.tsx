import React, { useState, useMemo } from 'react';
import { X, Play, Search, Loader2, CheckCircle2, XCircle, Plus, Trash2, Zap, Clock } from 'lucide-react';
import { AnalysisResult, TradingStyle } from '../../types';
import { MobileProgress, runMobileManual, getMobileSymbolGroups, addMobileCustomSymbol, hideMobileSymbol } from '../../services/mobileAnalysisEngine';
import { TIMEFRAMES, TRADING_STYLES, FREE_SYMBOLS } from '../../constants';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

interface Props { lang: Language; onClose: () => void; onDone: (r: AnalysisResult[]) => void; }

const STYLE_LBL: Record<string, { en: string; ar: string }> = {
  scalping: { en: 'Scalping', ar: 'سكالبينج' },
  day_trading: { en: 'Day Trading', ar: 'تداول يومي' },
  swing_trading: { en: 'Swing', ar: 'سوينج' },
};

function hasPlan(): boolean {
  try {
    const o = JSON.parse(localStorage.getItem('finalyze_user') || '{}');
    if (o?.isDeveloper) return true;
    return !!localStorage.getItem('active_subscription');
  } catch { return false; }
}

/** Manual analysis sheet — mobile port of desktop AnalysisForm:
 * multi-category select + symbol checkbox grid + add/remove custom
 * + timeframe + trading style + single batched analyze call. */
export function MobileManualSheet({ lang, onClose, onDone }: Props) {
  const isAr = lang === 'ar';
  const paid = hasPlan();
  const [groups, setGroups] = useState(getMobileSymbolGroups);
  const [cats, setCats] = useState<string[]>(() => [getMobileSymbolGroups()[0]?.id || 'forex']);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [tf, setTf] = useState('1d');
  const [style, setStyle] = useState<TradingStyle>(TradingStyle.DAY_TRADING);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<MobileProgress | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [showAll, setShowAll] = useState(false);

  const universe = useMemo(() => {
    const out: string[] = [];
    for (const g of groups) if (cats.includes(g.id)) out.push(...g.symbols);
    return [...new Set(out)];
  }, [groups, cats]);
  const visible = useMemo(() => {
    const f = universe.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
    return showAll ? f : f.slice(0, 60);
  }, [universe, q, showAll]);

  const toggleCat = (id: string) => setCats((p) => p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : [...p, id]);
  const toggleSym = (s: string) => setSel((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);
  const FREE_ALL: string[] = useMemo(() => Object.values(FREE_SYMBOLS as Record<string, string[]>).flat(), []);
  const lockedSym = (s: string) => !paid && !FREE_ALL.includes(s);

  const doAdd = () => {
    const s = custom.trim().toUpperCase();
    if (!s) return;
    addMobileCustomSymbol(s);
    setGroups(getMobileSymbolGroups());
    setSel((p) => p.includes(s) ? p : [...p, s]);
    if (!cats.includes('custom')) setCats((p) => [...p, 'custom']);
    setCustom('');
  };
  const doHide = (s: string) => {
    hideMobileSymbol(s);
    setGroups(getMobileSymbolGroups());
    setSel((p) => p.filter((x) => x !== s));
  };
  const uid = () => {
    try { return String(JSON.parse(localStorage.getItem('finalyze_user') || '{}')?.uid || 'anonymous'); }
    catch { return 'anonymous'; }
  };
  const analyze = async () => {
    const syms = sel.filter((s) => !lockedSym(s));
    if (busy || syms.length === 0) return;
    setBusy(true); setProg(null); setResults([]); setFailed([]);
    try {
      const r = await runMobileManual(syms, uid(), (p) => setProg(p), { timeframe: tf, tradingStyle: style });
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
        <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>{mobileT(lang, 'Categories', 'الفئات')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {groups.map((g) => {
            const on = cats.includes(g.id);
            return (
              <button key={g.id} onClick={() => toggleCat(g.id)}
                style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: on ? '#F59E0B' : '#888', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                {g.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>TF</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TIMEFRAMES.map((t) => {
                const locked = !paid && t.id !== '1d';
                const on = tf === t.id;
                return (
                  <button key={t.id} disabled={locked} onClick={() => setTf(t.id)}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#444' : on ? '#F59E0B' : '#bbb', fontSize: 12, fontWeight: 800, opacity: locked ? 0.4 : 1 }}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#F59E0B', marginBottom: 6 }}>Style</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {TRADING_STYLES.map((st) => {
                const locked = !paid && st.id !== 'day_trading';
                const on = style === st.id;
                const lbl = STYLE_LBL[st.id] || { en: st.label, ar: st.label };
                return (
                  <button key={st.id} disabled={locked} onClick={() => setStyle(st.id as TradingStyle)}
                    style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#444' : on ? '#F59E0B' : '#bbb', fontSize: 12, fontWeight: 800, opacity: locked ? 0.4 : 1, textAlign: 'left' }}>
                    {isAr ? lbl.ar : lbl.en}{locked ? ' 🔒' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#888', marginBottom: 6, marginTop: 8 }}>{universe.length} symbols · <b style={{ color: '#F59E0B' }}>{sel.length}</b> selected</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#666' }} />
            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder={mobileT(lang, 'Search symbol...', 'ابحث عن رمز...')}
              style={{ width: '100%', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 10px 10px 32px', color: '#fff', fontSize: 14, outline: 'none' }} />
          </div>
          <button onClick={() => setSel((p) => [...new Set([...p, ...visible])])} style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', color: '#F59E0B', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>{isAr ? 'الكل' : 'All'}</button>
          {sel.length > 0 && (
            <button onClick={() => setSel([])} style={{ background: 'none', border: 'none', color: '#888', fontSize: 12 }}>{isAr ? 'مسح' : 'Clear'}</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} placeholder={mobileT(lang, 'New symbol...', 'رمز جديد...')}
            onKeyDown={(e) => { if (e.key === 'Enter') doAdd(); }}
            style={{ flex: 1, background: '#0a0a0a', border: '1px dashed #444', borderRadius: 10, padding: '9px 12px', color: '#fff', fontSize: 13, outline: 'none' }} />
          <button onClick={doAdd} style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '9px 14px', color: '#F59E0B', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={14} /> {isAr ? 'أضف' : 'Add'}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
          {visible.map((s) => {
            const on = sel.includes(s);
            const locked = lockedSym(s);
            return (
              <div key={s} onClick={() => { if (!locked) toggleSym(s); }}
                style={{ position: 'relative', padding: '10px 6px', borderRadius: 10, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: locked ? '#151515' : on ? 'rgba(245,158,11,0.15)' : '#0a0a0a', color: locked ? '#555' : on ? '#F59E0B' : '#ddd', fontSize: 12, fontWeight: 800, textAlign: 'center', opacity: locked ? 0.55 : 1 }}>
                {on && <span style={{ position: 'absolute', top: 3, right: 5, fontSize: 10, color: '#F59E0B' }}>✓</span>}
                {locked && <span style={{ position: 'absolute', top: 3, right: 5, fontSize: 10 }}>🔒</span>}
                {s}
                {!locked && (
                  <span onClick={(e) => { e.stopPropagation(); doHide(s); }} style={{ position: 'absolute', bottom: 2, right: 5, color: '#666' }}><Trash2 size={10} /></span>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={analyze} disabled={busy || sel.length === 0}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 12, border: 'none', background: sel.length === 0 ? '#2a2a2a' : '#F59E0B', color: sel.length === 0 ? '#666' : '#000', fontSize: 15, fontWeight: 900, opacity: busy ? 0.6 : 1 }}>
          {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
          {busy ? mobileT(lang, 'Analyzing...', 'جارٍ التحليل...') : mobileT(lang, 'Analyze (' + sel.length + ')', 'حلّل (' + sel.length + ')')}
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