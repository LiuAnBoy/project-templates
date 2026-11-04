import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ErrorPage from '../error';
import NotFound from '../not-found';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('error pages', () => {
  it('renders the error page for a thrown error, logs it and hides its message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();
    const error = new Error('secret detail');
    render(<ErrorPage error={error} reset={reset} />);

    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(error);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('renders the not-found page', () => {
    render(<NotFound />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
