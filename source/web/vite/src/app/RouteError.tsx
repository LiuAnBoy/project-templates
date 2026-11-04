import { useEffect } from 'react';
import { useRouteError } from 'react-router';

import { ErrorState } from '@/shared/components/ErrorState';

/**
 * The router's `errorElement`: shown when a route throws while rendering or
 * loading. React Router has no reset, so the retry reloads the page.
 */
export function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState kind="error" onRetry={() => window.location.reload()} />;
}
