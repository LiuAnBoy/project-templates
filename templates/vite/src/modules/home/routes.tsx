import type { RouteObject } from 'react-router';

import { HomePage } from './components/HomePage';

/** Routes owned by the home module. */
export const homeRoutes: RouteObject[] = [{ path: '/', element: <HomePage /> }];
