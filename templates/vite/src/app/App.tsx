import { RouterProvider } from 'react-router/dom';

import { AppProviders } from '@/shared/providers/AppProviders';

import { router } from './router';

/** The application root: global providers around the router. */
export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
