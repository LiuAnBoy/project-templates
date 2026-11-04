import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../ErrorBoundary';
import { RouteError } from '../RouteError';
import { routes } from '../router';

let broken = true;

/** Throws while `broken` is true. */
function Boom() {
  if (broken) throw new Error('secret detail');
  return <p>recovered</p>;
}

beforeEach(() => {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('error pages', () => {
  it('renders the error page when a route throws, and hides the message', () => {
    const router = createMemoryRouter(
      [
        {
          errorElement: <RouteError />,
          children: [{ path: '/', element: <Boom /> }],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument();
  });

  it('renders the error page for a render error outside the routes and retries', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('renders not-found for an unknown route of the app', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/no-such-page'],
    });
    render(<RouterProvider router={router} />);
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });
});
