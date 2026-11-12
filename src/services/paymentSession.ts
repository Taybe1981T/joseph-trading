import { db } from '../lib/firebase';
import { collection, doc, getDocs, getDoc, query, where, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

export type SessionStatus = 'active' | 'pending' | 'completed' | 'cancelled';

export interface PaymentSession {
  id: string;
  deviceId: string;
  kind: 'bot' | 'plan';
  botId?: string;
  botName?: string;
  planLabel?: string;
  durationDays?: number;
  planUnit?: string;
  planUnits?: number;
  amountUsd: number;
  method?: string;
  symbol?: string;
  label?: string;
  address?: string;
  coinId?: string;
  coinName?: string;
  coinAmountExpected?: number;
  buyerEmail?: string;
  requestNo?: number;
  status: SessionStatus;
  timerMinutes: number;
  activeUntil: number;
  createdAt: number;
  updatedAt: number;
}

const LOCAL_KEY = 'finalyze_payment_sessions';
const DEVICE_KEY = 'finalyze_device_id';
const LAST_EMAIL_KEY = 'finalyze_last_payment_email';
const COLLECTION = 'payment_sessions';

export function getLastEmail(): string {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch { return ''; }
}

export function setLastEmail(email: string): void {
  try { localStorage.setItem(LAST_EMAIL_KEY, (email || '').trim().toLowerCase()); } catch {}
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${Date.now()}`;
  }
}

export function genSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function readLocalSessions(): PaymentSession[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as PaymentSession[]) : [];
  } catch {
    return [];
  }
}

function writeLocalSessions(list: PaymentSession[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-20)));
  } catch {}
}

export function getCachedSession(id: string): PaymentSession | null {
  return readLocalSessions().find((s) => s.id === id) || null;
}

function upsertLocal(s: PaymentSession): void {
  const list = readLocalSessions().filter((x) => x.id !== s.id);
  list.push(s);
  writeLocalSessions(list);
}

function removeLocal(id: string): void {
  writeLocalSessions(readLocalSessions().filter((x) => x.id !== id));
}

// ── Client-driven cleanup ───────────────────────────────────────────────────
// The transaction list lives partly in THIS browser (local sessions) and partly
// in Firestore. When a customer clears their transactions the local copies must
// go too, otherwise the row simply reappears on the next load and the delete
// looks broken.
export function removeLocalSessionById(id: string): void {
  removeLocal(id);
}

/** Drop every locally cached session belonging to `email` (or all of them). */
export function clearLocalSessions(email?: string): void {
  try {
    const e = (email || '').toLowerCase().trim();
    const list = readLocalSessions();
    writeLocalSessions(e ? list.filter((s) => (s.buyerEmail || '').toLowerCase() !== e) : []);
  } catch {}
}

const remoteRef = (id: string) => doc(db, COLLECTION, id);

// The list rule matches `buyerEmail` against the session's lowercased email, so
// the value stored in Firestore must always be lowercased too.
const normalizeSession = <T extends Partial<PaymentSession>>(s: T): T =>
  s.buyerEmail ? { ...s, buyerEmail: s.buyerEmail.toLowerCase().trim() } : s;

async function remoteSet(s: PaymentSession): Promise<void> {
  try {
    await setDoc(remoteRef(s.id), normalizeSession(s) as any, { merge: true });
  } catch {}
}

async function remotePatch(id: string, patch: Partial<PaymentSession>): Promise<void> {
  try {
    await updateDoc(remoteRef(id), normalizeSession(patch) as any);
  } catch {
    const cur = getCachedSession(id);
    if (cur) await remoteSet({ ...cur, ...patch, updatedAt: Date.now() });
  }
}

async function remoteDelete(id: string): Promise<void> {
  try {
    await deleteDoc(remoteRef(id));
  } catch {}
}

async function remoteList(email?: string): Promise<PaymentSession[]> {
  try {
    // Payment sessions carry amounts and provider ids, so the rules only hand
    // them to the account that owns them. Querying by device alone cannot prove
    // ownership and is refused, so a client must scope the read by its email.
    const e = (email || '').toLowerCase().trim();
    if (!e) return [];
    const snap = await getDocs(query(collection(db, COLLECTION), where('buyerEmail', '==', e)));
    return snap.docs.map((d) => ({ ...(d.data() as any) })) as PaymentSession[];
  } catch {
    return [];
  }
}

async function remoteListByEmail(email: string): Promise<PaymentSession[]> {
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), where('buyerEmail', '==', email.toLowerCase())));
    return snap.docs.map((d) => ({ ...(d.data() as any) })) as PaymentSession[];
  } catch {
    return [];
  }
}

export async function loadSessions(email?: string): Promise<PaymentSession[]> {
  const local = readLocalSessions();
  const remote = await remoteList(email);
  const merged: Map<string, PaymentSession> = new Map();
  local.forEach((s) => merged.set(s.id, s));
  remote.forEach((s) => merged.set(s.id, s));
  if (email) {
    const byEmail = await remoteListByEmail(email);
    byEmail.forEach((s) => merged.set(s.id, s));
  }
  return [...merged.values()].filter((s) => (s.status === 'active' || s.status === 'pending') && (!email || (s.buyerEmail || '').toLowerCase() === email.toLowerCase()));
}

// Full history (completed / cancelled included) for the profile page, matched by
// device + email so a customer can see every transaction they ever started.
export async function loadAllSessions(email?: string): Promise<PaymentSession[]> {
  const local = readLocalSessions();
  const remote = await remoteList(email);
  const merged: Map<string, PaymentSession> = new Map();
  local.forEach((s) => merged.set(s.id, s));
  remote.forEach((s) => merged.set(s.id, s));
  if (email) {
    const byEmail = await remoteListByEmail(email);
    byEmail.forEach((s) => merged.set(s.id, s));
  }
  return [...merged.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function createSession(input: Omit<PaymentSession, 'id' | 'deviceId' | 'createdAt' | 'updatedAt' | 'status'>): Promise<PaymentSession> {
  const now = Date.now();
  const s: PaymentSession = {
    ...input,
    id: genSessionId(),
    deviceId: getDeviceId(),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  if (s.buyerEmail) setLastEmail(s.buyerEmail);
  upsertLocal(s);
  await remoteSet(s);
  return s;
}

export async function updateSession(id: string, patch: Partial<PaymentSession>): Promise<void> {
  const local = getCachedSession(id);
  const next = { ...(local || ({ id } as PaymentSession)), ...patch, updatedAt: Date.now() };
  if (local) upsertLocal(next);
  else {
    const list = readLocalSessions();
    list.push(next);
    writeLocalSessions(list);
  }
  await remotePatch(id, { ...patch, updatedAt: Date.now() });
}

export async function completeSession(id: string): Promise<void> {
  await updateSession(id, { status: 'completed' });
}

// Withdraw/cancel a payment. The record is KEPT (status "cancelled") so the
// pending request row in My Transactions can still offer "Resume": during the
// plan-release wait period a client may step back at any time and continue a
// second time without losing the transaction.
export async function cancelSession(id: string): Promise<void> {
  await updateSession(id, { status: 'cancelled', activeUntil: Date.now() });
}

// Full cleanup (used when an email change starts a completely new transaction):
// the old record must disappear from every device, not remain as cancelled.
export async function discardSession(id: string): Promise<void> {
  await updateSession(id, { status: 'cancelled', activeUntil: Date.now() });
  removeLocal(id);
  await remoteDelete(id);
}

export async function getRemoteSession(id: string): Promise<PaymentSession | null> {
  try {
    const d = await getDoc(remoteRef(id));
    if (d.exists()) return d.data() as PaymentSession;
  } catch {}
  return null;
}