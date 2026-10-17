import React, { useState, useMemo } from 'react';
import { X, Play, Search, Loader2, CheckCircle2, XCircle, Layers } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { MobileProgress, runMobileManual, getMobileSymbolGroups } from '../../services/mobileAnalysisEngine';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

interface MobileManualSheetProps {
  lang: Language;
  onClose: () => void;
  onDone: (results: AnalysisResult[]) => void;
}

const GROUP_LABELS: Record<string, string> = {
  forex: 'Forex',
  crypto: 'Crypto',
  stocks: 'Stocks',
  metals: 'Metals',
  custom: 'Custom',
};

export function MobileManualSheet({ lang, onClose, onDone }: MobileManualSheetProps) {
  const isAr = lang === 'ar';
  const groups = getMobileSymbolGroups();
  const [catId, setCatId] = useState<string>(groups[0]?.id || 'forex');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<MobileProgress | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [failed, setFailed] = useState<string[]>([]);

  const currentGroup = useMemo(() => groups.find((g) => g.id === catId), [groups, catId]);
  const list = useMemo(() => (currentGroup?.symbols || [])
    .filter((s) => s.toLowerCase().includes(q.toLowerCase())), [currentGroup, q]);

  const uid = () => {
    try {
      const raw = localStorage.getItem('finalyze_user');
      return String(JSON.parse(raw || '{}')?.uid || 'anonymous');
    } catch { return 'anonymous'; }
  };

  const analyze = async (sym: string) => {
    if (busy) return;
    setBusy(true); setProg(null); setResults([]); setFailed([]);
    try {
      const r = await runMobileManual([sym], uid(), (p) => setProg(p));
      setResults(r.results);
      setFailed(r.failed);
      if (r.results.length > 0) onDone(r.results);
    } finally {
      setBusy(false); setProg(null);
    }
  };
  const pct = prog && prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;
  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div className="mt5-trade-title" style={{ margin: 0, textAlign: 'left' }}>
            {isAr ? 'تحليل يدوي' : 'Manual Analysis'}
          </div>
          <button className="mt5-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, overflowX: 'auto' }}>
          {groups.map((g) => {
            const on = g.id === catId;
            return (
              <button key={g.id} onClick={() => { setCatId(g.id); setQ(''); }}
                style={{ whiteSpace: 'nowrap', padding: '8px 12px', borderRadius: 10, border: '1px solid ' + (on ? '#F59E0B' : '#2a2a2a'), background: on ? 'rgba(245,158,11,0.14)' : '#0a0a0a', color: on ? '#F59E0B' : '#888', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                <Layers size={13} style={{ marginRight: 6 }} /> {mobileT(lang, g.id.toLowerCase(), GROUP_LABELS[g.id] || g.id)}
              </button>
            );
          })}
        </div>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#888' }} />
          <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder={isAr ? 'ابحث عن رمز...' : 'Search symbol...'}
              style={{ width: '100%', padding: '9px 10px 9px 32px', borderRadius: 10, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#e0e0e0', fontSize: 14, outline: 'none' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
          {list.map((s) => (
            <button key={s} onClick={() => analyze(s)} disabled={busy}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#e0e0e0', fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.5 : 1 }}>
              <span>{s}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F59E0B', fontSize: 13 }}>
                {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />} {isAr ? 'حلّل' : 'Analyze'}
              </span>
            </button>
          ))}
          {q && !list.includes(q) && (
            <button onClick={() => analyze(q)} disabled={busy}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, border: '1px solid #F59E0B', background: 'rgba(245,158,11,0.1)', color: '#e0e0e0', fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
              <span>{q}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#F59E0B', fontSize: 13 }}>
                {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />} {isAr ? 'حلّل' : 'Analyze'}
              </span>
            </button>
          )}
        </div>
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
            <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: '#888' }}>
              {r.entryPrice ? <span>Entry {r.entryPrice}</span> : null}
              {r.stopLoss ? <span style={{ color: '#ff5555' }}>SL {r.stopLoss}</span> : null}
              {r.takeProfit ? <span style={{ color: '#00ff88' }}>TP {r.takeProfit}</span> : null}
            </div>
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