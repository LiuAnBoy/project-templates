import { createTheme } from '@mui/material/styles';

/**
 * The one source of every site-wide design value: the palette, radius and font
 * below, then the MUI theme built from them. `UiProvider` passes `theme` to
 * `ThemeProvider`; `ThemeVariables` publishes `cssVariables` for `global.css`.
 * Change values here, never as literals in components or `sx`.
 */

/** Brand and surface colours. */
export const palette = {
  primary: '#0b5fa5',
  background: '#ffffff',
  surface: '#f8fafc',
  text: '#14213d',
  textSecondary: '#475569',
  border: '#e2e8f0',
};

/** Corner radius in pixels. */
export const radius = 8;

/** Font family of the whole site. */
export const fontFamily =
  "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', sans-serif";

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
};

/** The MUI theme, passed to `ThemeProvider` in `UiProvider`. */
export const theme = createTheme({
  palette: {
    primary: { main: palette.primary },
    background: { default: palette.background, paper: palette.surface },
    text: { primary: palette.text, secondary: palette.textSecondary },
    divider: palette.border,
  },
  shape: { borderRadius: radius },
  typography: { fontFamily },
});
