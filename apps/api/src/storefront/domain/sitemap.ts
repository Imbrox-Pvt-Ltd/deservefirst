/**
 * Storefront · domain/sitemap.ts
 * sitemap.xml, and the index that holds it together.
 *
 * The content module already publishes `content.page.published` with the
 * comment "SEO updates the sitemap" — this is the sitemap that comment refers
 * to and that PLAN/07 records as missing.
 *
 * Two constraints come from the protocol rather than from us, and both are hard
 * limits rather than guidelines: **50,000 URLs and 50 MB per file**. Exceeding
 * either means the file is rejected wholesale, so a store that grew past the
 * limit would silently stop being indexed at all — the worst possible failure
 * for a thing whose only purpose is being read by a crawler. Hence the index.
 *
 * XML escaping is the other trap. A handle can legitimately contain `&`, and an
 * unescaped ampersand does not merely look wrong: it makes the document invalid
 * and a crawler discards the entire file.
 * Layer: domain (pure).
 */

/** The protocol's ceiling. Not a preference. */
export const MAX_URLS_PER_SITEMAP = 50_000;

export interface SitemapEntry {
  /** Absolute URL. */
  readonly loc: string;
  readonly lastmod?: string | Date | null;
  readonly changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  /** 0.0–1.0. Relative importance within this store only. */
  readonly priority?: number;
  /** Alternate language versions, for hreflang. */
  readonly alternates?: readonly { hreflang: string; href: string }[];
}

/**
 * Escapes the five characters XML reserves.
 *
 * All five, unlike the HTML escaping elsewhere: an XML parser is not a browser
 * and does not guess. One raw `&` in a product handle invalidates the document
 * and the crawler drops every URL in it, not just that one.
 */
export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * W3C datetime, which is what the protocol asks for.
 *
 * Date only rather than a full timestamp: a crawler uses this to decide whether
 * to re-fetch, and second-level precision invites a sitemap that changes on
 * every build and teaches the crawler to ignore the field.
 */
function w3cDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function renderEntry(entry: SitemapEntry): string {
  const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];

  const lastmod = w3cDate(entry.lastmod);
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority !== undefined) {
    const clamped = Math.min(1, Math.max(0, entry.priority));
    parts.push(`    <priority>${clamped.toFixed(1)}</priority>`);
  }

  for (const alternate of entry.alternates ?? []) {
    parts.push(
      `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" ` +
        `href="${escapeXml(alternate.href)}"/>`,
    );
  }

  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

/**
 * One sitemap file.
 *
 * Entries beyond the ceiling are dropped rather than emitted, because a file
 * over the limit is rejected entirely — losing the tail is bad, losing all of
 * it is worse. `splitIntoSitemaps` is what callers should use instead.
 */
export function renderSitemap(entries: readonly SitemapEntry[]): string {
  const included = entries.slice(0, MAX_URLS_PER_SITEMAP);

  // The xhtml namespace is only declared when something uses it; an unused
  // namespace on every sitemap is noise in a file measured in megabytes.
  const needsXhtml = included.some((entry) => (entry.alternates?.length ?? 0) > 0);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${
      needsXhtml ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''
    }>`,
    ...included.map(renderEntry),
    '</urlset>',
    '',
  ].join('\n');
}

export interface SitemapReference {
  readonly loc: string;
  readonly lastmod?: string | Date | null;
}

/** The index that points at the individual sitemaps. */
export function renderSitemapIndex(sitemaps: readonly SitemapReference[]): string {
  const entries = sitemaps.map((sitemap) => {
    const lastmod = w3cDate(sitemap.lastmod);
    return [
      '  <sitemap>',
      `    <loc>${escapeXml(sitemap.loc)}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      '  </sitemap>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</sitemapindex>',
    '',
  ].join('\n');
}

/** Splits entries into files that each fit under the ceiling. */
export function splitIntoSitemaps(
  entries: readonly SitemapEntry[],
  perFile = MAX_URLS_PER_SITEMAP,
): readonly (readonly SitemapEntry[])[] {
  if (entries.length === 0) return [[]];
  const chunks: SitemapEntry[][] = [];
  for (let start = 0; start < entries.length; start += perFile) {
    chunks.push(entries.slice(start, start + perFile));
  }
  return chunks;
}

/**
 * Priorities by page kind.
 *
 * Relative within one store and nothing more — the protocol is explicit that it
 * says nothing about ranking against anyone else. Products and collections lead
 * because they are what a store is for; policy pages are present so they are
 * indexed, and low so they are not preferred over the catalogue.
 */
export const DEFAULT_PRIORITY: Readonly<Record<string, number>> = {
  index: 1.0,
  product: 0.8,
  collection: 0.8,
  page: 0.5,
  article: 0.6,
  blog: 0.5,
  policy: 0.3,
};
