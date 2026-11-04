import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/shared/providers/AppProviders';
import { SITE } from '@/shared/seo/site';
import '@/shared/styles/global.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: `%s | ${SITE.title}` },
  description: SITE.description,
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
