export function normalizeHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  return clean.trim() ? clean : null;
}

export function getLegacyBuilderUrl(hash?: string | null): string {
  const clean = normalizeHash(hash);
  const base = '../builder/';
  return clean ? `${base}#${clean}` : base;
}
