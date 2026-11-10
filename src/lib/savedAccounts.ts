/**
 * Saved sign-in emails for THIS browser only.
 *
 * Nothing here is an identity: it is just a list of addresses the visitor has
 * used before (bought a plan, signed in with Google, opened a payment session).
 * The auth modal shows them so a returning client can pick their account and go
 * straight to the Google account chooser instead of typing anything.
 *
 * Never store passwords or tokens here — this file only keeps email strings.
 */

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function pushEmail(out: string[], value: unknown): void {
  const e = String(value || '').toLowerCase().trim();
  if (!e || !VALID_EMAIL.test(e)) return;
  if (!out.includes(e)) out.push(e);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Every email this browser knows about, most-recently-used first.
 * Order: live/last session → saved accounts → purchase emails → payment email.
 */
export function readSavedEmails(): string[] {
  const out: string[] = [];

  // 1. The account that was signed in last (or the cached session).
  const authUser = readJson<{ email?: string }>('finalyze_auth_user');
  pushEmail(out, authUser?.email);
  const user = readJson<{ email?: string }>('finalyze_user');
  pushEmail(out, user?.email);

  // 2. Accounts explicitly saved on this device (mobile login modal writes it).
  const saved = readJson<unknown>('finalyze_saved_accounts');
  if (Array.isArray(saved)) saved.forEach((e) => pushEmail(out, e));

  // 3. The buyer identity a purchase created for this browser.
  const creds = readJson<{ email?: string }>('finalyze_client_credentials');
  pushEmail(out, creds?.email);

  // 4. Payment emails typed at checkout.
  const buyers = readJson<unknown>('finalyze_plan_buyer_emails');
  if (Array.isArray(buyers)) buyers.forEach((e) => pushEmail(out, e));
  const buyerMap = readJson<Record<string, unknown>>('finalyze_plan_buyer_emails_by_account');
  if (buyerMap && typeof buyerMap === 'object') {
    Object.keys(buyerMap).forEach((k) => pushEmail(out, k));
    Object.values(buyerMap).forEach((v) => {
      if (Array.isArray(v)) v.forEach((e) => pushEmail(out, e));
    });
  }
  pushEmail(out, localStorage.getItem('finalyze_last_payment_email'));

  // 5. Locally registered client rows.
  const clientEmails = readJson<unknown>('finalyze_client_emails');
  if (Array.isArray(clientEmails)) {
    clientEmails.forEach((c: any) => pushEmail(out, typeof c === 'string' ? c : c?.email));
  }

  return out.slice(0, 8);
}

/** Remember an email after a successful sign-in so the modal can offer it later. */
export function rememberSavedEmail(email: string | null | undefined): void {
  const e = String(email || '').toLowerCase().trim();
  if (!e || !VALID_EMAIL.test(e)) return;
  try {
    const raw = localStorage.getItem('finalyze_saved_accounts');
    const list: unknown = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(list) ? list.map((x) => String(x).toLowerCase().trim()) : [];
    const next = [e, ...arr.filter((x) => x && x !== e)].slice(0, 8);
    localStorage.setItem('finalyze_saved_accounts', JSON.stringify(next));
  } catch {}
}
