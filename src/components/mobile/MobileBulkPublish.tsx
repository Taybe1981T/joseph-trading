import React, { useState } from 'react';
import { X, Play, Loader2, CheckCircle2 } from 'lucide-react';
import { AnalysisResult } from '../../types';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { publishMirrorEventsFor } from '../../services/tradeMirror';

interface Props {
  lang: Language;
  onClose: () => void;
}

export function MobileBulkPublish({ lang, onClose }: Props) {
  const isAr = lang === 'ar';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ published: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadResults = (): AnalysisResult[] => {
    try {
      const raw = localStorage.getItem('manual_results');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const publishAll = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const results = loadResults();
      if (results.length === 0) {
        setError(isAr ? 'لا توجد نتائج يدوية للنشر' : 'No manual results to publish');
        return;
      }
      const r = await publishMirrorEventsFor(results);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || isAr ? 'فشل النشر' : 'Publish failed');
    } finally { setBusy(false); }
  };

  const results = loadResults();
  const strong = results.filter((r: AnalysisResult) => r.signal === 'strong_buy' || r.signal === 'strong_sell');

  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
            <Play size={18} style={{ marginRight: 6, color: '#F59E0B' }} />
            {mobileT(lang, 'Bulk Publish', 'النشر الجماعي')}
          </div>
          <button className="mt5-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
          {results.length} {mobileT(lang, 'manual signals', 'إشارة يدوية')} · {strong.length} {mobileT(lang, 'executable', 'قابلة للتنفيذ')}
        </div>
        {error && (
          <div style={{ background: 'rgba(255,51,51,0.1)', border: '1px solid rgba(255,51,51,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fca5a5', marginBottom: 12, textAlign: 'center' }}>
            {error}
          </div>
        )}
        {result && (
          <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#00ff88', marginBottom: 12, textAlign: 'center' }}>
            {mobileT(lang, `Published ${result.published} signals to clients`, `تم نشر ${result.published} إشارة للعملاء`)} ·
            {result.skipped > 0 && mobileT(lang, `${result.skipped} skipped (cooldown)`, `${result.skipped} تم التخطي (فترة التبريد)`)}
          </div>
        )}
        <button onClick={publishAll} disabled={busy || results.length === 0}
          style={{ width: '100%', maxWidth: 340, padding: '14px 0', borderRadius: 10, border: 'none', background: busy ? '#666' : '#F59E0B', color: '#000', fontSize: 15, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: busy || results.length === 0 ? 0.5 : 1, marginBottom: 12 }}>
          {busy ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : null}
          {busy ? mobileT(lang, 'Publishing...', 'جارٍ النشر...') : mobileT(lang, 'Publish All to Clients', 'نشر الكل للعملاء')}
        </button>
        {strong.length > 0 && (
          <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#888', marginBottom: 8 }}>{mobileT(lang, 'Strongest signals to publish', 'أقوى الإشارات للنشر')}</div>
            {strong.map((r: AnalysisResult) => (
              <div key={r.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#e0e0e0', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span>{r.symbol}</span>
                <span style={{ color: r.signal.includes('buy') ? '#00ff88' : '#ff5555' }}>{r.confidence}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}