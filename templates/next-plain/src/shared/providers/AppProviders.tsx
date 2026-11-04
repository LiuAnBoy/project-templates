'use client';

import type { PropsWithChildren } from 'react';

import { QueryProvider } from './QueryProvider';

/**
 * Compose every global provider in one place. The root layout (Next.js) or the
 * entry point (Vite) mounts this once; add a provider here, never beside it.
 *
 * @param props.children The application tree.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return <QueryProvider>{children}</QueryProvider>;
}
