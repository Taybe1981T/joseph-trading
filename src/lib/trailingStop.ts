// ---------- Dynamic Trailing Stop (scales with lot size) ----------
//
// Rule (per the product owner, verified against their worked examples):
//   • Base lot 0.01 (one "unit" k=1):
//       - trailing ACTIVATES once open profit reaches $5  → stop jumps to breakeven (entry)
//       - from there the stop trails to (windows × $2) of LOCKED profit, where
//         windows = floor(profit / $5):
//         $10 (2×) → entry+4 · $15 (3×) → entry+6 · $20 (4×) → entry+8 …
//         (every extra full $5 of profit adds $2 of locked profit)
//   • Every extra 0.01 lot (k = lot / 0.01):
//       - activation  += $2  (5, 7, 9, …)      →  activation = 5 + 2*(k-1)
//       - step size   += $1  (2, 3, 4, …)      →  step       = 2 + 1*(k-1)
//   • The stop NEVER moves backwards (only ratchets toward profit).
//   • Works for both sides: buy trails the stop UP, sell trails it DOWN.
//
// This returns the stop as a PROFIT-OFFSET in USD relative to entry (0 = entry).
// The caller converts that USD offset into a price via usdToPrice() so the level
// is correct for every asset class (forex / metals / stocks / crypto).

export interface TrailingParams {
  qty: number;        // trade lot size (0.01, 0.03, 0.07 …)
  openPnlUSD: number; // current unrealised profit in USD (can be negative)
  baseActivationUSD?: number; // owner-tunable base activation at lot 0.01 (default 5)
  baseStepUSD?: number;       // owner-tunable base step at lot 0.01 (default 2)
  activationLotStep?: number; // extra activation per +0.01 lot (default 2)
  stepLotStep?: number;       // extra step per +0.01 lot (default 1)
}

export interface TrailingResult {
  active: boolean;    // has the trailing stop activated yet?
  offsetUSD: number;  // profit offset from entry to place the stop at (>= 0)
  activationUSD: number;
  stepUSD: number;
  k: number;
}

export function calcTrailingStop({ qty, openPnlUSD, baseActivationUSD = 5, baseStepUSD = 2, activationLotStep = 2, stepLotStep = 1 }: TrailingParams): TrailingResult {
  // k = how many 0.01-lot "units" this trade is (min 1).
  const k = Math.max(1, Math.round((qty || 0) / 0.01));
  // Owner-tunable scaling: base values hold at lot 0.01; every extra 0.01 unit
  // adds activationLotStep to the activation and stepLotStep to the step.
  // Default: 0.01→(5,2) · 0.02→(7,3) · 0.03→(9,4) …
  const activationUSD = baseActivationUSD + activationLotStep * (k - 1);
  const stepUSD = baseStepUSD + stepLotStep * (k - 1);

  // Not enough profit yet → trailing not engaged, keep original stop.
  if (openPnlUSD < activationUSD) {
    return { active: false, offsetUSD: 0, activationUSD, stepUSD, k };
  }

  // windows = how many full "activation" units of profit we have:
  //   profit $5  → 1 · $10 → 2 · $15 → 3 · $20 → 4 …   (k=1)
  const windows = Math.floor(openPnlUSD / activationUSD);
  // First window (profit in [activation, 2×activation)) only SECURES the trade at
  // breakeven (offset 0 → stop moves to entry). From the 2nd window onward the
  // stop trails to (windows × step) of LOCKED profit:
  //   10 → 2×2 = 4 · 15 → 3×2 = 6 · 20 → 4×2 = 8 …        (k=1, step=2)
  const offsetUSD = windows <= 1 ? 0 : windows * stepUSD;

  return { active: true, offsetUSD, activationUSD, stepUSD, k };
}
