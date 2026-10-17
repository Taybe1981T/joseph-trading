import React, { useState, useEffect } from 'react';
import { Users, ShieldOff, Trash2, RefreshCw, Clock, Crown } from 'lucide-react';
import { Language } from '../../lib/i18n';
import { mobileT } from '../../lib/mobileMode';

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

interface Props {
  lang: Language;
  onClose: () => void;
}

export function MobileClientMonitor({ lang, onClose }: Props) {
  const isAr = lang === 'ar';
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bannedEmails, setBannedEmails] = useState<string[]>([]);

  const loadClients = () => {
    try {
      const raw = localStorage.getItem('finalyze_clients');
      const arr = raw ? JSON.parse(raw) : [];
      setClients(Array.isArray(arr) ? arr : []);
    } catch { setClients([]); }
    try {
      const raw = localStorage.getItem('finalyze_banned_emails');
      const arr = raw ? JSON.parse(raw) : [];
      setBannedEmails(Array.isArray(arr) ? arr : []);
    } catch { setBannedEmails([]); }
  };

  useEffect(() => {
    loadClients();
    window.addEventListener('storage', loadClients);
    return () => window.removeEventListener('storage', loadClients);
  }, []);

  const daysLeft = (expiry: string | null): number => {
    if (!expiry) return 0;
    return Math.ceil((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const toggleBan = async (c: ClientRecord) => {
    setBusy(c.id);
    try {
      const banned = [...bannedEmails];
      const isBanned = banned.includes(c.email);
      if (isBanned) {
        banned.splice(banned.indexOf(c.email), 1);
      } else {
        banned.push(c.email);
      }
      localStorage.setItem('finalyze_banned_emails', JSON.stringify(banned));
      setBannedEmails(banned);
      setClients(clients.map((x) => x.id === c.id ? { ...x, status: isBanned ? 'verified' : 'banned' } : x));
    } finally { setBusy(null); }
  };

  const removeClient = async (c: ClientRecord) => {
    if (!confirm(isAr ? `حذف العميل ${c.email}؟` : `Delete client ${c.email}?`)) return;
    setBusy(c.id);
    try {
      const next = clients.filter((x) => x.id !== c.id);
      localStorage.setItem('finalyze_clients', JSON.stringify(next));
      setClients(next);
    } finally { setBusy(null); }
  };

  return (
    <div className="mt5-trade-overlay" onClick={onClose}>
      <div className="mt5-trade-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
            <Users size={18} style={{ marginRight: 6, color: '#F59E0B' }} />
            {mobileT(lang, 'Client Monitor', 'مراقبة العملاء')}
          </div>
          <button className="mt5-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={load}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #2a2a2a', background: '#0a0a0a', color: '#e0e0e0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <RefreshCw size={14} /> {mobileT(lang, 'Refresh', 'تحديث')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
          {clients.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: 13 }}>
              {mobileT(lang, 'No clients registered yet', 'لا يوجد عملاء مسجلين بعد')}
            </div>
          )}
          {clients.map((c) => {
            const isBanned = c.status === 'banned' || bannedEmails.includes(c.email);
            const isPaid = c.plan === 'paid';
            return (
              <div key={c.id} style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: isPaid ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)', color: isPaid ? '#00ff88' : '#888', border: isPaid ? '1px solid rgba(16,185,129,0.3)' : '1px solid #2a2a2a' }}>
                      {isPaid ? mobileT(lang, 'Paid', 'مدفوع') : mobileT(lang, 'Free', 'مجاني')}
                    </span>
                    <span style={{ color: '#666' }}>{daysLeft(c.planExpiry)}d {mobileT(lang, 'left', 'بقي')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: isBanned ? 'rgba(255,51,51,0.15)' : 'rgba(16,185,129,0.15)', color: isBanned ? '#ff5555' : '#00ff88', border: '1px solid ' + (isBanned ? 'rgba(255,51,51,0.3)' : 'rgba(16,185,129,0.3)') }}>
                    {isBanned ? mobileT(lang, 'Banned', 'محظور') : mobileT(lang, 'Active', 'نشط')}
                  </span>
                  <button onClick={() => toggleBan(c)} disabled={busy === c.id}
                    style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#1a1a1a', color: '#e0e0e0', fontSize: 11, fontWeight: 800, cursor: busy === c.id ? 'wait' : 'pointer', opacity: busy === c.id ? 0.5 : 1 }}>
                    {isBanned ? mobileT(lang, 'Unban', 'إلغاء الحظر') : mobileT(lang, 'Ban', 'حظر')}
                  </button>
                  <button onClick={() => removeClient(c)} disabled={busy === c.id}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,51,51,0.3)', background: 'rgba(255,51,51,0.08)', color: '#ff5555', fontSize: 11, fontWeight: 800, cursor: busy === c.id ? 'wait' : 'pointer', opacity: busy === c.id ? 0.5 : 1 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}