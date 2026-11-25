/**
 * Pure category-toggle logic for the mobile auto-analysis settings.
 *
 * The old code hard-coded `list.length === 4 ? 'all' : list.join(',')`. As soon
 * as a "Custom" group appeared (5 boxes), deselecting one category left 4 boxes
 * selected and wrote `'all'` back — so the boxes looked frozen. Deriving `all`
 * from the actually visible groups fixes that for every account.
 */

export function toggleRadarCategory(
  current: string | undefined,
  groupIds: readonly string[],
  id: string,
): string {
  const all = groupIds.filter(Boolean);
  const selected = current === 'all'
    ? [...all]
    : String(current || '').split(',').filter((x) => all.includes(x));

  let next: string[];
  if (selected.includes(id)) {
    // Keep at least one category so the radar always has work to do.
    if (selected.length === 1) return selected[0];
    next = selected.filter((x) => x !== id);
  } else {
    next = all.filter((x) => x === id || selected.includes(x));
  }

  const ordered = all.filter((x) => next.includes(x));
  return ordered.length === all.length ? 'all' : ordered.join(',');
}
