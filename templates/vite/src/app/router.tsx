import { createBrowserRouter } from 'react-router';

import { homeRoutes } from '@/modules/home/routes';

/**
 * The only router file. Each module exports its own route array; adding a
 * feature is one import and one spread here.
 */
export const router = createBrowserRouter([...homeRoutes]);
