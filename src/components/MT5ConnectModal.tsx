import React, { useState } from 'react';
import { X, Link2, Loader2, ShieldCheck, TestTube, AlertTriangle } from 'lucide-react';
import { Language } from '../lib/i18n';
import { MT5Connection, saveConnection, loadConnection, mt5Bridge } from '../services/mt5Bridge';

interface Props {
  lang: Language;
  onClose: () => void;
  onConnected: (c: MT5Connection) => void;
}

const EMPTY: MT5Connection = { bridgeUrl: '', bridgeSecret: '', login: 0, password: '', server: '', mode: 'demo' };

export default function MT5ConnectModal({ lang, onClose, onConnected }: Props) {
  const isAr = lang === 'ar';
  const [c, setC] = useState<MT5Connection>(() => loadConnection() || EMPTY);
  const [showPass, setShowPass] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (patch: Partial<MT5Connection>) => setC((p) => ({ ...p, ...patch }));

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const h = await mt5Bridge.health(c);
      if (!h.ok) throw new Error(isAr ? 'الجسر لا يستجيب — تأكّد أنه يعمل' : 'Bridge not responding');
      const acc = await mt5Bridge.account(c);
      setMsg({ ok: true, text: isAr
        ? `✅ متصل: ${acc.company} · رصيد ${acc.balance} ${acc.currency} · ${acc.server}`
        : `✅ Connected: ${acc.company} · balance ${acc.balance} ${acc.currency} · ${acc.server}` });
    } catch (e: any) {
      setMsg({ ok: false, text: (isAr ? 'فشل: ' : 'Failed: ') + (e?.message || String(e)) });
    } finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true);
    try { saveConnection(c); onConnected(c); } finally { setSaving(false); }
  };

  const inputCls = 'w-full h-11 rounded-xl bg-black/40 border border-white/15 px-4 text-sm font-bold text-white outline-none focus:border-emerald-500 placeholder:text-white/20';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0e14] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-2">
            <Link2 size={20} className="text-emerald-400" />
            <h2 className="text-lg font-black text-white">{isAr ? 'ربط حساب MetaTrader 5' : 'Connect MetaTrader 5 Account'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 text-white/60"><X size={18} /></button>
        </div>


        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed text-amber-200/80">
              {isAr
                ? 'ابدأ دائماً بحساب تجريبي (Demo). كلمة مرور الوسيط تبقى في متصفّحك وتُرسل للجسر على جهازك فقط عبر HTTPS — لا تُخزَّن في أي قاعدة بيانات.'
                : 'Always start with a Demo account. Your broker password stays in this browser and is sent only to your own bridge over HTTPS — never stored in any database.'}
            </p>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-white/50">{isAr ? 'رابط الجسر (Bridge URL)' : 'Bridge URL'}</label>
            <input className={inputCls} dir="ltr" placeholder="https://xxxx.trycloudflare.com"
              value={c.bridgeUrl} onChange={(e) => set({ bridgeUrl: e.target.value.trim() })} />
            <p className="text-[10px] text-white/40 mt-1">{isAr ? 'من نافذة cloudflared tunnel' : 'From your cloudflared tunnel output'}</p>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-white/50">{isAr ? 'المفتاح السرّي (BRIDGE_SECRET)' : 'Bridge Secret'}</label>
            <input className={inputCls} dir="ltr" placeholder="••••••••"
              value={c.bridgeSecret} onChange={(e) => set({ bridgeSecret: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-black uppercase text-white/50">Login</label>
              <input className={inputCls} dir="ltr" inputMode="numeric" placeholder="12345678"
                value={c.login || ''} onChange={(e) => set({ login: parseInt(e.target.value.replace(/\D/g, '')) || 0 })} />
            </div>
            <div>
              <label className="text-xs font-black uppercase text-white/50">Server</label>
              <input className={inputCls} dir="ltr" placeholder="XMGlobal-Demo"
                value={c.server} onChange={(e) => set({ server: e.target.value.trim() })} />
            </div>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-white/50">{isAr ? 'كلمة مرور الوسيط' : 'Broker Password'}</label>
            <div className="relative">
              <input className={inputCls} dir="ltr" type={showPass ? 'text' : 'password'} placeholder="••••••••"
                value={c.password} onChange={(e) => set({ password: e.target.value })} />
              <button type="button" onClick={() => setShowPass((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-white/10 text-white/60 text-[10px] font-black">
                {showPass ? (isAr ? 'إخفاء' : 'Hide') : (isAr ? 'إظهار' : 'Show')}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-black uppercase text-white/50">{isAr ? 'نوع الحساب' : 'Account Mode'}</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button type="button" onClick={() => set({ mode: 'demo' })}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-black text-sm transition-all ${c.mode === 'demo' ? 'bg-emerald-500/15 border-emerald-400 text-emerald-300' : 'bg-white/5 border-white/10 text-white/50'}`}>
                <TestTube size={15} /> Demo
              </button>
              <button type="button" onClick={() => set({ mode: 'live' })}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-black text-sm transition-all ${c.mode === 'live' ? 'bg-red-500/15 border-red-400 text-red-300' : 'bg-white/5 border-white/10 text-white/50'}`}>
                <ShieldCheck size={15} /> Live
              </button>
            </div>
          </div>

          {msg && (
            <p className={`text-xs font-bold text-center ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-white/10 bg-white/5">
          <button onClick={test} disabled={testing || !c.bridgeUrl || !c.bridgeSecret || !c.login || !c.server}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-sm disabled:opacity-40 active:scale-[0.98] transition-all">
            {testing ? <Loader2 size={16} className="animate-spin" /> : null}
            {isAr ? 'اختبار الاتصال' : 'Test Connection'}
          </button>
          <button onClick={save} disabled={saving || !c.bridgeUrl || !c.bridgeSecret || !c.login || !c.server}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-black font-black text-sm disabled:opacity-40 active:scale-[0.98] transition-all">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
            {isAr ? 'حفظ وربط' : 'Save & Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
