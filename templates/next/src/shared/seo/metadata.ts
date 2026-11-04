import type { Metadata } from 'next';

import { SITE } from './site';

interface PageMetadataInput {
  /** Page title; the root layout's template adds the site title. Omit for the home page. */
  title?: string;
  /** Defaults to the site description. */
  description?: string;
  /** Site-relative path of the page, used as the canonical link. */
  path: string;
  /** Open Graph type. Defaults to `website`. */
  type?: 'website' | 'article';
  /** Absolute or site-relative URL of a share image. */
  image?: string;
}

/**
 * Build the metadata a public page needs: title, description, canonical, Open
 * Graph and Twitter. A page-level `openGraph` or `twitter` replaces the root
 * layout's whole object, so every field the layout would set is repeated here.
 *
 * @param input The page's title, description, path, type and share image.
 * @returns The Next.js metadata to export from a page.
 */
export function pageMetadata({
  title,
  description = SITE.description,
  path,
  type = 'website',
  image,
}: PageMetadataInput): Metadata {
  const shareTitle = title ? `${title} | ${SITE.title}` : SITE.title;
  const images = image ? [image] : undefined;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      siteName: SITE.title,
      url: path,
      title: shareTitle,
      description,
      images,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: shareTitle,
      description,
      images,
    },
  };
}
