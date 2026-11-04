import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/shared/providers/AppProviders';
import '@/shared/styles/global.css';

export const metadata: Metadata = {
  title: 'App',
  description: 'A web app started from the project template.',
};

/**
 * Root layout: mounts the global providers around every route.
 *
 * @param props.children The current route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
