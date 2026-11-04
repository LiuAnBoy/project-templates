import { useSyncExternalStore } from 'react';

/**
 * Track whether a CSS media query matches.
 *
 * Renders as `false` on the server and during hydration, then follows the
 * browser, so markup that depends on it should tolerate a first `false`.
 *
 * @param query A media query such as `(min-width: 768px)`.
 * @returns True while the query matches.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
