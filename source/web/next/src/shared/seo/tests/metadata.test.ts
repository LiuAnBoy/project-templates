import { describe, expect, it } from 'vitest';

import { pageMetadata } from '../metadata';
import { SITE } from '../site';

describe('pageMetadata', () => {
  it('sets canonical, Open Graph and Twitter from the site constant', () => {
    const metadata = pageMetadata({ path: '/' });
    expect(metadata.title).toBeUndefined();
    expect(metadata.description).toBe(SITE.description);
    expect(metadata.alternates?.canonical).toBe('/');
    expect(metadata.openGraph).toMatchObject({
      url: '/',
      title: SITE.title,
      siteName: SITE.title,
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary' });
  });

  it('prefixes the page title in the share title and uses the large card with an image', () => {
    const metadata = pageMetadata({
      title: 'About',
      path: '/about',
      image: '/share.png',
    });
    expect(metadata.title).toBe('About');
    expect(metadata.openGraph).toMatchObject({
      title: `About | ${SITE.title}`,
      images: ['/share.png'],
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});
