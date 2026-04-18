// One-time migration from old recifind-* identifiers to recifriend-*.
// Runs on app mount. Idempotent — safe to call repeatedly.
// Supabase auth session intentionally NOT migrated (its internal key format
// varies by version); users sign in again once. Everything else migrates.

const LOCAL_KEYS = [
  'recifind-recipes-cache-v2',
  'recifind-favorites',
  'recifind-pwa-used',
  'recifind-dark-mode',
  'recifind-install-banner-dismissed',
];

export function migrateLegacyStorage() {
  try {
    for (const oldKey of LOCAL_KEYS) {
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      const newKey = oldKey.replace(/^recifind-/, 'recifriend-');
      // Don't overwrite if already migrated (first-run on new install)
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, value);
      }
      localStorage.removeItem(oldKey);
    }

    // Cookie migration
    const cookies = document.cookie.split(';').map((s) => s.trim());
    for (const c of cookies) {
      if (c.startsWith('recifind-pwa-installed=')) {
        const value = c.split('=')[1] ?? '';
        document.cookie = `recifriend-pwa-installed=${value}; path=/; max-age=31536000`;
        document.cookie = 'recifind-pwa-installed=; path=/; max-age=0';
      }
    }
  } catch (err) {
    // localStorage can throw in private browsing / disabled states — silently skip
    console.warn('migrateLegacyStorage failed:', err);
  }
}
