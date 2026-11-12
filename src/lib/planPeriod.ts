// Shared client-side plan period maths. This mirrors the server's approval
// logic in api/server.ts (inferPlanUnit / planPeriodCount / addPlanPeriod) so a
// plan bought while another is still active always shows the SAME stacked end
// date on desktop and phone as the one the developer approval writes.

export type PlanUnit = 'hour' | 'day' | 'week' | 'month' | 'year';

/** Best-effort unit for a plan, from its explicit unit, label or durationDays. */
export function inferPlanUnit(planLabel: unknown, durationDays: unknown, explicit?: unknown): PlanUnit {
  const ex = String(explicit || '').toLowerCase().trim();
  if (ex === 'hour' || ex === 'hourly') return 'hour';
  if (ex === 'day' || ex === 'daily') return 'day';
  if (ex === 'week' || ex === 'weekly') return 'week';
  if (ex === 'month' || ex === 'monthly') return 'month';
  if (ex === 'year' || ex === 'yearly' || ex === 'annual') return 'year';
  const label = String(planLabel || '').toLowerCase();
  if (/يومي|يوميّة|يومياً|daily|single day|24 hour|24-hour/.test(label)) return 'day';
  if (/ساعة|ساعات|hourly|\bhour/.test(label)) return 'hour';
  if (/أسبوع|اسبوع|weekly|week/.test(label)) return 'week';
  if (/سنوي|سنوية|سنويا|yearly|annual|year/.test(label)) return 'year';
  if (/شهري|شهرية|شهريا|monthly|month/.test(label)) return 'month';
  const days = Number(durationDays || 0);
  if (days > 0 && days < 1) return 'hour';
  if (days === 1) return 'day';
  if (days > 1 && days <= 7) return 'week';
  if (days > 7 && days <= 31) return 'month';
  if (days > 31) return 'year';
  return 'month';
}

/** How many units a plan buys: explicit count, else derived from durationDays. */
export function planPeriodCount(unit: PlanUnit, durationDays: unknown, explicit?: unknown): number {
  const n = Number(explicit);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const days = Number(durationDays || 0);
  if (unit === 'hour' && days > 0) return Math.max(1, Math.round(days * 24));
  return 1;
}

/** Adds `count` whole calendar units to `fromMs`, in UTC, clamping the day. */
export function addPlanPeriod(fromMs: number, unit: PlanUnit, count = 1): number {
  const n = Number.isFinite(count) && count > 0 ? Math.round(count) : 1;
  const d = new Date(fromMs);
  if (unit === 'hour') { d.setUTCHours(d.getUTCHours() + n); return d.getTime(); }
  if (unit === 'day') { d.setUTCDate(d.getUTCDate() + n); return d.getTime(); }
  if (unit === 'week') { d.setUTCDate(d.getUTCDate() + 7 * n); return d.getTime(); }
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  d.setUTCDate(1);
  if (unit === 'month') d.setUTCMonth(month + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

export interface PlanPurchaseLike {
  label?: string;
  durationDays?: number;
  planUnit?: string;
  planUnits?: number;
}

/**
 * The end date a new plan purchase produces.
 *
 * When the client already has a valid plan (`currentExpiry` in the future) the
 * new period is added to that end date, so durations stack cumulatively with no
 * cap. Otherwise it starts from now.
 */
export function stackedPlanExpiry(
  currentExpiry: string | number | Date | null | undefined,
  plan: PlanPurchaseLike,
  nowMs: number = Date.now(),
): Date {
  const unit = inferPlanUnit(plan.label, plan.durationDays, plan.planUnit);
  const count = planPeriodCount(unit, plan.durationDays, plan.planUnits);
  let base = nowMs;
  if (currentExpiry) {
    const cur = new Date(currentExpiry).getTime();
    if (Number.isFinite(cur) && cur > nowMs) base = cur;
  }
  return new Date(addPlanPeriod(base, unit, count));
}
