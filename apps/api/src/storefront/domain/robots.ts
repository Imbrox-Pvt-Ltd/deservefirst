/**
 * Storefront · domain/robots.ts
 * robots.txt — the defaults, and what a merchant may change.
 *
 * The defaults matter more than the editing. A storefront has URLs that must
 * never be crawled and that no merchant should have to think about: the cart,
 * the account pages, the search results, and every faceted collection URL. That
 * last one is the expensive mistake — a collection with six filters has
 * thousands of URL combinations, and a crawler that indexes them spends its
 * budget on near-identical pages instead of the products.
 *
 * `password` is the one that is a leak rather than a waste: a store still
 * building should not have its pre-launch pages indexed.
 * Layer: domain (pure).
 */

export interface RobotsRule {
  readonly userAgent: string;
  readonly disallow?: readonly string[];
  readonly allow?: readonly string[];
  /** Seconds. Only honoured by some crawlers, but harmless to state. */
  readonly crawlDelay?: number;
}

/**
 * What every store disallows unless the merchant says otherwise.
 *
 * Each of these is a URL that either wastes crawl budget or should not be
 * public, and the comments are the reason a future reader should not "tidy" one
 * away.
 */
export const DEFAULT_DISALLOW: readonly string[] = [
  // Personal and stateful — never useful in an index, sometimes harmful.
  '/cart',
  '/account',
  '/checkouts',
  '/orders',
  // A store still being built.
  '/password',
  // Search results are infinite and thin; indexing them is the classic way to
  // fill an index with pages that answer nothing.
  '/search',
  // Faceted collection URLs. A collection with six filters has thousands of
  // combinations that all show subsets of the same products.
  '/*?*filter.',
  '/*?*sort_by=',
  '/*?*q=',
  // Internal formats.
  '/*.json$',
  '/*.atom$',
];

/**
 * Strips anything that would let a value break the file's line structure.
 *
 * robots.txt is line-oriented, so a newline inside a merchant-supplied value is
 * an injected directive — a path containing "\nDisallow: /" would hide the
 * whole store from every crawler.
 */
function sanitiseValue(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

export interface RobotsOptions {
  /** Absolute URLs of the sitemap or sitemap index. */
  readonly sitemaps?: readonly string[];
  /** Replaces the defaults entirely when given. */
  readonly rules?: readonly RobotsRule[];
  /** Added to the defaults, for a merchant who wants one more path hidden. */
  readonly additionalDisallow?: readonly string[];
  /**
   * A store that is not open yet.
   *
   * Disallows everything, which is the correct answer for a store behind a
   * password: a crawler that indexed the coming-soon page would leave it in
   * results after launch.
   */
  readonly closed?: boolean;
}

export function renderRobots(options: RobotsOptions = {}): string {
  const lines: string[] = [];

  if (options.closed) {
    lines.push('User-agent: *', 'Disallow: /');
  } else if (options.rules && options.rules.length > 0) {
    for (const rule of options.rules) {
      lines.push(`User-agent: ${sanitiseValue(rule.userAgent) || '*'}`);
      for (const path of rule.allow ?? []) {
        const clean = sanitiseValue(path);
        if (clean) lines.push(`Allow: ${clean}`);
      }
      for (const path of rule.disallow ?? []) {
        const clean = sanitiseValue(path);
        if (clean) lines.push(`Disallow: ${clean}`);
      }
      if (rule.crawlDelay !== undefined && Number.isFinite(rule.crawlDelay)) {
        lines.push(`Crawl-delay: ${Math.max(0, Math.round(rule.crawlDelay))}`);
      }
      lines.push('');
    }
  } else {
    lines.push('User-agent: *');
    for (const path of [...DEFAULT_DISALLOW, ...(options.additionalDisallow ?? [])]) {
      const clean = sanitiseValue(path);
      if (clean) lines.push(`Disallow: ${clean}`);
    }
    lines.push('');
  }

  /**
   * The sitemap goes last and outside any user-agent group.
   *
   * It is not scoped to a group in the protocol, and putting it inside one
   * makes some crawlers miss it — which defeats the point of publishing it.
   */
  for (const sitemap of options.sitemaps ?? []) {
    const clean = sanitiseValue(sitemap);
    if (clean) lines.push(`Sitemap: ${clean}`);
  }

  // A single trailing newline, however the branches above left things.
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
