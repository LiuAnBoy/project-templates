import { ErrorState } from '@/shared/components/ErrorState';

/** The page for an address that matches no route. */
export default function NotFound() {
  return <ErrorState kind="not-found" />;
}
