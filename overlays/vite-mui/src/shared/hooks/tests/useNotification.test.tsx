import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UiProvider } from '@/shared/providers/UiProvider';

import { useNotification, type Notification } from '../useNotification';

/**
 * Render the hook inside the UI provider and expose what it returns.
 *
 * @returns Every value the hook returned, in render order, and the view.
 */
function renderNotification() {
  const seen: Notification[] = [];
  function Probe() {
    seen.push(useNotification());
    return null;
  }
  const view = render(
    <UiProvider>
      <Probe />
    </UiProvider>,
  );
  return { seen, view };
}

describe('useNotification', () => {
  it('returns exactly success, error, warning and info', () => {
    const { seen } = renderNotification();
    expect(Object.keys(seen.at(-1)!).sort()).toEqual([
      'error',
      'info',
      'success',
      'warning',
    ]);
  });

  it('returns the same object between renders', () => {
    const { seen, view } = renderNotification();
    view.rerender(
      <UiProvider>
        <span />
      </UiProvider>,
    );
    expect(new Set(seen).size).toBe(1);
  });

  it.each(['success', 'error', 'warning', 'info'] as const)(
    'shows a %s notification',
    async (method) => {
      const { seen } = renderNotification();
      act(() => seen.at(-1)![method](`message ${method}`));
      expect(await screen.findByText(`message ${method}`)).toBeInTheDocument();
    },
  );
});
