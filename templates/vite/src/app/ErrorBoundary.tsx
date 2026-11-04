import { Component, type ErrorInfo, type PropsWithChildren } from 'react';

import { ErrorState } from '@/shared/components/ErrorState';

/**
 * Catches a render error anywhere below it, logs it and shows the error page
 * with a retry that renders the children again. Route errors are caught
 * earlier by the router's `errorElement` (`RouteError`); this boundary covers
 * what sits outside the routes.
 */
export class ErrorBoundary extends Component<
  PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          kind="error"
          onRetry={() => this.setState({ failed: false })}
        />
      );
    }
    return this.props.children;
  }
}
