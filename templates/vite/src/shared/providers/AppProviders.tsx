'use client';

import type { PropsWithChildren } from 'react';

import { QueryProvider } from './QueryProvider';
import { ThemeVariables } from './ThemeVariables';
import { UiProvider } from './UiProvider';

/**
 * Compose every global provider in one place. The root layout (Next.js) or the
 * entry point (Vite) mounts this once; add a provider here, never beside it.
 *
 * @param props.children The application tree.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <UiProvider>
      <ThemeVariables />
      <QueryProvider>{children}</QueryProvider>
    </UiProvider>
  );
}
