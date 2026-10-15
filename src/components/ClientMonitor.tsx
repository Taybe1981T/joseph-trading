import React, { useState, useEffect } from 'react';
import { Users, ShieldOff, Trash2, RefreshCw, RotateCcw, X, CheckCircle, Clock, Ban, Shield, Crown, Layers, Receipt, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language } from '../lib/i18n';
import { fetchAllPlanGrants, fetchClientTransactionsByEmail, deleteTransaction, PaymentGrant, PaymentRequest } from '../services/paymentRequests';

interface ClientRecord {
  id: string;
  email: string;
  uid: string;
  status: 'verified' | 'pending' | 'banned';
  plan: 'free' | 'paid';
  planExpiry: string | null;
  registeredAt: any;
  rank: number;
}

interface ClientMonitorProps {
  clients: ClientRecord[];
  lang: Language;
  onRefresh: () => void;
  onMergeDuplicates?: () => Promise<{ merged: number; removed: number }>;
  onBan: (clientId: string) => void;
  onDelete: (clientId: string) => void;
  onDeleteByEmail?: (email: string) => void;
  freemiumDisabled?: boolean;
  onFreemiumToggle?: (v: boolean) => void;
  clientLoginRequired?: boolean;
  onClientLoginToggle?: (v: boolean) => void;
  mirrorFreeAllowed?: boolean;
  onMirrorFreeToggle?: (v: boolean) => void;
}

export default function ClientMonitor({ clients, lang, onRefresh, onMergeDuplicates, onBan, onDelete, onDeleteByEmail, freemiumDisabled: externalFreemium, onFreemiumToggle, clientLoginRequired: externalClientLogin, onClientLoginToggle, mirrorFreeAllowed: externalMirrorFree, onMirrorFreeToggle }: ClientMonitorProps) {
  const isAr = lang === 'ar';
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [freemiumDisabled, setFreemiumDisabled] = useState(externalFreemium ?? localStorage.getItem('finalyze_freemium_disabled') === 'true');
  const [clientLoginRequired, setClientLoginRequired] = useState(externalClientLogin ?? localStorage.getItem('finalyze_client_login_required') === 'true');
  const [mirrorFreeAllowed, setMirrorFreeAllowed] = useState<boolean>(externalMirrorFree ?? (() => { try { const v = localStorage.getItem('finalyze_mirror_free_allowed'); return v == null ? true : v !== '0'; } catch { return true; } })());
  const [grants, setGrants] = useState<PaymentGrant[]>([]);

  // ── Client transaction modal ─────────────────────────────────────────────
  const [txClient, setTxClient] = useState<ClientRecord | null>(null);
  const [txRequests, setTxRequests] = useState<PaymentRequest[]>([]);
  const [txGrants, setTxGrants] = useState<PaymentGrant[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txDeleting, setTxDeleting] = useState<string | null>(null);
  const [txConfirmDeleteAll, setTxConfirmDeleteAll] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const openTxModal = async (client: ClientRecord) => {
    setTxClient(client);
    setTxRequests([]);
    setTxGrants([]);
    setTxLoading(true);
    setTxConfirmDeleteAll(false);
    setTxError(null);
    const { requests, grants: g } = await fetchClientTransactionsByEmail(client.email);
    setTxRequests(requests);
    setTxGrants(g);
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
      txRequests.map((r) => r.id ? deleteTransaction(r.id) : Promise.resolve(false))
    );
    const deletedIds = new Set(
      txRequests.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<any>).value === true).map((r) => r.id!)
    );
    setTxRequests((prev) => prev.filter((r) => !deletedIds.has(r.id!)));
    setTxConfirmDeleteAll(false);
    setTxDeleting(null);
    if (results.some((r) => r.status === 'rejected' || (r as PromiseFulfilledResult<any>).value === false)) {
      setTxError(isAr ? 'تعذّر حذف بعض المعاملات' : 'Some transactions could not be deleted');
    }
  };

  useEffect(() => {
    let alive = true;
    fetchAllPlanGrants().then((g) => { if (alive) setGrants(g); }).catch(() => {});
    return () => { alive = false; };
  }, [clients]);

  const daysLeft = (expiry: string | null): number => {
    if (!expiry) return 0;
    return Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  // Every plan date is stored in UTC and shown in GMT, so the developer and the
  // client always read the same instant regardless of their machine's timezone.
  const gmt = (iso: string | null) =>
    iso && isFinite(new Date(iso).getTime())
      ? new Date(iso).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false })
      : '';

  // Re-render once a minute so every countdown in the table stays live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // The crown comes from payment_grants — only the developer can create one,
  // and the plan end is derived from the start instant + duration, so it cannot
  // be faked. Every approved period is kept, so the visible end is the LATEST
  // one (renewals stack) while the first release is the EARLIEST start, which is
  // the date the client first paid for. `clients.planExpiry` stays as a fallback
  // purely for rows written before grants existed; the rules stop a client from
  // raising their own row, so that fallback can no longer be inflated either.
  const planState = (client: ClientRecord): { paid: boolean; expiry: string | null; firstRelease: string | null } => {
    const email = (client.email || '').toLowerCase();
    let expiry: string | null = client.planExpiry || null;
    let firstRelease: string | null = null;
    let hasGrant = false;
    for (const g of grants) {
      if ((g.email || '').toLowerCase() !== email) continue;
      // The release instant the developer stamped on approval: for a renewal it
      // is the moment the previous period ended, so the earliest one is the
      // client's true first release.
      const start = g.activatedAt || null;
      if (start && (!firstRelease || new Date(start).getTime() < new Date(firstRelease).getTime())) firstRelease = start;
      if (!g.expiryDate) continue;
      hasGrant = true;
      if (!expiry || new Date(g.expiryDate).getTime() > new Date(expiry).getTime()) expiry = g.expiryDate;
    }
    const running = (!!expiry && daysLeft(expiry) > 0) && (hasGrant || client.plan === 'paid');
    return { paid: running, expiry, firstRelease };
  };

  // A client counts as "running a paid plan" only when a real, unexpired
  // entitlement exists. An expired plan, or an email that registered manually
  // without buying anything, never gets the crown.
  const hasRunningPlan = (client: ClientRecord): boolean => planState(client).paid;

  // Repairs rows written with a random id before the email-keyed ids: the same
  // customer used to appear twice in this table. Confirmation first — it deletes
  // the redundant copies after their data has been copied onto the real one.
  const runMerge = async () => {
    if (!onMergeDuplicates || merging) return;
    const ok = window.confirm(
      isAr
        ? 'سيتم دمج السجلات المكررة لنفس الإيميل ثم حذف النسخ الزائدة. متابعة؟'
        : 'Duplicate rows for the same email will be merged into one, then the extras deleted. Continue?'
    );
    if (!ok) return;
    setMerging(true);
    setMergeMsg(null);
    try {
      const r = await onMergeDuplicates();
      setMergeMsg(
        isAr
          ? `تم الدمج: ${r.merged} إيميل — وحُذف ${r.removed} سجل مكرر`
          : `Merged ${r.merged} email(s), removed ${r.removed} duplicate row(s)`
      );
    } catch {
      setMergeMsg(isAr ? 'تعذّر الدمج' : 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-primary" />
          <h2 className="text-xl font-black text-brand-text">
            {isAr ? 'مراقبة العملاء' : 'Client Monitor'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {onMergeDuplicates && (
            <button
              onClick={runMerge}
              disabled={merging}
              title={isAr ? 'دمج السجلات المكررة لنفس الإيميل' : 'Merge duplicate rows for the same email'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              <Layers size={14} className={merging ? 'animate-spin' : ''} />
              {merging ? (isAr ? 'جارٍ الدمج…' : 'Merging…') : (isAr ? 'دمج التكرار' : 'Merge')}
            </button>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 text-xs font-black uppercase tracking-widest transition-all"
          >
            <RefreshCw size={14} />
            {isAr ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      {mergeMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-bold">
          <CheckCircle size={15} />
          {mergeMsg}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: isAr ? 'إجمالي' : 'Total', value: clients.length, color: 'text-white' },
          { label: isAr ? 'مفعل' : 'Verified', value: clients.filter(c => c.status === 'verified').length, color: 'text-emerald-400' },
          { label: isAr ? 'قيد الانتظار' : 'Pending', value: clients.filter(c => c.status === 'pending').length, color: 'text-amber-400' },
          { label: isAr ? 'محظور' : 'Banned', value: clients.filter(c => c.status === 'banned').length, color: 'text-red-400' },
        ].map((stat, i) => (
          <div key={i} className="bg-brand-alt rounded-2xl p-4 border border-white/10 text-center">
            <div className={`text-3xl font-black ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-white/80 font-bold tracking-wider mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Client Login Required Toggle */}
      <div className="bg-brand-alt rounded-2xl p-4 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {clientLoginRequired ? <Users size={20} className="text-amber-400" /> : <Users size={20} className="text-emerald-400" />}
          <div>
            <span className="text-sm font-bold text-white">
              {isAr ? 'تسجيل دخول العملاء' : 'Client Login Required'}
            </span>
            <p className="text-xs text-white/60 mt-0.5">
              {clientLoginRequired
                ? (isAr ? 'العملاء يجب عليهم تسجيل الدخول عبر Google' : 'Clients must sign in with Google')
                : (isAr ? 'العملاء يدخلون مباشرة بدون تسجيل دخول' : 'Clients enter directly without login')}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            const newVal = !clientLoginRequired;
            setClientLoginRequired(newVal);
            localStorage.setItem('finalyze_client_login_required', newVal ? 'true' : 'false');
            onClientLoginToggle?.(newVal);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            clientLoginRequired
              ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
          }`}
        >
          {clientLoginRequired ? (isAr ? 'ON: مطلوب تسجيل' : 'ON: Login Required') : (isAr ? 'OFF: بدون تسجيل' : 'OFF: No Login')}
        </button>
      </div>

      {/* Free-client Mirror Toggle (developer-side kill-switch written to
          Firestore config/mirror so it applies to every free client at once;
          local preview override available) */}
      <div className="bg-brand-alt rounded-2xl p-4 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers size={20} className={mirrorFreeAllowed ? 'text-emerald-400' : 'text-amber-400'} />
          <div>
            <span className="text-sm font-bold text-white">
              {isAr ? 'نسخ للعملاء المجانيين' : 'Mirror Free Clients'}
            </span>
            <p className="text-xs text-white/60 mt-0.5">
              {mirrorFreeAllowed
                ? (isAr ? 'العملاء المجانيون يرآون إشارات المطور ويفتتونها' : 'Free clients receive and follow the developer\'s signals')
                : (isAr ? 'العملاء المجانيون لا يرآون النسخ' : 'Free clients do NOT mirror (subscribers only)')}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            const newVal = !mirrorFreeAllowed;
            setMirrorFreeAllowed(newVal);
            localStorage.setItem('finalyze_mirror_free_allowed', newVal ? '1' : '0');
            onMirrorFreeToggle?.(newVal);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
            mirrorFreeAllowed
              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
          }`}
        >
          {mirrorFreeAllowed ? (isAr ? 'مفعل' : 'ON') : (isAr ? 'معطّل' : 'OFF')}
        </button>
      </div>

      {/* Client Table */}
      {clients.length === 0 ? (
        <div className="bg-brand-alt rounded-2xl p-10 border border-white/10 text-center">
          <Users size={48} className="text-white/20 mx-auto mb-4" />
          <p className="text-base text-white/60 font-bold">
            {isAr ? 'لا يوجد عملاء مسجلين بعد' : 'No clients registered yet'}
          </p>
        </div>
      ) : (
        <div className="bg-brand-alt rounded-2xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ direction: isAr ? 'rtl' : 'ltr' }}>
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'الرتبة' : 'Rank'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'البريد الإلكتروني' : 'Email'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'تاريخ التسجيل' : 'Registered'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'الخطة' : 'Plan'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'المتبقي' : 'Left'}</th>
                  <th className="text-left px-4 py-3 text-xs text-white/60 font-bold uppercase tracking-wider">{isAr ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-bold text-white">#{client.rank}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sky-300 font-bold text-shadow-glow">{client.email}</span>
                        {/* Crown: ONLY for a client whose paid plan is running right
                            now (paid + a future expiry). Disappears when the plan
                            expires or is deleted, and never shows for an email that
                            only signed up manually without buying a plan. */}
                        {hasRunningPlan(client) && (
                          <span
                            title={isAr ? 'خطة مدفوعة سارية الآن' : 'Paid plan currently active'}
                            className="inline-flex items-center justify-center shrink-0"
                          >
                            <Crown size={15} className="text-amber-400" fill="currentColor" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-white/60 font-bold">
                        {client.registeredAt
                          ? (typeof client.registeredAt === 'object' && client.registeredAt?.toDate
                            ? client.registeredAt.toDate().toLocaleDateString()
                            : new Date(client.registeredAt).toLocaleDateString())
                          : '--'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {client.status === 'verified' ? (
                          <CheckCircle size={14} className="text-emerald-400" />
                        ) : client.status === 'banned' ? (
                          <Ban size={14} className="text-red-400" />
                        ) : (
                          <Clock size={14} className="text-amber-400" />
                        )}
                        <span className={`text-xs font-bold ${
                          client.status === 'verified' ? 'text-emerald-400' :
                          client.status === 'banned' ? 'text-red-400' : 'text-amber-400'
                        }`}>
                          {client.status === 'verified' ? (isAr ? 'مفعل' : 'Verified') :
                           client.status === 'banned' ? (isAr ? 'محظور' : 'Banned') :
                           (isAr ? 'قيد الانتظار' : 'Pending')}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 w-fit ${
                        planState(client).paid
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-white/5 text-white/70'
                      }`}>
                        {planState(client).paid && <Crown size={12} />}
                        {planState(client).paid ? (isAr ? 'مدفوعة' : 'Paid') : (isAr ? 'مجانية' : 'Free')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const st = planState(client);
                        if (!st.expiry) return <span className="text-sm text-white/50">--</span>;
                        const end = new Date(st.expiry).getTime();
                        const left = end - now;
                        const past = left <= 0;
                        const abs = Math.abs(left);
                        const d = Math.floor(abs / 86400000);
                        const h = Math.floor((abs % 86400000) / 3600000);
                        const m = Math.floor((abs % 3600000) / 60000);
                        return (
                          <div className="space-y-1">
                            <div className={`text-xs font-black ${past ? 'text-red-400' : 'text-emerald-400'}`} dir="ltr">
                              {past
                                ? (isAr ? 'انتهت' : 'Ended')
                                : `${d}${isAr ? 'ي' : 'd'} ${String(h).padStart(2, '0')}${isAr ? 'س' : 'h'} ${String(m).padStart(2, '0')}${isAr ? 'د' : 'm'}`}
                            </div>
                            <div className="text-[10px] text-white/45 leading-tight" dir="ltr">
                              {gmt(st.expiry)}
                            </div>
                            {st.firstRelease && (
                              <div className="text-[10px] text-sky-300/70 leading-tight" dir="ltr">
                                {isAr ? 'أول إفراج: ' : 'First: '}{gmt(st.firstRelease)}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openTxModal(client)}
                          className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                          title={isAr ? 'عرض المعاملات' : 'View Transactions'}
                        >
                          <Receipt size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm(isAr ? 'حظر هذا العميل؟' : 'Ban this client?')) onBan(client.id); }}
                          className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                          title={isAr ? 'حظر' : 'Ban'}
                        >
                          <ShieldOff size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm(isAr ? 'حذف هذا العميل؟' : 'Delete this client?')) { if (onDeleteByEmail) onDeleteByEmail(client.email); else onDelete(client.id); } }}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          title={isAr ? 'حذف' : 'Delete'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Client Transactions Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {txClient && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeTxModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0f1117] rounded-3xl border border-white/10 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-3">
                  <Receipt size={20} className="text-sky-400" />
                  <div>
                    <h3 className="text-base font-black text-white">
                      {isAr ? 'معاملات العميل' : 'Client Transactions'}
                    </h3>
                    <p className="text-xs text-sky-300 font-bold truncate max-w-xs">{txClient.email}</p>
                  </div>
                </div>
                <button onClick={closeTxModal} className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all">
                  <X size={18} />
                </button>
              </div>

              {/* Grants summary */}
              {txGrants.length > 0 && (
                <div className="px-6 pt-4 shrink-0">
                  <p className="text-xs font-black uppercase tracking-wider text-white/40 mb-2">
                    {isAr ? 'المنح النشطة' : 'Active Grants'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {txGrants.map((g) => (
                      <span key={g.id} className={`px-3 py-1.5 rounded-xl text-xs font-black border ${g.status === 'active' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-white/40 border-white/10'}`}>
                        {g.kind === 'bot' ? (g.botName || 'Bot') : (g.planLabel || 'Plan')}
                        {g.expiryDate ? ` · ${new Date(g.expiryDate).toLocaleDateString('en-GB')}` : ''}
                        {` · ${g.status}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Error banner */}
              {txError && (
                <div className="mx-6 mt-3 flex items-center gap-2 bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-2.5 shrink-0">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <span className="text-xs font-bold text-red-400 flex-1">{txError}</span>
                  <button onClick={() => setTxError(null)} className="text-red-400/60 hover:text-red-400"><X size={13} /></button>
                </div>
              )}

              {/* Delete-all toolbar */}
              <div className="px-6 pt-3 shrink-0 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-white/40 font-bold">
                  {isAr ? `${txRequests.length} معاملة` : `${txRequests.length} transaction(s)`}
                </p>
                {txRequests.length > 0 && (
                  txConfirmDeleteAll ? (
                    <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/40 rounded-xl px-3 py-2">
                      <AlertTriangle size={14} className="text-red-400" />
                      <span className="text-xs font-black text-red-400">{isAr ? 'حذف كل المعاملات؟' : 'Delete all transactions?'}</span>
                      <button
                        onClick={handleTxDeleteAll}
                        disabled={txDeleting === 'all'}
                        className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-black hover:bg-red-600 transition-all disabled:opacity-50"
                      >
                        {txDeleting === 'all' ? (isAr ? 'جاري...' : 'Deleting...') : (isAr ? 'نعم' : 'Yes')}
                      </button>
                      <button onClick={() => setTxConfirmDeleteAll(false)} className="bg-white/10 text-white px-3 py-1 rounded-lg text-xs font-black hover:bg-white/20 transition-all">
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setTxConfirmDeleteAll(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25 text-xs font-black uppercase tracking-wider transition-all"
                    >
                      <Trash2 size={13} />
                      {isAr ? 'حذف كل المعاملات' : 'Delete all transactions'}
                    </button>
                  )
                )}
              </div>

              {/* Transactions list */}
              <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
                {txLoading ? (
                  <div className="py-10 text-center">
                    <div className="w-7 h-7 border-b-2 border-sky-400 rounded-full animate-spin mx-auto" />
                    <p className="text-white/40 text-sm mt-3">{isAr ? 'جاري التحميل...' : 'Loading...'}</p>
                  </div>
                ) : txRequests.length === 0 ? (
                  <div className="py-10 text-center">
                    <Receipt size={32} className="text-white/20 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">{isAr ? 'لا توجد معاملات' : 'No transactions found'}</p>
                  </div>
                ) : (
                  txRequests.map((r) => {
                    const statusColors: Record<string, string> = {
                      pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                      approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                      rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
                    };
                    const statusLabels: Record<string, string> = {
                      pending: isAr ? 'قيد التأكيد' : 'Pending',
                      approved: isAr ? 'تم التأكيد' : 'Approved',
                      rejected: isAr ? 'مرفوض' : 'Rejected',
                    };
                    const key = r.id || `r_${r.requestNo}`;
                    return (
                      <div key={key} className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-white truncate">
                            {r.kind === 'bot' ? (r.botName || 'Bot') : (r.planLabel || 'Plan')}
                            {r.requestNo ? <span className="text-white/40 font-bold"> · #{r.requestNo}</span> : null}
                          </p>
                          <p className="text-xs text-slate-300 font-bold mt-0.5">
                            ${Number(r.amountUsd || 0).toFixed(2)} USDT
                            {r.method ? ` · ${r.method}` : ''}
                          </p>
                          <p className="text-[11px] text-white/40 font-bold mt-1 flex items-center gap-1">
                            <Clock size={11} />
                            {r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false }) + ' GMT' : '—'}
                          </p>
                        </div>
                        <span className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase border ${statusColors[r.status] || 'bg-white/5 text-white/40 border-white/10'}`}>
                          {statusLabels[r.status] || r.status}
                        </span>
                        <button
                          onClick={() => r.id && handleTxDeleteOne(r.id)}
                          disabled={txDeleting === r.id || !r.id}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25 text-xs font-black uppercase transition-all disabled:opacity-50"
                        >
                          {txDeleting === r.id ? (
                            <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          {isAr ? 'حذف' : 'Delete'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
