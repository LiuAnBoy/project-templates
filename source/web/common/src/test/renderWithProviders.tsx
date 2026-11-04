import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';

import { AppProviders } from '@/shared/providers/AppProviders';

/**
 * Render a component inside the real `AppProviders`, so it works with any UI
 * library. A fresh QueryClient, with retries off and no cache lifetime, sits
 * inside, so no query result leaks between tests.
 *
 * UI libraries read `window.matchMedia`, which jsdom lacks: call
 * `installMatchMedia()` from `./matchMedia` first when the provider needs it.
 *
 * @param ui The element to render.
 * @param options Testing Library render options, except `wrapper`.
 * @returns The Testing Library result plus the `queryClient` in use.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <AppProviders>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </AppProviders>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
