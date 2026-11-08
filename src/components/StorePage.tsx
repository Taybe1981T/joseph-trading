import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, FileText, ChevronDown, ChevronUp, Bot, Activity, Crown, Package, Download, Gift, Sparkles, ArrowLeft, Code2, LayoutTemplate, Image, PenTool, Monitor, Cpu, BarChart3, Send, Check, KeyRound, Zap, Trash2, AlertTriangle, X } from 'lucide-react';
import { StoreBot, StoreCategory, fetchStoreBots, formatFileSize, isFree, categoryOf, typeOf, typeLabelForCat, typesForCategory, STORE_CATEGORIES, downloadBot, getDownloadGrant, consumeBotDownload, DOWNLOAD_GRANT_TTL_MS } from '../services/storeService';
import { generateBotBanner } from '../services/storeBanner';
import { submitSiteRequest } from '../services/paymentRequests';
import { StorePlan, fetchPlans, planLabel, planFeatures, durationLabel, toWesternDigits } from '../services/storePlans';

interface StorePageProps {
  lang: 'ar' | 'en';
  onBack: () => void;
  isDark: boolean;
  onBuyBot: (bot: StoreBot) => void;
  onBuyPlan?: (plan: StorePlan) => void;
  userName?: string;
  userEmail?: string;
  customerPlan?: { label: string; amount: number; expiryDate: string } | null;
  planKeyEntered?: boolean;
  paidMode?: boolean;
  onCustomerEnterKey?: () => void;
  onCustomerUseFree?: () => void;
  onCustomerUsePaid?: () => void;
  onCustomerDeletePlan?: () => void;
}

const MAX_DESC_LEN = 55;

type IconType = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number | string }>;

const TILE_ICONS: Record<StoreCategory, IconType> = {
  bot: Bot,
  indicator: Activity,
  plan: Crown,
  other: Package,
};

const TYPE_ICONS: Record<string, IconType> = {
  mt5: Monitor,
  tradingview: BarChart3,
  ctrader: Cpu,
  template: LayoutTemplate,
  banner: Image,
  logo: PenTool,
};

function catLabel(isAr: boolean, key: StoreCategory): string {
  const c = STORE_CATEGORIES.find((x) => x.key === key);
  return isAr ? (c?.labelAr || '') : (c?.labelEn || '');
}

export default function StorePage({ lang, onBack, isDark, onBuyBot, onBuyPlan, userName, userEmail, customerPlan, planKeyEntered = false, paidMode = true, onCustomerEnterKey, onCustomerUseFree, onCustomerUsePaid, onCustomerDeletePlan }: StorePageProps) {
  const isAr = lang === 'ar';
  const [bots, setBots] = useState<StoreBot[]>([]);
  const [plans, setPlans] = useState<StorePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<StoreCategory | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [downloadMsg, setDownloadMsg] = useState<{ botId: string; text: string } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [reqName, setReqName] = useState(userName || '');
  const [reqContact, setReqContact] = useState(userEmail || '');
  const [reqMessage, setReqMessage] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [reqDone, setReqDone] = useState(false);
  const [reqErr, setReqErr] = useState('');
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchStoreBots().then((list) => { setBots(list); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchPlans().then((list) => { try { setPlans(list); } catch {} });
  }, []);

  const formatPrice = (price: number) => `$${(price / 100).toFixed(2)}`;

  const pageTitle = 'text-white';
  const pageSub = 'text-slate-400';

  const counts = useMemo(() => {
    const out: Record<StoreCategory, { free: number; paid: number }> = { bot: { free: 0, paid: 0 }, indicator: { free: 0, paid: 0 }, plan: { free: 0, paid: 0 }, other: { free: 0, paid: 0 } };
    for (const b of bots) {
      const c = categoryOf(b);
      if (isFree(b)) out[c].free++;
      else out[c].paid++;
    }
    return out;
  }, [bots]);

  const typeCounts = useMemo(() => {
    const out: Record<string, { free: number; paid: number }> = {};
    if (!activeCat) return out;
    for (const t of typesForCategory(activeCat)) out[t.key] = { free: 0, paid: 0 };
    for (const b of bots) {
      if (categoryOf(b) !== activeCat) continue;
      const k = typeOf(b);
      if (!(k in out)) continue;
      if (isFree(b)) out[k].free++;
      else out[k].paid++;
    }
    return out;
  }, [bots, activeCat]);

  const handleProductAction = (bot: StoreBot) => {
    setDownloadMsg(null);
    // No product (free or paid) may be obtained unless the visitor is signed in
    // with a registered account. A guest stays on the free plan only.
    if (!userEmail) {
      setDownloadMsg({ botId: bot.id || '', text: isAr ? '⚠ سجّل دخولك أولاً لتحميل/شراء أي منتج' : '⚠ Sign in first to download or buy any product' });
      setTimeout(() => setDownloadMsg(null), 3000);
      return;
    }
    if (isFree(bot)) {
      downloadBot(bot);
      setDownloadMsg({ botId: bot.id || '', text: isAr ? '✓ جاري تحميل الملف المجاني' : '✓ Downloading the free file' });
      setTimeout(() => setDownloadMsg(null), 3000);
      return;
    }
    onBuyBot(bot);
  };

  const handleGrantedDownload = (bot: StoreBot) => {
    if (!userEmail) {
      setDownloadMsg({ botId: bot.id || '', text: isAr ? '⚠ سجّل دخولك أولاً لتحميل أي منتج' : '⚠ Sign in first to download any product' });
      setTimeout(() => setDownloadMsg(null), 3000);
      return;
    }
    setDownloadMsg(null);
    downloadBot(bot);
    consumeBotDownload(bot.id || '');
    setDownloadMsg({ botId: bot.id || '', text: isAr ? '✓ تم تنزيل المنتج على سطح مكتبك' : '✓ Product downloaded to your desktop' });
    setTimeout(() => setDownloadMsg(null), 3000);
  };

  const goBackLevel = () => {
    if (showRequest) { setShowRequest(false); return; }
    if (activeType) { setActiveType(null); return; }
    if (activeCat) { setActiveCat(null); return; }
  };

  const activePlans = plans.filter((p) => p.active);

  const renderCustomerPlan = () => {
    if (!customerPlan) return null;
    const expiryMs = new Date(customerPlan.expiryDate).getTime();
    const hasPeriod = !!(customerPlan.expiryDate && isFinite(expiryMs));
    const daysLeft = hasPeriod ? Math.max(0, Math.ceil((expiryMs - Date.now()) / (1000 * 60 * 60 * 24))) : 0;
    const expired = hasPeriod && expiryMs <= Date.now();
    const waitingKey = !planKeyEntered;
    const status = waitingKey
      ? (isAr ? 'قيد انتظار المفتاح' : 'Awaiting Key')
      : paidMode
        ? (isAr ? 'مفعّلة' : 'Active')
        : (isAr ? 'الخطة محفوظة — وضع مجاني' : 'Saved — Free Mode');
    const statusCls = waitingKey
      ? 'text-amber-400 bg-amber-500/10 border-amber-500/40 animate-pulse'
      : paidMode
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/40'
        : 'text-slate-300 bg-white/5 border-white/15';
    return (
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4 mt-2">
          <span className="px-3 py-1.5 rounded-xl border-2 text-base sm:text-lg font-black uppercase tracking-wide whitespace-nowrap bg-amber-500/10 border-amber-500/50 text-amber-400 flex items-center gap-2">
            <Crown size={18} />
            {isAr ? 'خطتك' : 'Your Plan'}
          </span>
          <div className={`flex-1 h-[3px] rounded-full ${isDark ? 'bg-black/15' : 'bg-white/20'}`} />
        </div>
        <div className="relative bg-gradient-to-b from-amber-500/10 to-transparent border border-amber-500/30 rounded-3xl p-5 sm:p-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg keep-white">
                <Crown size={22} />
              </div>
              <div>
                <h4 className="text-lg font-black text-white uppercase tracking-wider leading-none">{customerPlan.label}</h4>
                <p className="text-xs text-slate-400 mt-1.5">
                  {hasPeriod ? (
                    <>
                      <span dir="ltr">{expired ? '—' : new Date(customerPlan.expiryDate).toLocaleString('en-GB', { timeZone: 'GMT', hour12: false })}</span>
                      {!expired && <span className="mx-1.5">·</span>}
                      {expired ? (isAr ? 'انتهت المدة' : 'Expired') : `${daysLeft} ${isAr ? 'يوم متبقي' : 'days left'}`}
                    </>
                  ) : (
                    <span className="text-amber-400">{isAr ? 'لم تبدأ بعد — تبدأ عند وضع المفتاح والبدء بالعمل' : 'Not started yet — starts when you add the key and begin'}</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between sm:flex-col sm:items-end gap-3">
              <span className={`px-3 py-1.5 rounded-xl border text-xs font-black uppercase tracking-widest ${statusCls}`}>{status}</span>
              <span className="text-2xl font-black text-amber-400">${Number(customerPlan.amount).toFixed(2)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            {waitingKey && (
              <button
                onClick={onCustomerEnterKey}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all shadow-lg bg-gradient-to-r from-amber-500 to-[#F59E0B] text-black hover:opacity-90 active:scale-95 flex items-center gap-2"
              >
                <KeyRound size={16} />
                {isAr ? 'إدخال المفتاح وتفعيل الخطة' : 'Enter Key & Activate'}
              </button>
            )}
            {!waitingKey && !paidMode && (
              <button
                onClick={onCustomerUsePaid}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all shadow-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:opacity-90 active:scale-95 flex items-center gap-2"
              >
                <Zap size={16} />
                {isAr ? 'تفعيل الخطة المدفوعة الآن' : 'Activate Paid Plan Now'}
              </button>
            )}
            {!waitingKey && paidMode && (
              <button
                onClick={onCustomerUseFree}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 active:scale-95"
              >
                {isAr ? 'الرجوع للخطة المجانية' : 'Return to Free Plan'}
              </button>
            )}
            {onCustomerDeletePlan && (
              <button
                onClick={() => setConfirmDeletePlan(true)}
                className="px-5 py-3 rounded-2xl font-black text-sm transition-all bg-red-500/10 border border-red-500/40 text-red-400 hover:bg-red-500/20 active:scale-95 flex items-center gap-2"
              >
                <Trash2 size={16} />
                {isAr ? 'حذف الخطة' : 'Delete Plan'}
              </button>
            )}
          </div>
        </div>

        {confirmDeletePlan && (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-gray-900 border border-red-500/40 rounded-3xl shadow-2xl p-6">
              <div className="flex flex-col items-center text-center mb-4">
                <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/40 flex items-center justify-center mb-3">
                  <AlertTriangle size={26} className="text-red-400" />
                </div>
                <h3 className="text-lg font-black text-white">{isAr ? 'تأكيد حذف الخطة' : 'Confirm Plan Deletion'}</h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  {isAr
                    ? 'سيتم إلغاء خطتك المدفوعة نهائياً والعودة للمجاني. لا يمكن التراجع عن هذا الإجراء.'
                    : 'Your paid plan will be cancelled permanently and you will return to free. This cannot be undone.'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmDeletePlan(false)}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-xs font-black transition-all"
                >
                  <X size={14} />
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  onClick={() => { setConfirmDeletePlan(false); onCustomerDeletePlan?.(); }}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-xs font-black hover:bg-red-400 transition-all"
                >
                  <Trash2 size={14} />
                  {isAr ? 'حذف الخطة' : 'Delete Plan'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPlanBoxes = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-7">
      {activePlans.map((plan) => {
          const feats = planFeatures(plan, isAr);
          const badge = isAr ? plan.badgeAr : plan.badgeEn;
          return (
            <div
              key={plan.id || plan.key}
              className="relative bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col transition-all hover:-translate-y-1 hover:shadow-xl overflow-hidden"
            >
              {badge ? (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F59E0B] text-black text-[10px] font-black uppercase tracking-widest px-4 py-1 rounded-full shadow-lg whitespace-nowrap max-w-[90%] truncate">
                  {badge}
                </div>
              ) : null}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg keep-white">
                  <Crown size={22} />
                </div>
                <div>
                  <h4 className="text-lg font-black text-white uppercase tracking-wider leading-none">{planLabel(plan, isAr)}</h4>
                  <p className="text-xs text-slate-400 mt-1">{isAr ? `مدة ${durationLabel(plan, isAr)}` : durationLabel(plan, isAr)}</p>
                </div>
              </div>
              <div className="mb-4">
                <span className="text-4xl font-black text-white font-mono tabular-nums" dir="ltr">${Number(toWesternDigits(plan.priceUsd)).toFixed(2)}</span>
                <span className="text-sm text-slate-400 ml-1">/ {isAr ? 'الخطة' : 'plan'}</span>
              </div>
              {/* Features shown BEFORE purchase */}
              {feats.length > 0 && (
                <div className="bg-black/25 border border-white/10 rounded-2xl p-4 mb-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{isAr ? 'مميزات الخطة' : 'Plan Features'}</p>
                  <ul className="space-y-2">
                    {feats.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
                        <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                        <span className="leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={() => {
                  if (!userEmail) {
                    setDownloadMsg({ botId: '', text: isAr ? '⚠ سجّل دخولك أولاً لشراء أي خطة' : '⚠ Sign in first to buy any plan' });
                    setTimeout(() => setDownloadMsg(null), 3000);
                    return;
                  }
                  onBuyPlan?.(plan);
                }}
                className="mt-auto w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg bg-gradient-to-r from-amber-500 to-[#F59E0B] text-black hover:opacity-90 active:scale-95"
              >
                {isAr ? `اشتراك $${Number(toWesternDigits(plan.priceUsd)).toFixed(2)}` : `Subscribe $${Number(toWesternDigits(plan.priceUsd)).toFixed(2)}`}
              </button>
            </div>
          );
        })}
      </div>
  );

  const levelBack = () => (
    <button
      onClick={goBackLevel}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:text-white text-xs font-black uppercase tracking-wider transition-all mb-4"
    >
      <ArrowLeft size={14} />
      {isAr ? 'رجوع' : 'Back'}
    </button>
  );

  const renderCard = (bot: StoreBot) => {
    const desc = isAr ? (bot.descriptionAr || bot.description) : (bot.descriptionEn || bot.description);
    const needToggle = desc.length > MAX_DESC_LEN;
    const isOpen = !!expanded[bot.id ?? ''];
    const shown = isOpen || !needToggle ? desc : desc.slice(0, MAX_DESC_LEN) + '…';
    const free = isFree(bot);
    const grantTs = free ? null : getDownloadGrant(bot.id ?? '');
    const granted = grantTs !== null;
    const remainingMs = grantTs ? Math.max(0, DOWNLOAD_GRANT_TTL_MS - (nowTick - grantTs)) : 0;
    const mm = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
    const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');
    const showMsg = downloadMsg?.botId === bot.id;
    const typeLabelTxt = typeLabelForCat(categoryOf(bot), typeOf(bot), isAr);
    const imgSrc = bot.imageData || generateBotBanner(bot);
    // Solid brand-colored boxes (no product image): green = free, blue = paid
    const accent = free
      ? {
          card: 'bg-gradient-to-br from-emerald-400 to-emerald-700 border-emerald-300/50 shadow-emerald-600/40',
          box: 'bg-white/20',
          title: 'text-white',
          sub: 'text-emerald-50',
          body: 'text-emerald-50',
          link: 'text-white underline decoration-emerald-200/60 hover:decoration-white',
          pill: 'bg-white text-emerald-700 border-white',
          btn: 'bg-white text-emerald-600 hover:bg-emerald-50 shadow-black/20',
        }
      : {
          card: 'bg-gradient-to-br from-sky-400 to-blue-700 border-sky-300/50 shadow-blue-600/40',
          box: 'bg-white/20',
          title: 'text-white',
          sub: 'text-sky-50',
          body: 'text-sky-50',
          link: 'text-white underline decoration-sky-200/60 hover:decoration-white',
          pill: 'bg-white text-sky-700 border-white',
          btn: 'bg-white text-sky-600 hover:bg-sky-50 shadow-black/20',
        };
    return (
      <motion.div
        key={bot.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`${accent.card} border rounded-xl overflow-hidden transition-all shadow-lg hover:scale-[1.02]`}
      >
        <div className="flex flex-col">
          {imgSrc && (
            <img
              src={imgSrc}
              alt={bot.name}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              className="w-full h-auto block"
            />
          )}
          <div className="flex-1 flex flex-col gap-2.5 p-3 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center keep-white ${accent.box}`}>
                  {free ? <Gift size={18} /> : <ShoppingCart size={18} />}
                </div>
                <div className="min-w-0">
                  <h3 className={`text-sm font-black truncate keep-white ${accent.title}`}>{bot.name}</h3>
                  {(typeLabelTxt || bot.fileName) && (
                    <span className={`text-[9px] flex items-center gap-1 mt-0.5 keep-white ${accent.sub}`}>
                      <FileText size={9} /> {typeLabelTxt ? `${typeLabelTxt} • ` : ''}{bot.fileName} {bot.fileSize ? `(${formatFileSize(bot.fileSize)})` : ''}
                    </span>
                  )}
                </div>
              </div>
              <span className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-black uppercase border-2 ${accent.pill}`}>
                {free ? (isAr ? 'مجاني' : 'Free') : formatPrice(bot.price)}
              </span>
            </div>

            {bot.description && (
              <div>
                <p className={`text-xs leading-relaxed break-words font-medium keep-white ${accent.body}`}>{shown}</p>
                {needToggle && (
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [bot.id ?? '']: !isOpen }))}
                    className={`mt-0.5 flex items-center gap-0.5 text-[10px] font-black uppercase tracking-wide transition-all keep-white ${accent.link}`}
                  >
                    {isOpen ? (isAr ? 'عرض أقل' : 'Read Less') : (isAr ? 'اقرأ المزيد' : 'Read More')}
                    {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  </button>
                )}
              </div>
            )}

            {showMsg && (
              <p className="text-[11px] font-black text-center keep-white bg-black/30 rounded-lg py-1 px-2">{downloadMsg?.text}</p>
            )}

            {granted && (
              <p className="text-[11px] font-black text-center keep-white">
                {isAr ? `التحميل متاح خلال ${mm}:${ss}` : `Download available for ${mm}:${ss}`}
              </p>
            )}

            <button
              onClick={() => (granted ? handleGrantedDownload(bot) : handleProductAction(bot))}
              className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg font-black text-xs uppercase tracking-wider shadow-md active:scale-95 transition-all ${accent.btn}`}
            >
              {granted ? <Download size={14} /> : free ? <Gift size={14} /> : <ShoppingCart size={14} />}
              {granted ? (isAr ? 'تحميل الآن' : 'Download Now')
                : free ? (isAr ? 'تحميل مجاني' : 'Download Free')
                  : (isAr ? 'اشترِ الآن' : 'Buy Now')}
            </button>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderStack = (list: StoreBot[], free: boolean, cat: StoreCategory, typeKey?: string) => {
    const catBots = list.filter((b) => isFree(b) === free);
    const base = typeKey ? (typeLabelForCat(cat, typeKey, isAr) || catLabel(isAr, cat)) : catLabel(isAr, cat);
    const title = isAr ? `${base} ${free ? 'مجانية' : 'مدفوعة'}` : `${free ? 'Free' : 'Paid'} ${base}`;
    const empty = isAr
      ? (free ? `لا توجد ${base} مجانية هنا بعد` : `لا توجد ${base} مدفوعة هنا بعد`)
      : (free ? `No free ${base.toLowerCase()} here yet` : `No paid ${base.toLowerCase()} here yet`);
    return (
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4 mt-2">
          <span className={`px-3 py-1.5 rounded-xl border-2 text-base sm:text-lg font-black uppercase tracking-wide whitespace-nowrap ${free ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500' : 'bg-sky-500/10 border-sky-500/50 text-sky-500'}`}>
            {title}
          </span>
          <div className={`flex-1 h-[3px] rounded-full ${isDark ? 'bg-black/15' : 'bg-white/20'}`} />
          <span className={`px-2.5 py-1 rounded-lg text-sm font-black ${pageSub}`}>{catBots.length}</span>
        </div>
        {catBots.length === 0 ? (
          <p className={`text-sm font-bold text-center py-6 ${pageSub}`}>{empty}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-7">
            <AnimatePresence>{catBots.map((bot) => renderCard(bot))}</AnimatePresence>
          </div>
        )}
      </div>
    );
  };

  const sectionDivider = () => (
    <div className="flex items-center gap-3 my-7 px-1">
      <div className="flex-1 h-1 rounded-full bg-gradient-to-r from-transparent via-[#F59E0B]/80 to-[#F59E0B]" />
      <div className="w-4 h-4 rotate-45 border-[3px] border-[#F59E0B] bg-[#F59E0B]/20 shadow-[0_0_14px_rgba(245,158,11,0.7)]" />
      <div className="flex-1 h-1 rounded-full bg-gradient-to-l from-transparent via-[#F59E0B]/80 to-[#F59E0B]" />
    </div>
  );

  const catBots = useMemo(
    () => (activeCat ? [...bots].filter((b) => categoryOf(b) === activeCat) : []),
    [bots, activeCat]
  );

  const renderCategoryHeader = (cat: StoreCategory) => (
    <div className="flex flex-col items-center mb-4">
      <h2 className={`text-lg sm:text-xl font-black mb-2 ${pageTitle}`}>{catLabel(isAr, cat)}</h2>
      <div className="w-24 h-24 rounded-2xl flex items-center justify-center shadow-md bg-gradient-to-br from-sky-500 to-blue-700 keep-white">
        {(() => { const I = TILE_ICONS[cat]; return <I size={52} />; })()}
      </div>
    </div>
  );

  const emptyBox = (title: string, sub: string) => (
    <div className="text-center py-20">
      <p className="text-base font-black text-slate-300">{title}</p>
      <p className={`text-xs mt-1 font-bold ${pageSub}`}>{sub}</p>
    </div>
  );

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqName.trim() || !reqContact.trim() || !reqMessage.trim()) {
      setReqErr(isAr ? 'يرجى إدخال الاسم ووسيلة التواصل ونص الطلب' : 'Please enter your name, contact, and request message');
      return;
    }
    setRequesting(true);
    setReqErr('');
    try {
      await submitSiteRequest({ name: reqName, contact: reqContact, message: reqMessage });
      setReqDone(true);
    } catch {
      setReqErr(isAr ? 'تعذر إرسال الطلب. حاول مرة أخرى.' : 'Could not send the request. Try again.');
    }
    setRequesting(false);
  };

  const requestPage = (
    <div className="w-full max-w-2xl mx-auto">
      {levelBack()}
      <div className="flex flex-col items-center mb-4">
        <h2 className={`text-lg sm:text-xl font-black mb-2 ${pageTitle}`}>
          {isAr ? 'طلب إنشاء موقع' : 'Website Creation Request'}
        </h2>
        <p className={`text-xs sm:text-sm font-bold text-center ${pageSub}`}>
          {isAr ? 'أرسل طلبك وسيتواصل معك المطور لشرح التفاصيل' : 'Send your request and the developer will contact you to discuss the details'}
        </p>
      </div>

      {reqDone ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-emerald-400 to-emerald-700 border border-emerald-300/50 rounded-2xl p-6 text-center shadow-lg shadow-emerald-600/40"
        >
          <Gift size={36} className="mx-auto mb-3 keep-white" />
          <h3 className="text-lg font-black keep-white">{isAr ? 'تم إرسال طلبك بنجاح' : 'Your request was sent successfully'}</h3>
          <p className="text-sm font-bold keep-white mt-2">
            {isAr ? 'سيتواصل معك المطور قريباً عبر وسيلة التواصل التي أدخلتها لمناقشة طلبك بالتفصيل.' : 'The developer will contact you soon via the contact you provided to discuss your request in detail.'}
          </p>
          <button
            onClick={() => { setReqDone(false); setReqMessage(''); }}
            className="mt-5 px-5 py-2.5 rounded-xl bg-white text-emerald-700 font-black text-sm uppercase tracking-wider shadow-md hover:bg-emerald-50 active:scale-95 transition-all"
          >
            {isAr ? 'إرسال طلب آخر' : 'Send Another Request'}
          </button>
        </motion.div>
      ) : (
        <form onSubmit={handleRequestSubmit} className="bg-black/40 border border-white/10 rounded-2xl p-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-black text-slate-400 mb-1.5 block">{isAr ? 'الاسم' : 'Name'}</label>
            <input
              type="text"
              value={reqName}
              onChange={(e) => setReqName(e.target.value)}
              placeholder={isAr ? 'اسمك الكامل' : 'Your full name'}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-lg text-white outline-none focus:border-[#F59E0B]"
            />
          </div>
          <div>
            <label className="text-xs font-black text-slate-400 mb-1.5 block">{isAr ? 'وسيلة التواصل' : 'Contact (phone / email / Telegram)'}</label>
            <input
              type="text"
              value={reqContact}
              onChange={(e) => setReqContact(e.target.value)}
              placeholder={isAr ? 'هاتف، بريد، أو تيليجرام' : 'Phone, email, or Telegram'}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-lg text-white outline-none focus:border-[#F59E0B]"
            />
          </div>
          <div>
            <label className="text-xs font-black text-slate-400 mb-1.5 block">{isAr ? 'نص الطلب' : 'Request Message'}</label>
            <textarea
              value={reqMessage}
              onChange={(e) => setReqMessage(e.target.value)}
              rows={4}
              placeholder={isAr ? 'اشرح موقعك المطلوب بالتفصيل: النوع، الصفحات، الخصائص...' : 'Explain your requested website in detail: type, pages, features...'}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-lg text-white outline-none focus:border-[#F59E0B] resize-none"
            />
          </div>
          {reqErr && <p className="text-sm font-black text-red-400">{reqErr}</p>}
          <button
            type="submit"
            disabled={requesting}
            className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#F59E0B] hover:bg-[#d97706] text-black font-black text-sm uppercase tracking-wider shadow-md active:scale-95 transition-all disabled:opacity-60"
          >
            <Send size={16} /> {requesting ? (isAr ? 'جاري الإرسال...' : 'Sending...') : (isAr ? 'إرسال الطلب' : 'Send Request')}
          </button>
        </form>
      )}
    </div>
  );

  if (showRequest) return <div className="w-full px-2 pb-10">{requestPage}</div>;

  const categoryPage = () => {
    const types = typesForCategory(activeCat as StoreCategory);
    // Type detail page
    if (activeType && activeCat) {
      const typed = bots.filter((b) => categoryOf(b) === activeCat && typeOf(b) === activeType);
      return (
        <div className="w-full">
          {levelBack()}
          <div className="flex flex-col items-center mb-3">
            <h2 className={`text-lg sm:text-xl font-black mb-2 ${pageTitle}`}>{typeLabelForCat(activeCat, activeType, isAr)}</h2>
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-md bg-gradient-to-br from-sky-500 to-blue-700 keep-white">
              {(() => { const I = TYPE_ICONS[activeType] || Package; return <I size={40} />; })()}
            </div>
          </div>
          {typed.length === 0 ? (
            emptyBox(isAr ? 'لا توجد منتجات من هذا النوع بعد' : 'No products of this type yet', isAr ? 'ترقبوا الإضافات الجديدة قريباً' : 'New additions coming soon')
          ) : (
            <>
              {renderStack(typed, true, activeCat, activeType)}
              {sectionDivider()}
              {renderStack(typed, false, activeCat, activeType)}
            </>
          )}
        </div>
      );
    }
    // Category with internal types → tiles
    if (types.length > 0) {
      return (
        <div className="w-full">
          {levelBack()}
          {renderCategoryHeader(activeCat as StoreCategory)}
          <p className={`text-center text-sm font-black mb-4 ${pageTitle}`}>
            {isAr ? `اختر نوع ${catLabel(isAr, activeCat as StoreCategory)}` : `Choose a ${catLabel(isAr, activeCat as StoreCategory).toLowerCase()} type`}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 md:gap-7">
            {types.map((t) => {
              const c = typeCounts[t.key] || { free: 0, paid: 0 };
              const TypeIcon = TYPE_ICONS[t.key] || Package;
              return (
                <motion.button
                  key={t.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setActiveType(t.key)}
                  className="bg-gradient-to-br from-sky-400 to-blue-700 border border-sky-300/50 rounded-2xl p-4 flex flex-col items-center gap-3 transition-all shadow-lg shadow-blue-600/40 ring-1 ring-white/10 hover:scale-[1.03] active:scale-95 text-center"
                >
                  <div className="w-[4rem] h-[4rem] rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center keep-white shadow-inner">
                    <TypeIcon size={30} strokeWidth={2.1} />
                  </div>
                  <span className="text-base font-black keep-white">{typeLabelForCat(activeCat as StoreCategory, t.key, isAr)}</span>
                  <div className="flex items-center gap-2 text-sm font-black uppercase keep-white">
                    <span className="px-2.5 py-1 rounded-full bg-white/20 border border-white/40 flex items-center gap-1 keep-white">
                      <Gift size={14} /> {c.free} {isAr ? 'مجاني' : 'Free'}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/20 border border-white/40 flex items-center gap-1 keep-white">
                      <Sparkles size={14} /> {c.paid} {isAr ? 'مدفوع' : 'Paid'}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
          <p className={`text-center text-[10px] font-bold mt-5 ${pageSub}`}>
            {isAr ? 'اضغط على أي نوع لفتح صفحته الخاصة' : 'Tap a type to open its dedicated page'}
          </p>
        </div>
      );
    }
    // Category without internal types (plans) → free plans, then PAID section containing subscription plans + paid products
    const freePlanBots = catBots.filter((b) => isFree(b));
    const paidPlanBots = catBots.filter((b) => !isFree(b));
    const hasAnyPlans = activePlans.length > 0 || catBots.length > 0;
    return (
      <div className="w-full">
        {levelBack()}
        {renderCategoryHeader(activeCat as StoreCategory)}
        {customerPlan && renderCustomerPlan()}
        {!hasAnyPlans ? (
          emptyBox(isAr ? 'لا توجد منتجات في هذا القسم بعد' : 'No products in this section yet', isAr ? 'ترقبوا الإضافات الجديدة قريباً' : 'New additions coming soon')
        ) : (
          <>
            {/* Free plans */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4 mt-2">
                <span className="px-3 py-1.5 rounded-xl border-2 text-base sm:text-lg font-black uppercase tracking-wide whitespace-nowrap bg-emerald-500/10 border-emerald-500/40 text-emerald-500">
                  {isAr ? 'خطط مجانية' : 'Free Plans'}
                </span>
                <div className={`flex-1 h-[3px] rounded-full ${isDark ? 'bg-black/15' : 'bg-white/20'}`} />
                <span className={`px-2.5 py-1 rounded-lg text-sm font-black ${pageSub}`}>{freePlanBots.length}</span>
              </div>
              {freePlanBots.length === 0 ? (
                <p className={`text-sm font-bold text-center py-6 ${pageSub}`}>
                  {isAr ? 'لا توجد خطط مجانية هنا بعد' : 'No free plans here yet'}
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-7">
                  <AnimatePresence>{freePlanBots.map((bot) => renderCard(bot))}</AnimatePresence>
                </div>
              )}
            </div>

            {sectionDivider()}

            {/* Paid plans: subscription plans first, then paid plan-category products */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4 mt-2">
                <span className="px-3 py-1.5 rounded-xl border-2 text-base sm:text-lg font-black uppercase tracking-wide whitespace-nowrap bg-sky-500/10 border-sky-500/50 text-sky-500">
                  {isAr ? 'خطط مدفوعة' : 'Paid Plans'}
                </span>
                <div className={`flex-1 h-[3px] rounded-full ${isDark ? 'bg-black/15' : 'bg-white/20'}`} />
                <span className={`px-2.5 py-1 rounded-lg text-sm font-black ${pageSub}`}>{activePlans.length + paidPlanBots.length}</span>
              </div>
              {activePlans.length + paidPlanBots.length === 0 ? (
                <p className={`text-sm font-bold text-center py-6 ${pageSub}`}>
                  {isAr ? 'لا توجد خطط مدفوعة هنا بعد' : 'No paid plans here yet'}
                </p>
              ) : (
                <>
                  {activePlans.length > 0 && (
                    <div className="mb-6">
                      {renderPlanBoxes()}
                    </div>
                  )}
                  {paidPlanBots.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-7">
                      <AnimatePresence>{paidPlanBots.map((bot) => renderCard(bot))}</AnimatePresence>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-full px-2 pb-10">
      {!activeCat && (
        <div className="text-center mb-6 px-4">
          <h2 className={`text-xl sm:text-2xl font-black ${pageTitle}`}>
            {isAr ? 'متجر التداول' : 'Trading Store'}
          </h2>
          <p className={`text-xs sm:text-sm mt-2 font-bold ${pageSub}`}>
            {isAr ? 'بوتات ومؤشرات وخطط ومنتجات — مجاني ومدفوع' : 'Bots, indicators, plans & products — free and paid'}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 rounded-full border-4 border-emerald-500/30 border-t-emerald-500 animate-spin" />
          <p className={`text-xs mt-3 font-bold ${pageSub}`}>{isAr ? 'جاري تحميل المتجر...' : 'Loading store...'}</p>
        </div>
      ) : activeCat ? (
        categoryPage()
      ) : bots.length === 0 ? (
        emptyBox(isAr ? 'لا توجد منتجات في المتجر بعد' : 'No products in the store yet', isAr ? 'ترقبوا الإضافات الجديدة قريباً' : 'New additions coming soon')
      ) : (
        <div className="w-full">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 md:gap-7">
            {STORE_CATEGORIES.map((s) => {
              const key = s.key;
              const Icon = TILE_ICONS[key];
              const c = counts[key];
              return (
                <motion.button
                  key={key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => setActiveCat(key)}
                  className="bg-gradient-to-br from-sky-400 to-blue-700 border border-sky-300/50 rounded-2xl p-4 flex flex-col items-center gap-3 transition-all shadow-lg shadow-blue-600/40 ring-1 ring-white/10 hover:scale-[1.03] active:scale-95 text-center"
                >
                  <div className="w-[4.5rem] h-[4.5rem] rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center keep-white shadow-inner">
                    <Icon size={38} strokeWidth={2.1} />
                  </div>
                  <span className="text-lg font-black keep-white">{catLabel(isAr, key)}</span>
                  <div className="flex items-center gap-2 text-sm font-black uppercase keep-white">
                    <span className="px-2.5 py-1 rounded-full bg-white/20 border border-white/40 flex items-center gap-1 keep-white">
                      <Gift size={14} /> {c.free} {isAr ? 'مجاني' : 'Free'}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/20 border border-white/40 flex items-center gap-1 keep-white">
                      <Sparkles size={14} /> {c.paid} {isAr ? 'مدفوع' : 'Paid'}
                    </span>
                  </div>
                </motion.button>
              );
            })}
            {/* Website creation request — dedicated section */}
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setShowRequest(true)}
              className="col-span-2 sm:col-span-3 bg-gradient-to-br from-amber-400 to-amber-700 border border-amber-300/50 rounded-2xl p-4 flex items-center justify-center gap-4 transition-all shadow-lg shadow-amber-600/40 ring-1 ring-white/10 hover:scale-[1.01] active:scale-95 text-center"
            >
              <div className="w-14 h-14 shrink-0 rounded-2xl bg-white/20 border border-white/40 flex items-center justify-center keep-white shadow-inner">
                <Code2 size={28} strokeWidth={2.1} />
              </div>
              <div className="text-left">
                <span className="block text-lg font-black keep-white">{isAr ? 'طلب إنشاء موقع' : 'Website Creation Request'}</span>
                <span className="block text-sm font-bold keep-white/90">{isAr ? 'أرسل طلبك وسيتواصل معك المطور' : 'Send your request — the developer will contact you'}</span>
              </div>
            </motion.button>
          </div>
          <p className={`text-center text-[10px] font-bold mt-5 ${pageSub}`}>
            {isAr ? 'اضغط على أي قسم لفتح صفحته الخاصة' : 'Tap a section to open its dedicated page'}
          </p>
          <p className={`text-center text-[9px] font-bold mt-1 ${pageSub}`}>
            {isAr ? 'معاملاتك تظهر في صفحة «معاملاتي» من القائمة الجانبية' : 'Your transactions show under Transactions in the side menu'}
          </p>
        </div>
      )}
    </div>
  );
}