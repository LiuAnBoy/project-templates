'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/shared/components/ErrorState';

/**
 * The last boundary, for an error in the root layout itself. It replaces the
 * root layout, so it renders its own `<html>` and `<body>` and reaches no
 * provider and no stylesheet; `ErrorState` styles itself from `theme.ts` for
 * that reason.
 *
 * @param props.error The error that was thrown; logged, never shown.
 * @param props.reset Re-renders the root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ErrorState kind="error" onRetry={reset} />
      </body>
    </html>
  );
}
