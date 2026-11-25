/**
 * Dynamic Trailing Stop — driven by ACCOUNT BALANCE, not lot size.
 *
 * Rule (product owner, applied identically to every category):
 *   • At $1,000 balance: step $5, effective activation $5.
 *   • Every extra $1,000 of balance: +$5 activation and +$2 step, and the
 *     activation can never drop below one full step.
 *       $1,000  -> activation  5 / step  5
 *       $2,000  -> activation  7 / step  7
 *       $10,000 -> activation 45 / step 23
 *
 * The old lot-based scaling (k = qty / baseUnit) is intentionally removed: it
 * made the same $10,000 account get wildly different trailing values across
 * categories (crypto 0.1-lot vs metals 0.01-lot) and closed trades early.
 *
 * CRITICAL: the stop is NEVER parked at the entry price. Previously the first
 * window returned offsetUSD = 0, so a tiny retrace closed the trade at (or just
 * below) breakeven while the original SL/TP were still far away. Now the trail
 * only arms after at least one full step of profit, and each completed window
 * locks at least one full step of profit.
 *
 * `qty`, `baseUnit`, `activationLotStep`, `stepLotStep`, `baseActivationUSD`
 * and `baseStepUSD` remain in the signature for backwards compatibility with
 * older callers, but are IGNORED — balance is the only input that scales.
 */

export interface TrailingParams {
  qty: number;                    // kept for compatibility, no longer scales
  openPnlUSD: number;             // current unrealised profit in USD
  balance: number;                // account balance — the only scaling input
  baseActivationUSD?: number;     // deprecated / ignored
  baseStepUSD?: number;           // deprecated / ignored
  activationLotStep?: number;     // deprecated / ignored
  stepLotStep?: number;           // deprecated / ignored
  baseUnit?: number;              // deprecated / ignored
}

export interface TrailingResult {
  active: boolean;    // has the trailing stop activated yet?
  offsetUSD: number;  // profit offset from entry to place the stop at (>= stepUSD when active)
  activationUSD: number; // effective activation = never below one full step
  stepUSD: number;
  k: number;          // now the balance multiplier (1 at $1,000, 10 at $10,000)
}

/** Base values at a $1,000 balance. The raw activation 0 is floored by one step. */
export const TRAILING_BASE_ACTIVATION_USD = 0;
export const TRAILING_BASE_STEP_USD = 5;
/** Increments for every additional $1,000 of balance. */
export const TRAILING_ACTIVATION_PER_1K_USD = 5;
export const TRAILING_STEP_PER_1K_USD = 2;

export function calcTrailingStop({
  openPnlUSD,
  balance,
}: TrailingParams): TrailingResult {
  const b = Number.isFinite(balance) && balance > 0 ? balance : 1000;
  const k = Math.max(1, Math.floor(b / 1000));
  const extra = k - 1;
  const rawActivationUSD = Math.max(0, TRAILING_BASE_ACTIVATION_USD + TRAILING_ACTIVATION_PER_1K_USD * extra);
  const stepUSD = Math.max(0.01, TRAILING_BASE_STEP_USD + TRAILING_STEP_PER_1K_USD * extra);

  // Never arm on a trivial profit and never park the stop at entry: at least
  // one full step of profit is required, and that step is locked immediately.
  const activationUSD = Math.max(rawActivationUSD, stepUSD);

  if (!(openPnlUSD >= activationUSD)) {
    return { active: false, offsetUSD: 0, activationUSD, stepUSD, k };
  }

  const windows = Math.floor(openPnlUSD / activationUSD);
  const offsetUSD = windows * stepUSD;

  return { active: true, offsetUSD, activationUSD, stepUSD, k };
}
