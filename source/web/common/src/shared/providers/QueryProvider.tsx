'use client';

import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

const STALE_TIME_MS = 60_000;

/**
 * Create a QueryClient with the application defaults.
 *
 * @returns A fresh client.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Get the client for this environment: a new one per request on the server,
 * one shared client in the browser.
 *
 * @returns The QueryClient to use.
 */
function getQueryClient(): QueryClient {
  if (isServer) return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

/**
 * Provide the QueryClient to the tree.
 *
 * @param props.children The tree that reads server state.
 */
export function QueryProvider({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
