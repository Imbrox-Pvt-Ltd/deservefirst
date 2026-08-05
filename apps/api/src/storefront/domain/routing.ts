/**
 * Storefront · domain/routing.ts
 * A storefront URL, read into a page request.
 *
 * The paths are the reference product's exactly, because they are not ours to
 * choose: a merchant migrating brings ranked links, printed cards and other
 * people's bookmarks, and `/products/{handle}` that became `/product/{handle}`
 * is a store that lost its search traffic on launch day.
 *
 * Pure, and deliberately does no loading. It answers "what kind of page is this
 * and what is it about" — the caller then loads the record and finds out
 * whether it exists. Keeping those apart is what lets the whole routing table
 * be tested without a database.
 * Layer: domain (pure).
 */

import type { PageType } from './template-resolution';

export interface RouteMatch {
  readonly pageType: PageType;
  /** The record this page is about, where there is one. */
  readonly handle?: string;
  /** For an article: the blog it belongs to. */
  readonly parentHandle?: string;
  /** A collection filtered to a tag: `/collections/shirts/blue+cotton`. */
  readonly tags?: readonly string[];
  /** Account pages, which are not themed page types. */
  readonly account?: string;
  /** `/products/x.json` and friends — a format the storefront may refuse. */
  readonly format?: string;
}

/**
 * Splits a path into clean segments.
 *
 * Empty segments are dropped so `//products//x` reads the same as
 * `/products/x`; a router that treated them differently would give one product
 * two URLs and hand the SEO work a duplicate to resolve.
 */
function segmentsOf(path: string): string[] {
  return path
    .split('?')[0]!
    .split('#')[0]!
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

/** Strips and reports a trailing `.json`-style extension. */
function splitFormat(segment: string): { name: string; format?: string } {
  const dot = segment.lastIndexOf('.');
  if (dot <= 0) return { name: segment };
  const extension = segment.slice(dot + 1).toLowerCase();
  // Only formats a storefront might serve. A handle legitimately containing a
  // dot — "3.5-inch-widget" — must not lose its tail.
  if (!['json', 'xml', 'atom', 'rss'].includes(extension)) return { name: segment };
  return { name: segment.slice(0, dot), format: extension };
}

/**
 * Matches a storefront path.
 *
 * Returns `404` rather than null for anything unrecognised, because a
 * storefront always has an answer — the theme's own 404 template — and a null
 * would make every caller reinvent that.
 */
export function matchRoute(path: string): RouteMatch {
  const segments = segmentsOf(path);

  if (segments.length === 0) return { pageType: 'index' };

  const [first, second, third] = segments as [string, string?, string?];

  switch (first) {
    case 'products': {
      if (!second) return { pageType: '404' };
      const { name, format } = splitFormat(second);
      return { pageType: 'product', handle: name, ...(format ? { format } : {}) };
    }

    case 'collections': {
      if (!second) return { pageType: 'list-collections' };

      const { name, format } = splitFormat(second);

      /**
       * `/collections/{handle}/products/{handle}` is a product reached through
       * a collection — the URL `within` builds, and the one a "next product"
       * link uses. It has to be checked before the third segment is read as a
       * tag filter, or every such link 404s.
       */
      if (third === 'products' && segments[3]) {
        const product = splitFormat(segments[3]);
        return {
          pageType: 'product',
          handle: product.name,
          parentHandle: name,
          ...(product.format ? { format: product.format } : {}),
        };
      }

      /** Otherwise a third segment is a `+`-separated tag filter. */

      return {
        pageType: 'collection',
        handle: name,
        ...(third ? { tags: third.split('+').filter(Boolean) } : {}),
        ...(format ? { format } : {}),
      };
    }

    case 'pages': {
      if (!second) return { pageType: '404' };
      const { name, format } = splitFormat(second);
      return { pageType: 'page', handle: name, ...(format ? { format } : {}) };
    }

    case 'blogs': {
      if (!second) return { pageType: '404' };
      const blog = splitFormat(second);
      if (!third) return { pageType: 'blog', handle: blog.name, ...(blog.format ? { format: blog.format } : {}) };
      const article = splitFormat(third);
      return {
        pageType: 'article',
        handle: article.name,
        parentHandle: blog.name,
        ...(article.format ? { format: article.format } : {}),
      };
    }

    case 'search':
      return { pageType: 'search' };

    case 'cart':
      return { pageType: 'cart' };

    case 'password':
      return { pageType: 'password' };

    case 'account':
      // Account pages are served by the platform rather than by a theme
      // template; the caller decides what to do with them.
      return { pageType: 'index', account: second ?? 'index' };

    default:
      return { pageType: '404' };
  }
}

/**
 * The canonical path for a match.
 *
 * One page, one URL. A product reachable through a collection has two paths and
 * must declare which is canonical, or a search engine treats the collection
 * variants as duplicates and ranks none of them — the exact problem PLAN/07
 * lists under SEO.
 */
export function canonicalPath(match: RouteMatch): string {
  switch (match.pageType) {
    case 'index':
      return '/';
    case 'product':
      // Deliberately without the collection prefix, even when reached through
      // one.
      return `/products/${match.handle}`;
    case 'collection':
      // Tag filters are a view of the collection, not their own page.
      return `/collections/${match.handle}`;
    case 'list-collections':
      return '/collections';
    case 'page':
      return `/pages/${match.handle}`;
    case 'blog':
      return `/blogs/${match.handle}`;
    case 'article':
      return `/blogs/${match.parentHandle}/${match.handle}`;
    case 'search':
      return '/search';
    case 'cart':
      return '/cart';
    case 'password':
      return '/password';
    default:
      return '/404';
  }
}
