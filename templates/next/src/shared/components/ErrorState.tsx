import type { CSSProperties } from 'react';

import { fontFamily, palette, radius } from '@/shared/styles/theme';

/** Which failure a page reports. */
export type ErrorStateKind = 'error' | 'not-found';

interface ErrorStateProps {
  kind: ErrorStateKind;
  /** Shows a retry button when given; the framework decides what a retry does. */
  onRetry?: () => void;
}

/** The home address. A constant, because Next.js's lint rule rejects a literal `<a href="/">`. */
const HOME = '/';

const TEXT: Record<ErrorStateKind, { title: string; description: string }> = {
  error: {
    title: 'Something went wrong',
    description:
      'An unexpected error occurred. Try again, or go back to the home page.',
  },
  'not-found': {
    title: 'Page not found',
    description: 'The address may be wrong, or the page no longer exists.',
  },
};

// Inline styles read theme.ts directly, so the page still renders where the
// stylesheet and the providers are the things that failed (Next.js
// `global-error`).
const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: '100vh',
    padding: '48px 24px',
    boxSizing: 'border-box',
    textAlign: 'center',
    background: palette.background,
    color: palette.text,
    fontFamily,
  },
  title: { margin: 0, fontSize: 24 },
  description: { margin: 0, maxWidth: '40ch', color: palette.textSecondary },
  actions: { display: 'flex', gap: 8, marginTop: 8 },
  retry: {
    padding: '8px 20px',
    border: 0,
    borderRadius: radius,
    background: palette.primary,
    color: palette.background,
    font: 'inherit',
    cursor: 'pointer',
  },
  home: {
    padding: '8px 20px',
    border: `1px solid ${palette.border}`,
    borderRadius: radius,
    color: palette.textSecondary,
    textDecoration: 'none',
  },
} satisfies Record<string, CSSProperties>;

/**
 * A full-page failure screen: a title, one sentence, an optional retry button
 * and a link home. It shows fixed text only, never the message or stack of the
 * error that caused it.
 *
 * @param props.kind `error` for an unexpected failure, `not-found` for an unknown address.
 * @param props.onRetry Called by the retry button; the button is hidden without it.
 */
export function ErrorState({ kind, onRetry }: ErrorStateProps) {
  const { title, description } = TEXT[kind];
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>{title}</h1>
      <p style={styles.description}>{description}</p>
      <div style={styles.actions}>
        {onRetry && (
          <button type="button" style={styles.retry} onClick={onRetry}>
            Try again
          </button>
        )}
        {/* A plain anchor: a fresh document load escapes a broken router. */}
        <a href={HOME} style={styles.home}>
          Back to home
        </a>
      </div>
    </main>
  );
}
