import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, RefreshCw, Crown, Clock,
  Receipt, ShieldOff, Trash2, X, AlertTriangle,
} from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';
import { db } from '../../lib/firebase';
import {
  collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { clientDocId } from '../../lib/clientIds';
import { purgeOwnKeyForEmail } from '../../lib/clientScope';
import {
  deleteTransaction, fetchAllPlanGrants, fetchClientTransactionsByEmail,
  PaymentGrant, PaymentRequest,
} from '../../services/paymentRequests';

/**
 * Mobile Client Monitor — same data source and same rules as the desktop
 * Monitor (App.tsx): Firestore `clients` merged with the local cache, plan
 * bounds derived from payment_grants, the same status healing, the same
 * ban/delete/transactions actions. Any change made here is written to
 * Firestore so the desktop table shows it too (and vice versa).
 */

interface ClientRecord {
  id: string;
  email: string;
  uid: string;
  status: string;
  plan: string;
  planExpiry: string | null;
  registeredAt: any;
  rank: number;
}

interface Props {
  lang: Language;
  onClose: () => void;
  /** Reports the row count so the bottom-nav / header badge stays accurate. */
  onCountChange?: (n: number) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function MobileClientMonitor({ lang, onClose, onCountChange }: Props) {
  const isAr = lang === 'ar';
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [grants, setGrants] = useState<PaymentGrant[]>([]);
  const [bannedEmails, setBannedEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ── Transaction sheet (parity with the desktop receipt modal) ─────────────
  const [txClient, setTxClient] = useState<ClientRecord | null>(null);
  const [txRequests, setTxRequests] = useState<PaymentRequest[]>([]);
  const [txGrants, setTxGrants] = useState<PaymentGrant[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txDeleting, setTxDeleting] = useState<string | null>(null);
  const [txConfirmDeleteAll, setTxConfirmDeleteAll] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const readLocal = (): ClientRecord[] => {
    try {
      const arr = JSON.parse(localStorage.getItem('finalyze_clients') || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  const sortRows = (rows: ClientRecord[]): ClientRecord[] =>
    [...rows].sort((a, b) => (Number(a?.rank) || 0) - (Number(b?.rank) || 0));

  const readBanned = (): string[] => {
    try {
      const arr = JSON.parse(localStorage.getItem('finalyze_banned_emails') || '[]');
      return Array.isArray(arr) ? arr.map((e: any) => String(e).toLowerCase().trim()) : [];
    } catch { return []; }
  };

  // Exact desktop fetch: Firestore first (ordered by rank), local cache fills
  // whatever Firestore does not have, then the merged list is cached locally.
  const loadClients = useCallback(async () => {
    setLoading(true);
    const local = readLocal();
    setBannedEmails(readBanned());
    try {
      const snap = await getDocs(query(collection(db, 'clients'), orderBy('rank', 'asc')));
      const fsClients = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientRecord));
      const fsEmails = new Set(fsClients.map((c) => String(c.email || '').toLowerCase()));
      const merged = [
        ...fsClients,
        ...local.filter((c) => !fsEmails.has(String(c.email || '').toLowerCase())),
      ];
      try { localStorage.setItem('finalyze_clients', JSON.stringify(merged)); } catch {}
      setClients(sortRows(merged));
    } catch (e) {
      console.warn('[MobileClientMonitor] Firestore clients failed, using cache:', e);
      setClients(sortRows(local));
    }
    try {
      const g = await fetchAllPlanGrants();
      setGrants(Array.isArray(g) ? g : []);
    } catch (e) {
      console.warn('[MobileClientMonitor] grants failed:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadClients();
    window.addEventListener('storage', loadClients);
    return () => window.removeEventListener('storage', loadClients);
  }, [loadClients]);

  useEffect(() => {
    onCountChange?.(clients.length);
  }, [clients.length, onCountChange]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const daysLeft = (expiry: string | null): number => {
    if (!expiry) return 0;
    return Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  // Every plan date is stored in UTC and shown in GMT (same as desktop).
  const gmt = (iso: string | null) =>
    iso && isFinite(new Date(iso).getTime())
      ? new Date(iso).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false })
      : '';

  // Plan bounds come from payment_grants (developer-created), with the legacy
  // clients.planExpiry as fallback — identical to the desktop calculation.
  const planState = (client: ClientRecord): { paid: boolean; expiry: string | null; firstRelease: string | null } => {
    const email = String(client.email || '').toLowerCase();
    let expiry: string | null = client.planExpiry || null;
    let firstRelease: string | null = null;
    let hasGrant = false;
    for (const g of grants) {
      if (String(g.email || '').toLowerCase() !== email) continue;
      const start = g.activatedAt || null;
      if (start && (!firstRelease || new Date(start).getTime() < new Date(firstRelease).getTime())) {
        firstRelease = start;
      }
      if (!g.expiryDate) continue;
      hasGrant = true;
      if (!expiry || new Date(g.expiryDate).getTime() > new Date(expiry).getTime()) {
        expiry = g.expiryDate;
      }
    }
    const running = (!!expiry && daysLeft(expiry) > 0) && (hasGrant || client.plan === 'paid');
    return { paid: running, expiry, firstRelease };
  };

  const isEmailBanned = (c: ClientRecord) =>
    c.status === 'banned' || bannedEmails.includes(String(c.email || '').toLowerCase().trim());

  // A running paid plan means ACTIVATED — stale 'pending' rows heal to verified.
  const effectiveStatus = (c: ClientRecord): 'verified' | 'pending' | 'banned' => {
    if (isEmailBanned(c)) return 'banned';
    if (planState(c).paid) return 'verified';
    return c.status === 'verified' ? 'verified' : c.status === 'banned' ? 'banned' : 'pending';
  };

  const persist = (rows: ClientRecord[]) => {
    try { localStorage.setItem('finalyze_clients', JSON.stringify(rows)); } catch {}
    onCountChange?.(rows.length);
  };

  // ── Ban / unban (writes Firestore + banned list, like the desktop) ────────
  const toggleBan = async (c: ClientRecord) => {
    const email = String(c.email || '').toLowerCase().trim();
    const wasBanned = isEmailBanned(c);
    if (!wasBanned && !window.confirm(isAr ? `حظر العميل ${c.email}؟` : `Ban client ${c.email}?`)) return;
    setBusy(c.id);
    const list = bannedEmails.filter((e) => e !== email);
    if (!wasBanned) list.push(email);
    try {
      localStorage.setItem('finalyze_banned_emails', JSON.stringify(list));
      setBannedEmails(list);
      const nextStatus = wasBanned ? 'verified' : 'banned';
      try {
        await updateDoc(doc(db, 'clients', c.id || clientDocId(email)), { status: nextStatus });
      } catch (e) {
        console.warn('[MobileClientMonitor] Firestore ban failed:', e);
      }
      const nextRows = clients.map((x) => (x.id === c.id ? { ...x, status: nextStatus } : x));
      setClients(nextRows);
      persist(nextRows);
    } finally {
      setBusy(null);
    }
  };

  // ── Delete (same cascade as the desktop deleteClientByEmail) ─────────────
  const removeClient = async (c: ClientRecord) => {
    if (!window.confirm(isAr ? `حذف العميل ${c.email}؟` : `Delete client ${c.email}?`)) return;
    const email = String(c.email || '').toLowerCase().trim();
    setBusy(c.id);
    try {
      try {
        const snap = await getDocs(query(collection(db, 'clients'), where('email', '==', email)));
        await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, 'clients', d.id))));
      } catch (e) {
        console.warn('[MobileClientMonitor] Firestore delete failed:', e);
      }
      const nextRows = clients.filter((x) => String(x.email || '').toLowerCase().trim() !== email);
      setClients(nextRows);
      persist(nextRows);
      try {
        const arr = JSON.parse(localStorage.getItem('finalyze_client_emails') || '[]');
        localStorage.setItem(
          'finalyze_client_emails',
          JSON.stringify(
            (Array.isArray(arr) ? arr : []).filter(
              (x: any) => String(x?.email || '').toLowerCase().trim() !== email,
            ),
          ),
        );
      } catch {}
      const list = bannedEmails.filter((e) => e !== email);
      try { localStorage.setItem('finalyze_banned_emails', JSON.stringify(list)); } catch {}
      setBannedEmails(list);
      // Deleted client returns as a brand-new customer (no saved analysis key).
      purgeOwnKeyForEmail(email);
    } finally {
      setBusy(null);
    }
  };

  // ── Transactions ────────────────────────────────────────────────────────
  const openTxModal = async (c: ClientRecord) => {
    setTxClient(c);
    setTxRequests([]);
    setTxGrants([]);
    setTxLoading(true);
    setTxConfirmDeleteAll(false);
    setTxError(null);
    try {
      const { requests, grants: g } = await fetchClientTransactionsByEmail(c.email);
      setTxRequests(Array.isArray(requests) ? requests : []);
      setTxGrants(Array.isArray(g) ? g : []);
    } catch (e) {
      console.warn('[MobileClientMonitor] transactions failed:', e);
      setTxError(isAr ? 'تعذّر تحميل المعاملات' : 'Could not load transactions');
    }
    setTxLoading(false);
  };

  const closeTxModal = () => {
    setTxClient(null);
    setTxRequests([]);
    setTxGrants([]);
    setTxConfirmDeleteAll(false);
    setTxError(null);
  };

  const handleTxDeleteOne = async (id: string) => {
    setTxDeleting(id);
    setTxError(null);
    const ok = await deleteTransaction(id);
    if (ok) {
      setTxRequests((prev) => prev.filter((r) => r.id !== id));
    } else {
      setTxError(isAr ? 'فشل الحذف — تحقق من الاتصال' : 'Delete failed — check connection');
    }
    setTxDeleting(null);
  };

  const handleTxDeleteAll = async () => {
    setTxDeleting('all');
    setTxError(null);
    const results = await Promise.allSettled(
      txRequests.map((r) => (r.id ? deleteTransaction(r.id) : Promise.resolve(false))),
    );
    const deleted = new Set(
      txRequests
        .filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<any>).value === true)
        .map((r) => r.id!),
    );
    setTxRequests((prev) => prev.filter((r) => !deleted.has(r.id!)));
    setTxConfirmDeleteAll(false);
    setTxDeleting(null);
    if (results.some((r) => r.status === 'rejected' || (r as PromiseFulfilledResult<any>).value === false)) {
      setTxError(isAr ? 'تعذّر حذف بعض المعاملات' : 'Some transactions could not be deleted');
    }
  };

  const summary = useMemo(() => ({
    total: clients.length,
    verified: clients.filter((c) => effectiveStatus(c) === 'verified').length,
    pending: clients.filter((c) => effectiveStatus(c) === 'pending').length,
    banned: clients.filter((c) => effectiveStatus(c) === 'banned').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [clients, grants, bannedEmails]);

  const fmtDate = (v: any): string => {
    if (!v) return '--';
    try {
      const d = typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate() : new Date(v);
      return isFinite(d.getTime()) ? d.toLocaleDateString('en-GB') : '--';
    } catch { return '--'; }
  };

  const leftText = (st: { expiry: string | null }) => {
    if (!st.expiry) return null;
    const ms = new Date(st.expiry).getTime() - now;
    if (!isFinite(ms)) return null;
    if (ms <= 0) return { past: true, text: isAr ? 'انتهت' : 'Ended' };
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return {
      past: false,
      text: isAr ? `${d}ي ${pad(h)}س ${pad(m)}د` : `${d}d ${pad(h)}h ${pad(m)}m`,
    };
  };

  const panel = 'var(--mt5-panel)';
  const border = 'var(--mt5-border)';
  const text = 'var(--mt5-text)';
  const muted = 'var(--mt5-text-muted)';

  const actionBtn = (color: string, bg: string, bd: string): React.CSSProperties => ({
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '7px 6px',
    borderRadius: 9,
    border: `1px solid ${bd}`,
    background: bg,
    color,
    fontSize: 10.5,
    fontWeight: 800,
    cursor: 'pointer',
  });

  const chip = (kind: 'verified' | 'pending' | 'banned'): React.CSSProperties => ({
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 9.5,
    fontWeight: 900,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    background: kind === 'banned' ? 'rgba(239,68,68,0.15)' : kind === 'pending' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
    color: kind === 'banned' ? '#ef4444' : kind === 'pending' ? '#f59e0b' : '#10B981',
    border: `1px solid ${kind === 'banned' ? 'rgba(239,68,68,0.35)' : kind === 'pending' ? 'rgba(245,158,11,0.35)' : 'rgba(16,185,129,0.35)'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px 18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 900, color: text }}>
          <Users size={18} style={{ color: '#F59E0B' }} />
          {mobileT(lang, 'Client Monitor', 'مراقبة العملاء')}
        </div>
        <button
          type="button"
          onClick={() => { void loadClients(); }}
          disabled={loading}
          aria-label="Refresh"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9, border: `1px solid ${border}`, background: panel, color: text, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1 }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary — same four counters as desktop */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[
          { label: isAr ? 'إجمالي' : 'Total', value: summary.total, color: text },
          { label: isAr ? 'مفعل' : 'Verified', value: summary.verified, color: '#10B981' },
          { label: isAr ? 'انتظار' : 'Pending', value: summary.pending, color: '#f59e0b' },
          { label: isAr ? 'محظور' : 'Banned', value: summary.banned, color: '#ef4444' },
        ].map((s) => (
          <div key={s.label} style={{ background: panel, border: `1px solid ${border}`, borderRadius: 11, padding: '8px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
            <div style={{ fontSize: 9, fontWeight: 800, color: muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Clients — every row/field the desktop table shows */}
      {loading && clients.length === 0 ? (
        <div style={{ padding: 26, textAlign: 'center', color: muted, fontSize: 12.5 }}>
          {mobileT(lang, 'Loading clients…', 'جارٍ تحميل العملاء…')}
        </div>
      ) : clients.length === 0 ? (
        <div style={{ padding: 26, textAlign: 'center', color: muted, fontSize: 12.5, background: panel, border: `1px solid ${border}`, borderRadius: 12 }}>
          {mobileT(lang, 'No clients registered yet', 'لا يوجد عملاء مسجلين بعد')}
        </div>
      ) : (
        clients.map((c) => {
          const st = planState(c);
          const eff = effectiveStatus(c);
          const left = leftText(st);
          const isPaid = st.paid;
          const rowKey = c.id || String(c.email || '');
          return (
            <div
              key={rowKey}
              style={{ background: panel, border: `1px solid ${border}`, borderRadius: 12, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {/* Rank · Email · Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: muted, flexShrink: 0 }}>#{c.rank ?? 0}</span>
                <span
                  dir="ltr"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 800, color: 'var(--mt5-accent)' }}
                >
                  {c.email}
                </span>
                {isPaid && <Crown size={14} style={{ color: '#F59E0B', fill: '#F59E0B', flexShrink: 0 }} />}
                <span style={chip(eff)}>
                  {eff === 'verified'
                    ? mobileT(lang, 'Verified', 'مفعل')
                    : eff === 'banned'
                      ? mobileT(lang, 'Banned', 'محظور')
                      : mobileT(lang, 'Pending', 'قيد الانتظار')}
                </span>
              </div>

              {/* Registered · Plan · Left */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 10.5, color: muted }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Clock size={11} />
                  {mobileT(lang, 'Registered', 'التسجيل')}: {fmtDate(c.registeredAt)}
                </span>
                <span
                  style={{
                    padding: '1px 7px',
                    borderRadius: 999,
                    fontSize: 9.5,
                    fontWeight: 900,
                    background: isPaid ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.16)',
                    color: isPaid ? '#10B981' : muted,
                    border: `1px solid ${isPaid ? 'rgba(16,185,129,0.35)' : border}`,
                  }}
                >
                  {isPaid ? mobileT(lang, 'Paid', 'مدفوعة') : mobileT(lang, 'Free', 'مجانية')}
                </span>
                {left && (
                  <span style={{ fontWeight: 800, color: left.past ? '#ef4444' : '#10B981' }} dir="ltr">
                    {mobileT(lang, 'Left', 'المتبقي')}: {left.text}
                  </span>
                )}
              </div>

              {/* Expiry + first release in GMT */}
              {st.expiry && (
                <div style={{ fontSize: 9.5, color: muted, direction: 'ltr', lineHeight: 1.35 }}>
                  {gmt(st.expiry)}
                  {st.firstRelease ? ` · ${mobileT(lang, 'First', 'أول إفراج')}: ${gmt(st.firstRelease)}` : ''}
                </div>
              )}

              {/* Actions: transactions · ban/unban · delete */}
              <div style={{ display: 'flex', gap: 6, marginTop: 1 }}>
                <button type="button" onClick={() => openTxModal(c)} style={actionBtn('#0284c7', 'rgba(2,132,199,0.12)', 'rgba(2,132,199,0.35)')}>
                  <Receipt size={12} /> {mobileT(lang, 'Tx', 'معاملات')}
                </button>
                <button
                  type="button"
                  onClick={() => { void toggleBan(c); }}
                  disabled={busy === c.id}
                  style={{ ...actionBtn('#d97706', 'rgba(245,158,11,0.12)', 'rgba(245,158,11,0.35)'), opacity: busy === c.id ? 0.55 : 1 }}
                >
                  <ShieldOff size={12} /> {eff === 'banned' ? mobileT(lang, 'Unban', 'إلغاء الحظر') : mobileT(lang, 'Ban', 'حظر')}
                </button>
                <button
                  type="button"
                  onClick={() => { void removeClient(c); }}
                  disabled={busy === c.id}
                  style={{ ...actionBtn('#ef4444', 'rgba(239,68,68,0.12)', 'rgba(239,68,68,0.35)'), opacity: busy === c.id ? 0.55 : 1 }}
                >
                  <Trash2 size={12} /> {mobileT(lang, 'Delete', 'حذف')}
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* ── Transactions sheet ─────────────────────────────────────────────── */}
      {txClient && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          onClick={closeTxModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: `1px solid ${border}`, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Receipt size={18} style={{ color: '#0284c7', flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: text }}>{mobileT(lang, 'Client Transactions', 'معاملات العميل')}</div>
                  <div dir="ltr" style={{ fontSize: 11, fontWeight: 800, color: 'var(--mt5-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txClient.email}</div>
                </div>
              </div>
              <button type="button" onClick={closeTxModal} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${border}`, background: 'transparent', color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: '10px 14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txGrants.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 900, color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                    {mobileT(lang, 'Active Grants', 'المنح النشطة')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {txGrants.map((g) => (
                      <span key={g.id} style={{ padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 800, border: `1px solid ${g.status === 'active' ? 'rgba(16,185,129,0.35)' : border}`, background: g.status === 'active' ? 'rgba(16,185,129,0.14)' : 'rgba(148,163,184,0.12)', color: g.status === 'active' ? '#10B981' : muted }}>
                        {g.kind === 'bot' ? (g.botName || 'Bot') : (g.planLabel || 'Plan')}
                        {g.expiryDate ? ` · ${new Date(g.expiryDate).toLocaleDateString('en-GB')}` : ''}
                        {` · ${g.status}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {txError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: '7px 9px' }}>
                  <AlertTriangle size={13} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 800, color: '#ef4444' }}>{txError}</span>
                  <button type="button" onClick={() => setTxError(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                    <X size={12} />
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: muted }}>
                  {isAr ? `${txRequests.length} معاملة` : `${txRequests.length} transaction(s)`}
                </span>
                {txRequests.length > 0 && (
                  txConfirmDeleteAll ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 900, color: '#ef4444' }}>{mobileT(lang, 'Delete all?', 'حذف الكل؟')}</span>
                      <button type="button" onClick={() => { void handleTxDeleteAll(); }} disabled={txDeleting === 'all'} style={{ padding: '4px 9px', borderRadius: 7, border: 'none', background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 900, cursor: 'pointer', opacity: txDeleting === 'all' ? 0.6 : 1 }}>
                        {mobileT(lang, 'Yes', 'نعم')}
                      </button>
                      <button type="button" onClick={() => setTxConfirmDeleteAll(false)} style={{ padding: '4px 9px', borderRadius: 7, border: `1px solid ${border}`, background: panel, color: text, fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
                        {mobileT(lang, 'Cancel', 'إلغاء')}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setTxConfirmDeleteAll(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
                      <Trash2 size={11} /> {mobileT(lang, 'Delete all', 'حذف الكل')}
                    </button>
                  )
                )}
              </div>

              {txLoading ? (
                <div style={{ padding: '22px 0', textAlign: 'center', color: muted, fontSize: 12 }}>
                  {mobileT(lang, 'Loading…', 'جارٍ التحميل…')}
                </div>
              ) : txRequests.length === 0 ? (
                <div style={{ padding: '22px 0', textAlign: 'center', color: muted, fontSize: 12 }}>
                  <Receipt size={26} style={{ opacity: 0.35, margin: '0 auto 6px' }} />
                  {mobileT(lang, 'No transactions found', 'لا توجد معاملات')}
                </div>
              ) : (
                txRequests.map((r) => {
                  const key = r.id || `r_${r.requestNo}`;
                  const statusColor = r.status === 'approved' ? '#10B981' : r.status === 'rejected' ? '#ef4444' : '#f59e0b';
                  const statusLabel = r.status === 'approved'
                    ? mobileT(lang, 'Approved', 'تم التأكيد')
                    : r.status === 'rejected'
                      ? mobileT(lang, 'Rejected', 'مرفوض')
                      : mobileT(lang, 'Pending', 'قيد التأكيد');
                  return (
                    <div key={key} style={{ background: 'rgba(148,163,184,0.10)', border: `1px solid ${border}`, borderRadius: 11, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 130 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: text }}>
                          {r.kind === 'bot' ? (r.botName || 'Bot') : (r.planLabel || 'Plan')}
                          {r.requestNo ? <span style={{ color: muted, fontWeight: 800 }}> · #{r.requestNo}</span> : null}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: muted, marginTop: 2 }}>
                          ${Number(r.amountUsd || 0).toFixed(2)} USDT{r.method ? ` · ${r.method}` : ''}
                        </div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: muted, marginTop: 2, direction: 'ltr' }}>
                          {r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false }) + ' GMT' : '—'}
                        </div>
                      </div>
                      <span style={{ padding: '2px 7px', borderRadius: 7, fontSize: 9.5, fontWeight: 900, border: `1px solid ${statusColor}55`, background: `${statusColor}22`, color: statusColor }}>
                        {statusLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => r.id && handleTxDeleteOne(r.id)}
                        disabled={txDeleting === r.id || !r.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: 10, fontWeight: 900, cursor: 'pointer', opacity: txDeleting === r.id ? 0.6 : 1 }}
                      >
                        <Trash2 size={11} /> {mobileT(lang, 'Delete', 'حذف')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
