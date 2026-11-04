import { HomePage } from '@/modules/home';
import { pageMetadata } from '@/shared/seo/metadata';

export const metadata = pageMetadata({ path: '/' });

/** The `/` route: renders the home module and nothing else. */
export default function Page() {
  return <HomePage />;
}
