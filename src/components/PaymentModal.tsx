import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Copy, Check, ArrowLeft, ShieldOff, Shield, RefreshCw, Wallet, Mail } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { StoreBot, downloadBot, recordBotPurchase, getDownloadGrant, grantBotDownload, consumeBotDownload, hasDownloadedBot } from '../services/storeService';
import { loadPaymentSettings, ConfirmMode, DEFAULT_CONFIRM_MODE, DEFAULT_BINANCE_EMAIL, PaymentAddress, SYMBOL_TO_PRICE_KEY } from '../services/paymentSettings';
import { fetchCryptoPricesDirect } from '../services/apiDirect';
import { createPaymentRequest, checkUserGrant, consumeBotGrant, cleanupPendingPlanRequests } from '../services/paymentRequests';
import { createSession, updateSession, completeSession, cancelSession, discardSession, getCachedSession, getRemoteSession, readLocalSessions, genSessionId, setLastEmail, PaymentSession } from '../services/paymentSession';
import { rememberBuyerEmail } from '../lib/clientScope';
import { ensureClientIdentity } from '../services/clientIdentity';
import { isGoogleOrMicrosoftEmail } from '../lib/authPolicy';
import { loadPaymentWaitHours, readCachedWaitHours, savePaymentWaitHours } from '../services/paymentWait';
import { stackedPlanExpiry } from '../lib/planPeriod';

const DEFAULT_PRICES = { weekly: 2, monthly: 6, yearly: 60 };
const SUBSCRIPTION_STORAGE_KEY = 'subscription_prices';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  planLabel: string;
  amount: number;
  asPage?: boolean;
  manageMode?: boolean;
  /** For plan purchases, called automatically when the developer releases the grant.
   *  Receives the server-computed expiryDate and requestNo from the actual grant. */
  onConfirm?: (grantInfo?: { expiryDate?: string; requestNo?: number }) => void;
  lang?: 'en' | 'ar';
  freemiumDisabled?: boolean;
  onFreemiumToggle?: (v: boolean) => void;
  botPurchase?: StoreBot | null;
  sectionTab?: 'bot' | 'plan';
  onBotPaid?: (bot: StoreBot) => void;
  onGoToStore?: () => void;
  onGoToPlans?: () => void;
  buyerEmail?: string;
  buyerName?: string;
  planDurationDays?: number;
  planUnit?: string;
  planUnits?: number;
  resumeSessionId?: string | null;
  /** End of the client's CURRENT active plan (ISO). When it is in the future a
   *  new purchase is added on top of it instead of starting from now. */
  currentPlanExpiry?: string | null;
  /** Label of the current active plan, only used in the stacking notice. */
  currentPlanLabel?: string | null;
}

export default function PaymentModal({ isOpen, onClose, planLabel, amount, asPage, manageMode, onConfirm, lang, freemiumDisabled: externalFreemium, onFreemiumToggle, botPurchase, sectionTab = 'bot', onBotPaid, onGoToStore, onGoToPlans, buyerEmail, buyerName, planDurationDays, planUnit, planUnits, resumeSessionId, currentPlanExpiry, currentPlanLabel }: PaymentModalProps) {
  const isAr = lang === 'ar';
  const [section, setSection] = useState<'bot' | 'plan'>(sectionTab || 'bot');
  const [usdtAddresses, setUsdtAddresses] = useState<PaymentAddress[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [copiedNetwork, setCopiedNetwork] = useState<string | null>(null);
  const [copiedAmountId, setCopiedAmountId] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, { usd: number }>>({});
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [timerHours, setTimerHours] = useState(readCachedWaitHours);
  const timerMinutes = timerHours * 60;
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [editTimerHours, setEditTimerHours] = useState(timerHours);
  // The wait period is edited in Store Settings and stored ONCE for the whole
  // site (shared_settings/payment_timer). The shared value is loaded every time
  // the modal opens, so desktop and phone always show the same number, and the
  // browser's storage event keeps other open tabs in sync.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const apply = (h: number) => {
      if (cancelled) return;
      setTimerHours((prev) => (prev === h ? prev : h));
      setEditTimerHours((prev) => (prev === h ? prev : h));
    };
    const syncLocal = () => apply(readCachedWaitHours());
    syncLocal();
    void loadPaymentWaitHours().then(apply).catch(() => {});
    window.addEventListener('storage', syncLocal);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', syncLocal);
    };
  }, [isOpen]);
  const [requestNo, setRequestNo] = useState<number | null>(null);
  const [requestStatus, setRequestStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');
  const [requestCreating, setRequestCreating] = useState(false);
  const [grantChecking, setGrantChecking] = useState(false);
  const [subPrices, setSubPrices] = useState(() => {
    try { const s = localStorage.getItem(SUBSCRIPTION_STORAGE_KEY); return s ? JSON.parse(s) : DEFAULT_PRICES; }
    catch { return DEFAULT_PRICES; }
  });
  const [editSubPrices, setEditSubPrices] = useState({ ...subPrices });
  const [freemiumDisabled, setFreemiumDisabled] = useState(externalFreemium ?? localStorage.getItem('finalyze_freemium_disabled') === 'true');
  const [error, setError] = useState<string | null>(null);
  const [botGrantTs, setBotGrantTs] = useState<number | null>(null);
  const [botDownloaded, setBotDownloaded] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(DEFAULT_CONFIRM_MODE);
  const [binanceEmail] = useState(DEFAULT_BINANCE_EMAIL);
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSection(sectionTab || 'bot');
      setCopiedNetwork(null);
      setSelectedNetwork(null);
      setPaymentConfirmed(false);
      setRequestNo(null);
      setRequestStatus('idle');
      setContactEmail(buyerEmail || '');
      setTimerRunning(false);
      setTimerSeconds(0);
      setEditSubPrices({ ...subPrices });
      if (botPurchase?.id) {
        setBotGrantTs(getDownloadGrant(botPurchase.id));
        setBotDownloaded(hasDownloadedBot(botPurchase.id));
      } else {
        setBotGrantTs(null);
        setBotDownloaded(false);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (paymentConfirmed && botPurchase?.id) {
      grantBotDownload(botPurchase.id);
      setBotGrantTs(getDownloadGrant(botPurchase.id));
    }
  }, [paymentConfirmed]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const sync = async () => {
      const data = await loadPaymentSettings();
      if (cancelled || !data) return;
      if (data.addresses && data.addresses.length) {
        setUsdtAddresses(data.addresses);
      }
      if (data.confirmMode) setConfirmMode(data.confirmMode);
    };
    sync();
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    fetchCryptoPricesDirect()
      .then((d: any) => { if (d) setPrices(d); })
      .catch(() => {});
  }, [isOpen]);

  // Resume a previously interrupted transaction. Restores the payment method,
  // address, email and the remaining wait time; keeps the request alive so the
  // auto-verifier can still match a deposit email that arrived meanwhile.
  useEffect(() => {
    if (!isOpen || !resumeSessionId) return;
    let cancelled = false;
    (async () => {
      const local = getCachedSession(resumeSessionId);
      const session = local || (await getRemoteSession(resumeSessionId));
      if (cancelled || !session) return;
      setSessionId(session.id);
      setContactEmail((session.buyerEmail || buyerEmail || '').trim());
      if (session.method) {
        setSelectedNetwork(session.method);
        const remaining = Math.max(0, Math.floor((session.activeUntil - Date.now()) / 1000));
        // A withdrawn (cancelled) transaction — or one whose wait period ran
        // out — resumes with a fresh full wait period. The record is revived so
        // the pending row keeps working on both phone and desktop.
        const restart = session.status === 'cancelled' || remaining <= 0;
        if (restart) {
          const until = Date.now() + timerMinutes * 60 * 1000;
          setTimerSeconds(timerMinutes * 60);
          setTimerRunning(true);
          if (session.status === 'cancelled') updateSession(session.id, { status: 'active', activeUntil: until });
          else updateSession(session.id, { activeUntil: until });
        } else {
          setTimerRunning(true);
          setTimerSeconds(remaining);
        }
      }
      if (session.requestNo) {
        setRequestNo(session.requestNo);
        setRequestStatus('pending');
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, resumeSessionId]);

  useEffect(() => {
    if (!timerRunning || timerSeconds <= 0) return;
    const interval = setInterval(() => {
      setTimerSeconds(prev => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning, timerSeconds]);

  const grantAccess = (grant?: { expiryDate?: string; requestNo?: number }) => {
    setPaymentConfirmed(true);
    setRequestStatus('approved');
    setTimerRunning(false);
    if (sessionId) { completeSession(sessionId); setSessionId(null); }
    if (!botPurchase?.id) {
      // Plans: activate immediately without requiring a button click.
      onConfirm?.(grant);
      return;
    }
    grantBotDownload(botPurchase.id);
    setBotGrantTs(getDownloadGrant(botPurchase.id));
  };

  const productLabel = botPurchase?.name || planLabel;

  const isBotProduct = section === 'bot' && !!botPurchase?.id;
  const buyerEmailFinal = (buyerEmail || contactEmail).trim().toLowerCase();

  // Coin amount the customer must send. Stable USDT = exactly $amount (1:1).
  // Volatile coins = USD amount converted at the current market price.
  const expectedCoinAmount = (item: PaymentAddress): number => {
    if (item.stable) return amount;
    const priceKey = SYMBOL_TO_PRICE_KEY[item.symbol] || 'tether';
    const price = prices[priceKey]?.usd;
    if (!price || price <= 0) return 0;
    return amount / price;
  };

  const coinAmountText = (item: PaymentAddress): string => {
    const n = expectedCoinAmount(item);
    if (n <= 0) return '...';
    const decimals = item.symbol === 'TRX' ? 2 : item.symbol === 'SOL' ? 4 : item.symbol === 'LTC' ? 6 : 2;
    return n.toFixed(decimals);
  };

  const coinPriceText = (item: PaymentAddress): string => {
    if (item.stable) return '1 USDT = $1.00';
    const priceKey = SYMBOL_TO_PRICE_KEY[item.symbol] || 'tether';
    const price = prices[priceKey]?.usd;
    if (!price) return '';
    return `1 ${item.symbol} = $${price < 1 ? price.toFixed(4) : price.toFixed(2)}`;
  };

  const requestManualConfirmation = async () => {
    if (!selectedNetwork) return;
    if (!buyerEmailFinal) {
      setError(isAr ? 'أدخل بريدك الإلكتروني أولاً' : 'Enter your email first');
      return;
    }
    // Payment is only allowed from a Google or Microsoft mailbox.
    if (!isGoogleOrMicrosoftEmail(buyerEmailFinal)) {
      setError(isAr
        ? '⛔ الدفع مسموح فقط من حساب Google أو Microsoft (gmail.com أو outlook.com).'
        : '⛔ Payment is only allowed from a Google or Microsoft account (gmail.com or outlook.com).');
      return;
    }
    rememberBuyerEmail(buyerEmailFinal);
    const item = usdtAddresses.find(a => a.method === selectedNetwork);
    if (!item) return;
    setError(null);
    setRequestCreating(true);
    try {
      // Housekeeping (phone + desktop): when this same plan type already has 3
      // pending requests, those three are cleared automatically. It runs BEFORE
      // the new request, so a payment the client is submitting right now is
      // never the one that disappears.
      if (!isBotProduct) {
        try { await cleanupPendingPlanRequests(buyerEmailFinal); } catch {}
      }
      const priceKey = SYMBOL_TO_PRICE_KEY[item.symbol] || 'tether';
      const price = item.stable ? 1 : (prices[priceKey]?.usd || 0);
      const expectedCoin = item.stable ? amount : (price > 0 ? amount / price : 0);
      const req = await createPaymentRequest({
        kind: isBotProduct ? 'bot' : 'plan',
        botId: botPurchase?.id,
        botName: botPurchase?.name,
        planLabel: isBotProduct ? undefined : productLabel,
        durationDays: isBotProduct ? undefined : (planDurationDays || 30),
        planUnit: isBotProduct ? undefined : planUnit,
        planUnits: isBotProduct ? undefined : planUnits,
        amountUsd: amount,
        coinId: item.symbol.toLowerCase(),
        coinName: item.label,
        address: item.address,
        coinAmountExpected: expectedCoin,
        buyerName: (buyerName || '').trim(),
        buyerEmail: buyerEmailFinal,
        method: confirmMode,
      });
      setRequestNo(req.requestNo);
      setRequestStatus('pending');
      setTimerRunning(false);
      if (sessionId) {
        updateSession(sessionId, { requestNo: req.requestNo, status: 'pending' });
      } else {
        const method = usdtAddresses.find(a => a.method === selectedNetwork);
        if (method) {
          createSession({
            kind: isBotProduct ? 'bot' : 'plan',
            botId: isBotProduct ? botPurchase?.id : undefined,
            botName: isBotProduct ? botPurchase?.name : undefined,
            planLabel: isBotProduct ? undefined : planLabel,
            durationDays: isBotProduct ? undefined : (planDurationDays || 30),
            planUnit: isBotProduct ? undefined : planUnit,
            planUnits: isBotProduct ? undefined : planUnits,
            amountUsd: amount,
            method: method.method,
            symbol: method.symbol,
            label: method.label,
            address: method.address,
            coinId: method.symbol.toLowerCase(),
            coinName: method.label,
            coinAmountExpected: method.stable ? amount : (expectedCoinAmount(method) || undefined),
            buyerEmail: buyerEmailFinal || undefined,
            requestNo: req.requestNo,
            timerMinutes,
            activeUntil: Date.now() + timerMinutes * 60 * 1000,
          } as any).then((s) => setSessionId(s.id)).catch(() => {});
        }
      }
    } catch {
      setError(isAr ? 'تعذر إرسال طلب التأكيد. حاول مرة أخرى.' : 'Could not submit the confirmation request. Try again.');
    }
    setRequestCreating(false);
  };

  useEffect(() => {
    if (!isOpen || manageMode || !buyerEmailFinal) return;
    let stopped = false;
    // Plans are keyed per request (plan_<requestNo>). A fresh plan purchase has
    // no request yet (requestNo null) so it can never auto-open from an older
    // email grant — it waits for its own developer approval.
    checkUserGrant(buyerEmailFinal, isBotProduct ? 'bot' : 'plan', isBotProduct ? botPurchase?.id : undefined, isBotProduct ? undefined : (requestNo ?? undefined)).then((g) => {
      if (!stopped && g) grantAccess(g);
    });
    return () => { stopped = true; };
  }, [isOpen, buyerEmailFinal, isBotProduct, botPurchase?.id, requestNo]);

  useEffect(() => {
    if (!isOpen || manageMode || !buyerEmailFinal) return;
    let stopped = false;
    const check = async () => {
      const g = await checkUserGrant(buyerEmailFinal, isBotProduct ? 'bot' : 'plan', isBotProduct ? botPurchase?.id : undefined, isBotProduct ? undefined : (requestNo ?? undefined));
      if (!stopped && g) grantAccess(g);
    };
    const interval = setInterval(check, 3000);
    check();
    return () => { stopped = true; clearInterval(interval); };
  }, [isOpen, manageMode, buyerEmailFinal, isBotProduct, botPurchase?.id, requestNo]);

  const refreshGrantStatus = async () => {
    if (!buyerEmailFinal) return;
    setGrantChecking(true);
    const g = await checkUserGrant(buyerEmailFinal, isBotProduct ? 'bot' : 'plan', isBotProduct ? botPurchase?.id : undefined, isBotProduct ? undefined : (requestNo ?? undefined));
    if (g) grantAccess(g);
    else setError(isAr ? 'لم يتم الإفراج بعد. قد يستغرق التأكيد حتى 24 ساعة.' : 'Not released yet. Confirmation may take up to 24 hours.');
    setGrantChecking(false);
  };

  const startTimer = (forEmail?: string) => {
    const email = (forEmail ?? buyerEmailFinal).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) {
      setError(isAr ? 'أدخل بريداً إلكترونياً صحيحاً أولاً لبدء المهلة.' : 'Enter a valid email first to start the wait period.');
      return;
    }
    setTimerSeconds(timerMinutes * 60);
    setTimerRunning(true);
    persistSession(email);
  };

  // The wait period must never sit dead at 00:00 with the request button stuck
  // disabled. A network plus a valid email is enough to start it, however the
  // email arrived: typed, pasted, restored from the browser, or pre-filled from
  // the remembered buyer email. The ref makes sure a finished period is never
  // silently restarted.
  const autoStartedFor = useRef('');
  useEffect(() => {
    if (!isOpen || manageMode || !selectedNetwork) return;
    const email = (contactEmail || buyerEmailFinal || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return;
    const key = `${email}|${selectedNetwork}`;
    if (autoStartedFor.current === key) return;
    if (timerRunning || timerSeconds > 0) { autoStartedFor.current = key; return; }
    autoStartedFor.current = key;
    setTimerSeconds(timerMinutes * 60);
    setTimerRunning(true);
    persistSession(email);
  }, [isOpen, manageMode, selectedNetwork, contactEmail, buyerEmailFinal, timerRunning, timerSeconds]);

  // Save the in-progress transaction so it survives outages / crashes. Restart it
  // on "continue" and cancel explicitly; otherwise it stays alive until settled.
  // The email is a hard requirement: without it the wait period never begins and
  // no session is created, so an email change starts a brand-new transaction.
  const persistSession = (emailFor?: string) => {
    if (manageMode) return;
    const method = usdtAddresses.find(a => a.method === selectedNetwork);
    const email = (emailFor || '').trim().toLowerCase();
    if (!method || !email) return;
    const base: Partial<PaymentSession> = {
      kind: isBotProduct ? 'bot' : 'plan',
      botId: isBotProduct ? botPurchase?.id : undefined,
      botName: isBotProduct ? botPurchase?.name : undefined,
      planLabel: isBotProduct ? undefined : planLabel,
      durationDays: isBotProduct ? undefined : (planDurationDays || 30),
      planUnit: isBotProduct ? undefined : planUnit,
      planUnits: isBotProduct ? undefined : planUnits,
      amountUsd: amount,
      method: method.method,
      symbol: method.symbol,
      label: method.label,
      address: method.address,
      coinId: method.symbol.toLowerCase(),
      coinName: method.label,
      coinAmountExpected: method.stable ? amount : (expectedCoinAmount(method) || undefined),
      buyerEmail: email,
      timerMinutes,
      activeUntil: Date.now() + timerMinutes * 60 * 1000,
    };
    if (sessionId) {
      // An email change means a brand-new transaction: never mutate the buyer
      // email of an existing session (would break cross-device matching).
      const current = getCachedSession(sessionId);
      if (current && current.buyerEmail && current.buyerEmail !== email) {
        discardSession(sessionId);
        setSessionId(null);
        createSession(base as any).then((s) => setSessionId(s.id)).catch(() => {});
      } else {
        updateSession(sessionId, base);
      }
    } else {
      createSession(base as any).then((s) => setSessionId(s.id)).catch(() => {});
    }
  };

  const renewSession = () => {
    setTimerSeconds(timerMinutes * 60);
    setTimerRunning(true);
    persistSession(buyerEmailFinal);
    // Revive: resubmit the numbered confirmation request (unless one already
    // exists) so the email-archive verifier can search for an already-received
    // payment. If none found, the request simply stays pending and the customer
    // is asked to pay.
    if (sessionId && requestStatus === 'idle' && buyerEmailFinal && selectedNetwork) {
      const item = getCachedSession(sessionId);
      if (item && !item.requestNo) requestManualConfirmation();
    }
  };

  const cancelCurrentSession = () => {
    if (sessionId) cancelSession(sessionId);
    setSessionId(null);
    setSelectedNetwork(null);
    setTimerRunning(false);
    setTimerSeconds(0);
  };

  const formatTime = (secs: number) => {
    // The wait period is set in hours, so the countdown is shown as H:MM:SS.
    // Without the hours part a 24h period used to read as a frozen "1440:00".
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  const copyAddress = async (addr: string, network: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedNetwork(network);
      setSelectedNetwork(network);
      if (!buyerEmailFinal) {
        // Email is a hard requirement before the wait period can start; the
        // transaction is keyed to it so it can be resumed from any device.
        setError(isAr ? 'أدخل بريدك الإلكتروني أولاً لبدء المهلة.' : 'Enter your email first to start the wait period.');
        setTimerRunning(false);
        setTimeout(() => setCopiedNetwork(null), 2000);
        return;
      }
      setError(null);
    rememberBuyerEmail(buyerEmailFinal);
    // The purchase is what registers the buyer: this browser gets an identity
    // for the payment email, so the release (and the plan, and the key) can be
    // read back afterwards. Browsing the free plan still needs no login at all.
    try { setLastEmail(buyerEmailFinal); } catch {}
    try { await ensureClientIdentity(buyerEmailFinal); } catch {}
      if (!timerRunning) startTimer();
      else persistSession();
      setTimeout(() => setCopiedNetwork(null), 2000);
    } catch {}
  };

  const copyAmount = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAmountId(id);
      setTimeout(() => setCopiedAmountId(null), 2000);
    } catch {}
  };

  const saveSubPrices = () => {
    const clean = {
      weekly: Math.max(0.01, Number(editSubPrices.weekly) || DEFAULT_PRICES.weekly),
      monthly: Math.max(0.01, Number(editSubPrices.monthly) || DEFAULT_PRICES.monthly),
      yearly: Math.max(0.01, Number(editSubPrices.yearly) || DEFAULT_PRICES.yearly),
    };
    setSubPrices(clean);
    localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(clean));
    setDoc(doc(db, 'shared_settings', 'prices'), { ...clean, updatedAt: Date.now() }).catch(console.warn);
  };

  const handleDownloadBot = () => {
    if (!botPurchase || !paymentConfirmed || !botGrantTs) return;
    downloadBot(botPurchase);
    consumeBotDownload(botPurchase.id || '');
    consumeBotGrant((buyerEmail || contactEmail).trim().toLowerCase(), botPurchase.id || '');
    setBotGrantTs(null);
    setBotDownloaded(true);
    recordBotPurchase(botPurchase, buyerEmail || '').then(() => onBotPaid?.(botPurchase));
  };

  if (!isOpen) return null;

  const isBotSection = section === 'bot' && !!botPurchase;
  const showBotDummy = section === 'bot' && !botPurchase && !manageMode;
  const showPlanDummy = section === 'plan' && !!botPurchase;
  const showAddresses = !showBotDummy && !showPlanDummy;
  const currentLabel = isBotSection ? botPurchase!.name : planLabel;
  const botCopyLocked = !!botPurchase?.id && botDownloaded && !botGrantTs;

  // Cumulative durations: when the signed-in client still has a valid plan, a
  // new purchase (daily / weekly / monthly / yearly) is added on top of that
  // plan's end date instead of starting from today. There is no cap; repeat
  // purchases keep extending the same end date. The notice below makes that
  // explicit so a client never wonders why two plans overlap.
  const activeCurrentExpiry = currentPlanExpiry && new Date(currentPlanExpiry).getTime() > Date.now()
    ? currentPlanExpiry
    : null;
  const stackedExpiry = activeCurrentExpiry
    ? stackedPlanExpiry(activeCurrentExpiry, { label: planLabel, durationDays: planDurationDays, planUnit, planUnits })
    : null;
  const fmtPlanDate = (v: string | Date) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} GMT`;
  };

  const pageInner = (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 className="text-xl font-bold text-white">{isAr ? (manageMode ? 'إدارة الدفع' : 'إتمام الدفع') : (manageMode ? 'Payment Settings' : 'Complete Payment')}</h3>
            {!manageMode && <p className="text-sm text-slate-400">{isBotSection ? `${botPurchase!.name} - $${amount} USD` : `${currentLabel} Plan - $${amount} USD`}</p>}
          </div>
        </div>
      </div>

      {!manageMode && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => setSection('bot')}
            className={`flex items-center justify-center gap-2 py-3 rounded-2xl border-2 text-xs font-black uppercase tracking-wider transition-all ${
              section === 'bot'
                ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-[0_0_25px_-6px_rgba(16,185,129,0.7)]'
                : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/25'
            }`}
          >
            🛒 {isAr ? 'بوتات التداول' : 'Trading Bots'}
          </button>
          <button
            onClick={() => setSection('plan')}
            className={`flex items-center justify-center gap-2 py-3 rounded-2xl border-2 text-xs font-black uppercase tracking-wider transition-all ${
              section === 'plan'
                ? 'border-amber-500 bg-amber-500/15 text-amber-400 shadow-[0_0_25px_-6px_rgba(245,158,11,0.7)]'
                : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/25'
            }`}
          >
            ⚡ {isAr ? 'الخطط' : 'Plans'}
          </button>
        </div>
      )}

      {(showBotDummy || showPlanDummy) && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-lg mb-4">{showBotDummy ? '🛒' : '⚡'}</p>
          <p className="text-sm font-bold text-slate-300 mb-5">
            {showBotDummy
              ? (isAr ? 'هذه الصفحة لإتمام شراء البوتات. اختر بوتاً من المتجر أولاً.' : 'This page completes bot purchases. First pick a bot from the store.')
              : (isAr ? 'هذه الصفحة لشراء الخطط. اختر خطة من صفحة الخطط أولاً.' : 'This page is for plans. Pick a plan from the plans page first.')}
          </p>
          <button
            onClick={showBotDummy ? onGoToStore : onGoToPlans}
            className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-black transition-all active:scale-95 shadow-lg ${showBotDummy ? 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/30' : 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/30'}`}
          >
            {showBotDummy ? (isAr ? 'الذهاب للمتجر' : 'Go to Store') : (isAr ? 'الذهاب للخطط' : 'Go to Plans')}
          </button>
        </div>
      )}

      {!manageMode && section === 'plan' && !botPurchase && activeCurrentExpiry && stackedExpiry && (
        <div className="bg-emerald-500/10 border-2 border-emerald-500/35 rounded-2xl p-4 mb-5">
          <p className="text-xs font-black text-emerald-300 text-center mb-1.5">
            {isAr ? '➕ خطتك الحالية سارية — سيُضاف هذا الشراء فوقها' : '➕ Your current plan is active — this purchase is added on top'}
          </p>
          <p className="text-[11px] text-emerald-100/85 leading-relaxed text-center font-bold">
            {isAr ? (
              <>
                تنتهي خطتك {currentPlanLabel ? `«${currentPlanLabel}» ` : ''}الحالية في{' '}
                <span className="font-black text-emerald-300">{fmtPlanDate(activeCurrentExpiry)}</span>.
                ستُضاف مدة «{planLabel}» فوقها، فتصبح نهاية خطتك الجديدة{' '}
                <span className="font-black text-emerald-300">{fmtPlanDate(stackedExpiry)}</span>.
                تُجمع المدد تلقائياً بلا حد، ويمكنك تكرار الشراء في أي وقت.
              </>
            ) : (
              <>
                Your {currentPlanLabel ? `${currentPlanLabel} ` : ''}plan currently ends{' '}
                <span className="font-black text-emerald-300">{fmtPlanDate(activeCurrentExpiry)}</span>.
                The new {planLabel} period is added on top, so your new end date will be{' '}
                <span className="font-black text-emerald-300">{fmtPlanDate(stackedExpiry)}</span>.
                Durations stack automatically with no cap — you can purchase again at any time.
              </>
            )}
          </p>
        </div>
      )}

      {!manageMode && showAddresses && !selectedNetwork && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6">
          <p className="text-sm text-amber-400 font-bold text-center">
            {isAr ? 'اختر وسيلة الدفع. انسخ العنوان والمبلغ المحدد وأرسل المبلغ. يبدأ العداد فور النسخ.' : 'Choose a payment method. Copy the address and the exact amount, then send. The timer starts once copied.'}
          </p>
        </div>
      )}

      {showAddresses && (
      <div className="relative">
        {error && (
          <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 mb-4">
            <p className="text-xs font-black text-red-400 text-center">{error}</p>
          </div>
        )}
        {botCopyLocked && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 mb-4 text-center">
            <p className="text-xs font-black text-rose-400">
              {isAr
                ? '🔒 حمّلت نسخة من هذا البوت مسبقاً. كل عملية دفع تتيح تحميل نسخة واحدة فقط.'
                : '🔒 You already downloaded a copy of this bot. Each payment allows downloading one copy only.'}
            </p>
            <p className="text-[10px] text-rose-300/60 mt-1">
              {isAr ? 'لتتمكن من التحميل مرة أخرى، يلزمك إتمام عملية دفع جديدة.' : 'To download again, a new payment is required.'}
            </p>
          </div>
        )}

        <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
        {usdtAddresses.length === 0 && (
          <div className="text-center py-8">
            <Wallet size={32} className="mx-auto mb-3 text-slate-500" />
            <p className="text-sm text-slate-400">{isAr ? 'لم يتم إعداد عناوين الدفع بعد. اتصل بالمطور.' : 'No payment addresses configured yet.'}</p>
          </div>
        )}

        {usdtAddresses.map((item) => {
          const amt = coinAmountText(item);
          return (
            <div key={item.method} className={`bg-white/5 border rounded-2xl p-4 transition-all hover:border-white/20 ${selectedNetwork === item.method ? 'border-emerald-500/70 ring-2 ring-emerald-500/40' : 'border-white/10'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-xs shadow-lg ${item.stable ? 'bg-gradient-to-br from-emerald-500 to-green-600' : 'bg-gradient-to-br from-amber-500 to-orange-600'}`}>
                    {item.symbol}
                  </div>
                  <div>
                    <span className="text-sm font-black text-white">{item.label}</span>
                    <span className="text-[10px] text-slate-400 block">{coinPriceText(item)}</span>
                  </div>
                </div>
                <button
                  onClick={() => copyAddress(item.address, item.method)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-black"
                >
                  {copiedNetwork === item.method ? <Check size={14} /> : <Copy size={14} />}
                  {copiedNetwork === item.method ? (isAr ? 'تم النسخ' : 'Copied!') : (isAr ? 'نسخ العنوان' : 'Copy')}
                </button>
              </div>
              <div className="bg-black/40 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between">
                  <code className="text-xs font-mono text-slate-300 break-all select-all">{item.address}</code>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    <span className="text-[10px] font-bold text-emerald-400">{amt} {item.symbol}</span>
                    <button
                      onClick={() => copyAmount(`${amt} ${item.symbol}`, 'amt_' + item.method)}
                      className="p-1 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all"
                    >
                      {copiedAmountId === 'amt_' + item.method ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>

        {!manageMode && selectedNetwork && (() => {
          const overlayItem = usdtAddresses.find(a => a.method === selectedNetwork);
          if (!overlayItem) return null;
          const overlayAmt = coinAmountText(overlayItem);
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-10 bg-brand-bg/95 backdrop-blur-xl rounded-2xl border-2 border-emerald-500/40 p-5 flex flex-col justify-center shadow-[0_0_60px_-12px_rgba(16,185,129,0.4)]"
            >
              <button
                onClick={() => { setSelectedNetwork(null); setTimerRunning(false); }}
                className="absolute top-3 right-3 p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
              >
                <X size={16} />
              </button>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-xs shadow-lg ${overlayItem.stable ? 'bg-gradient-to-br from-emerald-500 to-green-600' : 'bg-gradient-to-br from-amber-500 to-orange-600'}`}>
                    {overlayItem.symbol}
                  </div>
                  <div>
                    <span className="text-sm font-black text-white">{overlayItem.label}</span>
                    <span className="text-[10px] text-slate-400 block">{overlayItem.address.slice(0, 16)}...</span>
                  </div>
                </div>
                <span className="text-xs font-black text-emerald-400 uppercase tracking-widest">{isBotSection ? botPurchase!.name : currentLabel}</span>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 mb-3">
                  <p className="text-[11px] font-black text-red-400 text-center">{error}</p>
                </div>
              )}

              <div className="bg-black/40 rounded-2xl px-5 py-4 text-center border border-emerald-500/20 mb-4">
                <div className="text-3xl font-black text-white font-mono">{overlayAmt} {overlayItem.symbol}</div>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">≈ ${amount} USD · {coinPriceText(overlayItem)}</p>
                <button
                  onClick={() => copyAmount(`${overlayAmt} ${overlayItem.symbol}`, 'confirm_amt')}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-black"
                >
                  {copiedAmountId === 'confirm_amt' ? <Check size={14} /> : <Copy size={14} />}
                  {copiedAmountId === 'confirm_amt' ? (isAr ? 'تم النسخ' : 'Copied!') : (isAr ? 'نسخ المبلغ' : 'Copy Amount')}
                </button>
              </div>

              {/* The email comes FIRST and loud: it is what the plan is attached to, and the
                  wait period cannot even start until it is a valid address. */}
              {!sessionId && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmailFinal || '') && (
                <div className="bg-emerald-500/10 border-2 border-emerald-500/40 rounded-2xl p-3 mb-4">
                  <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-emerald-300 mb-2">
                    <Mail size={14} />
                    {isAr ? 'بريدك الإلكتروني (إلزامي)' : 'Your email (required)'}
                  </label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={contactEmail}
                    onChange={(e) => {
                      const v = e.target.value;
                      setContactEmail(v);
                      if (selectedNetwork && !sessionId && !timerRunning && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) {
                        startTimer(v);
                      }
                    }}
                    placeholder="name@example.com"
                    className="w-full bg-black/50 border-2 border-emerald-500/40 rounded-xl px-4 py-3.5 text-base font-bold text-white outline-none focus:border-emerald-400 placeholder:text-slate-600"
                  />
                  <p className="text-[11px] text-emerald-200/80 font-bold mt-2 leading-relaxed text-center">
                    {isAr
                      ? 'أدخل بريدك هنا أولاً — عليه ستُفعَّل الخطة، ومنه تبدأ مهلة الانتظار.'
                      : 'Enter your email first — the plan is activated on it, and the wait period starts from it.'}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-center mb-4">
                <div className="text-center">
                  <div className={`text-5xl font-black font-mono tabular-nums ${timerSeconds <= 60 ? 'text-red-400' : 'text-white'}`}>
                    {formatTime(timerSeconds)}
                  </div>
                  <p className="text-[9px] text-slate-500 uppercase tracking-widest mt-1">{isAr ? 'الوقت المتبقي' : 'Time Remaining'}</p>
                </div>
              </div>

              {!paymentConfirmed && requestStatus === 'idle' && (
                <>
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-2xl px-3 py-2.5 mb-3">
                    <p className="text-[11px] text-amber-300 text-center font-bold leading-relaxed">
                      {isAr
                        ? 'بعد إتمام التحويل، اضغط الزر أدناه لإرسال طلب تأكيد مرقّم. يُسجَّل وقت ضغطك بضبط تام بتوقيت غرينتش (دقيقة/ساعة/يوم/شهر/سنة) ليكون مرجع المقارنة. المراجعة تتم يدوياً من المطور خلال 10 دقائق إلى 48 ساعة.'
                        : 'After sending the amount, press below to submit a numbered confirmation request. The exact GMT time of your click (minute/hour/day/month/year) is recorded as the reference. Review is done manually by the developer within 10 minutes to 48 hours.'}
                    </p>
                  </div>
                  <button
                    onClick={requestManualConfirmation}
                    disabled={requestCreating || timerSeconds <= 0 || !buyerEmailFinal}
                    className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg disabled:opacity-50 ${
                      requestCreating
                        ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400 cursor-wait'
                        : 'bg-emerald-500 text-white hover:bg-emerald-400 cursor-pointer shadow-emerald-500/40'
                    }`}
                  >
                    {requestCreating
                      ? (isAr ? '⏳ جاري إرسال الطلب...' : '⏳ Submitting request...')
                      : (isAr ? '📨 أرسلت الدفع — اطلب تأكيد التحرير' : '📨 I have paid — request release')}
                  </button>
                </>
              )}

              {requestStatus === 'pending' && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-center">
                  <div className="text-2xl font-black text-[#F59E0B] mb-1">
                    {isAr ? `طلبك رقم #${requestNo}` : `Request #${requestNo}`}
                  </div>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    {isAr
                      ? 'تم تسجيل طلبك مع الوقت الدقيق بتوقيت غرينتش. يرجى الانتظار من 10 دقائق حتى 48 ساعة لمراجعة طلبك. بمجرد تأكيد الدفع والإفراج اليدوي من المطور سيتاح لك تحميل الملفات هنا.'
                      : 'Your request was recorded with the exact GMT time. Please wait from 10 minutes up to 48 hours while your request is reviewed. Once the developer confirms the payment and release is done, your download will become available here.'}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-[10px] text-amber-300 font-bold uppercase tracking-widest">
                      {isAr ? 'قيد المراجعة اليدوية' : 'Under manual review'}
                    </span>
                  </div>
                  <button
                    onClick={refreshGrantStatus}
                    disabled={grantChecking}
                    className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white transition-all text-xs font-black disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={grantChecking ? 'animate-spin' : ''} />
                    {isAr ? 'تحديث الحالة' : 'Refresh status'}
                  </button>
                </div>
              )}

              {paymentConfirmed && (
                <button
                  onClick={() => {
                    if (section === 'bot' && botPurchase) {
                      handleDownloadBot();
                    } else {
                      onConfirm?.();
                    }
                  }}
                  disabled={isBotSection && !botGrantTs}
                  className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-lg ${
                    (!isBotSection || botGrantTs)
                      ? 'bg-emerald-500 text-white hover:bg-emerald-400 cursor-pointer shadow-emerald-500/40'
                      : 'bg-red-500/20 border border-red-500/40 text-red-400 cursor-not-allowed'
                  }`}
                >
                  {isBotSection
                    ? (botGrantTs ? (isAr ? '🟢 تحميل البوت الآن' : '🟢 Download Bot Now') : (isAr ? '🔒 نسخة هذه الدفعة مُستهلَكة' : '🔒 Copy for this payment is spent'))
                    : '🟢 Activate Plan'}
                </button>
              )}

              {timerSeconds <= 0 && sessionId && requestStatus === 'idle' && !paymentConfirmed && (
                <div className="mt-3 space-y-2">
                  <p className="text-[10px] text-red-400 text-center mb-2">{isAr ? 'انتهت مهلة الانتظار. يمكنك المتابعة أو إلغاء المعاملة.' : 'Wait period expired. Continue or cancel the transaction.'}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={renewSession}
                      className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/30"
                    >
                      {isAr ? 'متابعة المعاملة (تجديد المهلة)' : 'Continue (renew)'}
                    </button>
                    <button
                      onClick={cancelCurrentSession}
                      className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-red-400 hover:border-red-500/40 transition-all font-black text-xs uppercase tracking-widest"
                    >
                      {isAr ? 'إلغاء المعاملة' : 'Cancel transaction'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })()}

      </div>
      )}

      {manageMode && (<>
        <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-4">
          <h5 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-3">{isAr ? 'أسعار الخطط' : 'Plan Prices'}</h5>
          <div className="space-y-4">
            {['weekly', 'monthly', 'yearly'].map((key) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs font-black text-slate-400 w-20 uppercase">{key}</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-black text-white">$</span>
                  <input
                    type="number"
                    value={editSubPrices[key]}
                    onChange={(e) => setEditSubPrices({ ...editSubPrices, [key]: e.target.value })}
                    className="w-24 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white outline-none focus:border-emerald-500"
                    min="0.01" step="0.01"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={saveSubPrices}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-black"
            >
              <Check size={14} /> {isAr ? 'حفظ الأسعار' : 'Save Prices'}
            </button>
          </div>
        </div>

        <div className="mt-6 bg-white/5 border border-white/10 rounded-2xl p-4">
          <h5 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1">{isAr ? 'مدة مهلة الدفع' : 'Payment Wait Period'}</h5>
          <p className="text-[10px] text-slate-500 mb-3">{isAr ? 'تُحسب بالساعات' : 'Counted in hours'}</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={editTimerHours}
              onChange={(e) => setEditTimerHours(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              className="w-24 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white outline-none focus:border-emerald-500"
              min="1"
            />
            <span className="text-sm text-slate-400">{isAr ? 'ساعة' : 'hours'}</span>
            <button
              onClick={() => { setTimerHours(editTimerHours); void savePaymentWaitHours(editTimerHours).catch(() => {}); }}
              className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-black"
            >
              {isAr ? 'حفظ المهلة' : 'Save Timer'}
            </button>
          </div>
        </div>
      </>)}

      {!manageMode && showAddresses && (
        <p className="text-center text-[10px] text-slate-500 mt-4">
          {isAr ? `USDT فقط — عملة مستقرة ثابتة بسعر $1.00. الوقت المتبقي: ${Math.floor(timerSeconds / 3600)} ساعة و ${Math.floor((timerSeconds % 3600) / 60)} دقيقة` : `USDT only — stable coin fixed at $1.00. Time remaining: ${Math.floor(timerSeconds / 3600)}h ${Math.floor((timerSeconds % 3600) / 60)}m`}
        </p>
      )}
    </>
  );

  if (asPage) {
    return <div>{pageInner}</div>;
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative max-w-2xl w-full bg-brand-alt border border-white/10 rounded-[32px] p-8 shadow-[0_32px_128px_-12px_rgba(0,0,0,0.85)]"
      >
        {pageInner}
      </motion.div>
    </div>
  );
}
