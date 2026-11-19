/**
 * Dynamic Trailing Stop — driven by ACCOUNT BALANCE, not lot size.
 *
 * Rule (product owner, applied identically to every category):
 *   • At $1,000 balance: activation $0, step $5.
 *   • Every extra $1,000 of balance: +$5 activation and +$2 step.
 *       $1,000  -> activation  0 / step  5
 *       $2,000  -> activation  5 / step  7
 *       $10,000 -> activation 45 / step 23
 *
 * The old lot-based scaling (k = qty / baseUnit) is intentionally removed: it
 * made the same $10,000 account get wildly different trailing values across
 * categories (crypto 0.1-lot vs metals 0.01-lot) and closed trades early.
 *
 * Activation 0 means the trail arms at the first positive profit. To avoid a
 * divide-by-zero, the window unit then falls back to the step size, and the
 * first completed window only secures breakeven (never the whole profit).
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
  offsetUSD: number;  // profit offset from entry to place the stop at (>= 0)
  activationUSD: number;
  stepUSD: number;
  k: number;          // now the balance multiplier (1 at $1,000, 10 at $10,000)
}

/** Base values at a $1,000 balance. */
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
  const activationUSD = Math.max(0, TRAILING_BASE_ACTIVATION_USD + TRAILING_ACTIVATION_PER_1K_USD * extra);
  const stepUSD = Math.max(0.01, TRAILING_BASE_STEP_USD + TRAILING_STEP_PER_1K_USD * extra);

  // No profit yet → keep the original stop. With a zero activation we still
  // require a strictly positive P/L so we never move a stop on a flat trade.
  if (openPnlUSD < activationUSD || (activationUSD <= 0 && !(openPnlUSD > 0))) {
    return { active: false, offsetUSD: 0, activationUSD, stepUSD, k };
  }

  // windows = completed profit units. Normal case: divide by the activation.
  // Zero-activation case: divide by the step so the math stays finite.
  const windowUSD = activationUSD > 0 ? activationUSD : stepUSD;
  const windows = Math.floor(openPnlUSD / windowUSD);

  // First window only secures breakeven. Afterwards the stop ratchets by one
  // locked-profit step per window. With activation 0 the extra (windows - 1)
  // keeps one full step of breathing room between price and the stop.
  const offsetUSD = activationUSD > 0
    ? (windows <= 1 ? 0 : windows * stepUSD)
    : (windows <= 1 ? 0 : (windows - 1) * stepUSD);

  return { active: true, offsetUSD, activationUSD, stepUSD, k };
}
