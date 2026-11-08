/**
 * Per-account profile assets (photo, display name).
 *
 * These used to be stored in GLOBAL localStorage keys:
 *   finalyze_custom_avatar / finalyze_custom_name
 * so whatever the developer uploaded appeared on EVERY other account opened in
 * the same browser (logging out and signing in as a client kept showing the
 * developer's photo). Each value is now scoped by email.
 *
 * Backward compatibility: the old global keys are read ONCE for a developer
 * account and migrated to that account's own key, then deleted. They are never
 * read for a client, so a client can never inherit the developer's picture.
 * The app logo (finalyze_custom_logo) stays global on purpose: it is site
 * branding, not personal data.
 */

export type ProfileAsset = 'avatar' | 'name';

const LEGACY_KEY: Record<ProfileAsset, string> = {
  avatar: 'finalyze_custom_avatar',
  name: 'finalyze_custom_name',
};

export function profileEmail(email?: string | null): string {
  return String(email || '').toLowerCase().trim();
}

function scopedKey(kind: ProfileAsset, email: string): string {
  return `finalyze_custom_${kind}_${email}`;
}

/**
 * Read an asset for one account.
 * Only a developer gets the legacy global value (and it is migrated + removed
 * on first read), so old data survives without leaking to clients.
 */
export function readProfileAsset(
  kind: ProfileAsset,
  email: string | null | undefined,
  isDeveloper: boolean,
): string | null {
  const em = profileEmail(email);
  if (!em) return null;
  try {
    const own = localStorage.getItem(scopedKey(kind, em));
    if (own) return own;

    if (isDeveloper) {
      const legacy = localStorage.getItem(LEGACY_KEY[kind]);
      if (legacy) {
        // One-time migration: keep the developer's existing value, then drop
        // the shared copy so no other account can ever read it.
        localStorage.setItem(scopedKey(kind, em), legacy);
        localStorage.removeItem(LEGACY_KEY[kind]);
        return legacy;
      }
    }
  } catch {}
  return null;
}

/** Write (or clear, with a null/empty value) an asset for one account. */
export function writeProfileAsset(
  kind: ProfileAsset,
  email: string | null | undefined,
  value: string | null,
): void {
  const em = profileEmail(email);
  if (!em) return;
  try {
    if (value) localStorage.setItem(scopedKey(kind, em), value);
    else localStorage.removeItem(scopedKey(kind, em));
  } catch {}
}
