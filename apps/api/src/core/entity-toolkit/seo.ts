/**
 * Core · entity-toolkit/seo.ts
 * SEO as a first-class Core capability (§34), not a storefront afterthought. An
 * entity declares it is SEO-eligible and automatically gets meta fields, sitemap
 * inclusion, JSON-LD and redirect management.
 * Layer: core.
 */

import type { StoreId } from '@deservefirst/contracts';

export interface SeoFields {
  readonly title: string | null;
  readonly description: string | null;
  readonly canonicalUrl: string | null;
  readonly ogImageUrl: string | null;
  readonly noIndex: boolean;
  readonly noFollow: boolean;
}

export const EMPTY_SEO: SeoFields = {
  title: null,
  description: null,
  canonicalUrl: null,
  ogImageUrl: null,
  noIndex: false,
  noFollow: false,
};

/** Search engines truncate beyond these; exceeding them wastes the snippet. */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

export interface SeoPreview {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly warnings: readonly string[];
}

/**
 * Builds the search-result preview shown on the detail screen, falling back to
 * the record's own title and body when SEO fields are blank — which is what the
 * merchant sees if they publish without filling them in.
 */
export function buildSeoPreview(input: {
  seo: SeoFields;
  fallbackTitle: string;
  fallbackDescription: string;
  storefrontUrl: string;
}): SeoPreview {
  const title = (input.seo.title ?? input.fallbackTitle).trim();
  const description = (input.seo.description ?? stripMarkup(input.fallbackDescription)).trim();
  const warnings: string[] = [];

  if (title.length === 0) warnings.push('Title is empty — search engines will invent one.');
  if (title.length > SEO_TITLE_MAX) {
    warnings.push(`Title is ${title.length} characters; it will be truncated near ${SEO_TITLE_MAX}.`);
  }
  if (description.length === 0) {
    warnings.push('Description is empty — the snippet will be pulled from page content.');
  }
  if (description.length > SEO_DESCRIPTION_MAX) {
    warnings.push(
      `Description is ${description.length} characters; it will be truncated near ${SEO_DESCRIPTION_MAX}.`,
    );
  }
  if (input.seo.noIndex) warnings.push('This page is set to noindex and will not appear in search.');

  return { title, url: input.storefrontUrl, description, warnings };
}

function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A slug change breaks every existing link, so the platform records a redirect
 * automatically rather than relying on the merchant to remember (§34.3).
 */
export interface UrlRedirect {
  readonly storeId: StoreId;
  readonly fromPath: string;
  readonly toPath: string;
  readonly statusCode: 301 | 302;
  readonly createdAt: Date;
}

export function redirectForHandleChange(
  storeId: StoreId,
  urlSegment: string,
  oldHandle: string,
  newHandle: string,
  now: Date,
): UrlRedirect | null {
  if (oldHandle === newHandle) return null;
  return {
    storeId,
    fromPath: `/${urlSegment}/${oldHandle}`,
    toPath: `/${urlSegment}/${newHandle}`,
    statusCode: 301,
    createdAt: now,
  };
}

/** Schema.org JSON-LD is what earns rich results (§34.2). */
export function buildJsonLd(input: {
  type: 'Product' | 'Article' | 'BlogPosting' | 'BreadcrumbList' | 'Organization' | 'WebSite';
  fields: Record<string, unknown>;
}): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@type': input.type, ...input.fields };
}

export interface SitemapEntry {
  readonly loc: string;
  readonly lastmod: string;
  readonly changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  readonly alternates?: readonly { hreflang: string; href: string }[];
}

/**
 * Large catalogs exceed the 50,000-URL sitemap limit, so entries are sharded
 * into sub-sitemaps per type (§34.1).
 */
export const SITEMAP_MAX_ENTRIES = 50_000;

export function shardSitemap(entries: readonly SitemapEntry[]): SitemapEntry[][] {
  const shards: SitemapEntry[][] = [];
  for (let index = 0; index < entries.length; index += SITEMAP_MAX_ENTRIES) {
    shards.push(entries.slice(index, index + SITEMAP_MAX_ENTRIES));
  }
  return shards.length > 0 ? shards : [[]];
}
