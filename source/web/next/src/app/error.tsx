'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/shared/components/ErrorState';

/**
 * The error boundary of every route below the root layout. Next.js passes the
 * error and a `reset` that re-renders the failed segment.
 *
 * @param props.error The error that was thrown; logged, never shown.
 * @param props.reset Re-renders the segment.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState kind="error" onRetry={reset} />;
}
