export function normalizeHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  return clean.trim() ? clean : null;
}

export function getLegacyBuilderUrl(hash?: string | null): string {
  const clean = normalizeHash(hash);
  if (typeof window === 'undefined') {
    const base = 'builder/';
    return clean ? `${base}#${clean}` : base;
  }

  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // In local dev, there is no bundled legacy site – open the upstream Wynnbuilder instead.
  if (isDev) {
    const base = 'https://hppeng-wynn.github.io/builder/';
    return clean ? `${base}#${clean}` : base;
  }

  // On the deployed site, use the legacy-compatible builder under /builder/.
  const base = new URL('builder/', window.location.href).href;
  return clean ? `${base}#${clean}` : base;
}
