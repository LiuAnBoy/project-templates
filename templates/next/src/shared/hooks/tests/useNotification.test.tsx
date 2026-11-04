import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiProvider } from '@/shared/providers/UiProvider';

import { useNotification, type Notification } from '../useNotification';

/**
 * Render the hook inside the UI provider and expose what it returns.
 *
 * @returns Every value the hook returned, in render order.
 */
function renderNotification() {
  const seen: Notification[] = [];
  function Probe() {
    seen.push(useNotification());
    return null;
  }
  render(
    <UiProvider>
      <Probe />
    </UiProvider>,
  );
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useNotification', () => {
  it('returns exactly success, error, warning and info', () => {
    const seen = renderNotification();
    expect(Object.keys(seen.at(-1)!).sort()).toEqual([
      'error',
      'info',
      'success',
      'warning',
    ]);
  });

  it.each(['success', 'error', 'warning', 'info'] as const)(
    'shows a %s notification and removes it after a few seconds',
    (method) => {
      const seen = renderNotification();
      act(() => seen.at(-1)![method](`message ${method}`));
      expect(screen.getByText(`message ${method}`)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByText(`message ${method}`)).not.toBeInTheDocument();
    },
  );
});
