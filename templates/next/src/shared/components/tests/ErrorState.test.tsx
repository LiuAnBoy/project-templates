import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
  it('shows the error text and calls onRetry from the retry button', () => {
    const onRetry = vi.fn();
    render(<ErrorState kind="error" onRetry={onRetry} />);
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the not-found text with a link home and no retry button', () => {
    render(<ErrorState kind="not-found" />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
