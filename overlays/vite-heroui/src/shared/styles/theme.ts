/**
 * The one source of every site-wide design value: the palette, radius and font
 * below, mapped onto HeroUI's own CSS variables. `ThemeVariables` publishes
 * `cssVariables` on the root, unlayered, so they override HeroUI's defaults.
 * Change values here, never as literals in components or in `global.css`.
 */

/** Brand and surface colours. */
export const palette = {
  primary: '#2563eb',
  background: '#ffffff',
  surface: '#f8fafc',
  text: '#0f172a',
  textSecondary: '#475569',
  border: '#e2e8f0',
};

/** Corner radius in pixels. */
export const radius = 8;

/** Font family of the whole site. */
export const fontFamily =
  "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', sans-serif";

/** Toast settings that live in code: where the host sits, how many show, how long. */
export const TOAST_PLACEMENT = 'top end' as const;
export const TOAST_MAX_VISIBLE = 3;
export const TOAST_TIMEOUT_MS = 4000;

/** The values above as CSS custom properties, set once on the root by `ThemeVariables`. */
export const cssVariables: Record<string, string> = {
  '--theme-primary': palette.primary,
  '--theme-background': palette.background,
  '--theme-surface': palette.surface,
  '--theme-text': palette.text,
  '--theme-text-secondary': palette.textSecondary,
  '--theme-border': palette.border,
  '--theme-radius': `${radius}px`,
  '--theme-font-family': fontFamily,
  // HeroUI tokens, mapped from the palette.
  '--accent': palette.primary,
  '--background': palette.background,
  '--foreground': palette.text,
  '--surface': palette.surface,
  '--muted': palette.textSecondary,
  '--border': palette.border,
  '--radius': `${radius / 16}rem`,
};
