import { RouterProvider } from 'react-router/dom';

import { AppProviders } from '@/shared/providers/AppProviders';

import { ErrorBoundary } from './ErrorBoundary';
import { router } from './router';

/** The application root: the error boundary, the global providers, the router. */
export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}
