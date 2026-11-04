/**
 * The one source of every site-wide design value: colours, radius and font.
 * `ThemeVariables` publishes `cssVariables` as CSS custom properties on the
 * root, and `global.css` reads them. Change a value here, never as a literal
 * in a module or a shared component.
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

/** The values above as CSS custom properties, set once on the root. */
export const cssVariables: Record<string, string> = {
  '--theme-primary': palette.primary,
  '--theme-background': palette.background,
  '--theme-surface': palette.surface,
  '--theme-text': palette.text,
  '--theme-text-secondary': palette.textSecondary,
  '--theme-border': palette.border,
  '--theme-radius': `${radius}px`,
  '--theme-font-family': fontFamily,
};
