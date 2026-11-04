import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { AppProviders } from '@/shared/providers/AppProviders';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial location of the memory router. Defaults to `/`. */
  route?: string;
}

/**
 * Render a component inside the real `AppProviders` and a memory router, so
 * it works with any UI library. A fresh QueryClient, with retries off and no
 * cache lifetime, sits inside, so no query result leaks between tests.
 *
 * UI libraries read `window.matchMedia`, which jsdom lacks: call
 * `installMatchMedia()` from `./matchMedia` first when the provider needs it.
 *
 * @param ui The element to render.
 * @param options Testing Library render options, except `wrapper`, plus `route`.
 * @returns The Testing Library result plus the `queryClient` in use.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: RenderWithProvidersOptions = {},
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
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </QueryClientProvider>
      </AppProviders>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}
