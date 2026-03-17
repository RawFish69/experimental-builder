export const THEME_STORAGE_KEY = 'build-solver:theme-mode';

export type ThemeMode = 'dark' | 'light';

export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

function coerceThemeMode(value: string | null | undefined): ThemeMode {
  if (value === 'light') return 'light';
  if (value === 'daylight' || value === 'minimal') return 'light';
  return DEFAULT_THEME_MODE;
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_THEME_MODE;
  return coerceThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function persistThemeMode(themeMode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
}

export function applyThemeMode(themeMode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.wbTheme = themeMode;
}
