/**
 * Pure helper: copy only the explicitly allowed shared settings into local
 * storage and report which keys actually changed.
 *
 * Used by the read-only CLIENT mirror of the developer's entry settings. It
 * never writes to Firestore and never touches keys outside `keys`.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function applySharedValues(
  values: unknown,
  keys: readonly string[],
  storage: KeyValueStore,
): string[] {
  if (!values || typeof values !== 'object') return [];
  const record = values as Record<string, unknown>;
  const changed: string[] = [];
  for (const key of keys) {
    const incoming = record[key];
    if (typeof incoming !== 'string') continue;
    let current: string | null = null;
    try { current = storage.getItem(key); } catch { current = null; }
    if (current === incoming) continue;
    try {
      storage.setItem(key, incoming);
      changed.push(key);
    } catch {
      // A private-mode/full storage failure must not break the app.
    }
  }
  return changed;
}
