import { createBrowserRouter, type RouteObject } from 'react-router';

import { homeRoutes } from '@/modules/home/routes';
import { ErrorState } from '@/shared/components/ErrorState';

import { RouteError } from './RouteError';

/**
 * Every route of the app. Each module exports its own route array; adding a
 * feature is one import and one spread here. The catch-all comes last, and the
 * root `errorElement` catches any route that throws.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      ...homeRoutes,
      { path: '*', element: <ErrorState kind="not-found" /> },
    ],
  },
];

/** The browser router built from `routes`. */
export const router = createBrowserRouter(routes);
