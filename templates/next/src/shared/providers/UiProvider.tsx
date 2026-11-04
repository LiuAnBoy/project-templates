'use client';

import type { PropsWithChildren } from 'react';

/**
 * The slot for a UI library's provider. This base ships no UI library, so it
 * renders its children untouched. A UI overlay replaces this one file with the
 * library's provider; `AppProviders` composes it and needs no change.
 *
 * @param props.children The application tree.
 */
export function UiProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}
