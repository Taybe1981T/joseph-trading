type MiniStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const MIGRATION_KEY = 'retraceAllCategories_v1';
const CATEGORIES = ['Crypto', 'Stocks', 'Metals'] as const;

/**
 * One-time migration: make crypto / stocks / metals use the same lenient
 * forex-style Retrace rule that was producing good signals.
 *
 * It runs ONLY once. After that, the developer's manual ON/OFF switch is
 * respected: turning a category's filter OFF switches it back to the old
 * behaviour and the flag prevents this migration from re-enabling it.
 */
export function applyRetraceAllCategoriesMigration(
  merged: Record<string, any>,
  storage?: MiniStorage | null,
): boolean {
  const store: MiniStorage | null = storage !== undefined
    ? storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);

  let migrated = false;
  try { migrated = store?.getItem(MIGRATION_KEY) === '1'; } catch {}

  if (!migrated) {
    for (const category of CATEGORIES) {
      merged[`retraceFilterEnabled${category}`] = true;
      merged[`retraceCandles${category}`] = 1;
      merged[`retraceTimeframe${category}`] = '15m';
      merged[`retraceStrictMode${category}`] = false;
    }
    try { store?.setItem(MIGRATION_KEY, '1'); } catch {}
    return true;
  }
  return false;
}
