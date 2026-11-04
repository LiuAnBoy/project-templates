'use client';

import { cssVariables } from '@/shared/styles/theme';

/** The `:root` rule that publishes the theme as CSS custom properties. */
const css = `:root{${Object.entries(cssVariables)
  .map(([name, value]) => `${name}:${value}`)
  .join(';')}}`;

/**
 * Publish `shared/styles/theme.ts` as CSS custom properties on the root, in
 * the server-rendered HTML as well as in the browser. This is the only place
 * the variables are set; `global.css` reads them.
 */
export function ThemeVariables() {
  return <style>{css}</style>;
}
