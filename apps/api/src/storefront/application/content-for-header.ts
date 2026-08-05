/**
 * Storefront · application/content-for-header.ts
 * What the platform injects into every theme's `<head>`.
 *
 * A theme's layout does not write a `<title>` tag. The reference theme's does
 * not, and neither do most — they write `{{ content_for_header }}` and expect
 * the platform to supply the title, the description, the canonical link and the
 * structured data. Passing an empty string there produces a page with no title
 * at all, which is invisible in a browser tab and is the single most important
 * line a search result shows.
 *
 * That is why this exists rather than the SEO module simply having the pieces:
 * `structured-data.ts` can build perfect JSON-LD and it reaches nobody until
 * something puts it in the head.
 *
 * Everything here is escaped. The values are a merchant's product titles and
 * descriptions, and this is markup being assembled by hand.
 * Layer: application.
 */

import { escapeHtml } from '../engine';
import { jsonLdScript } from '../domain';

export interface HeaderInput {
  /** The document title, already decided per page type. */
  readonly title: string;
  readonly description?: string | null;
  /** Absolute canonical URL for this page. */
  readonly canonical: string;
  readonly shopName: string;
  /** Social preview image. */
  readonly image?: string | null;
  /** JSON-LD objects to embed, already built by `structured-data.ts`. */
  readonly structuredData?: readonly Record<string, unknown>[];
  readonly locale?: string;
  /** `product`, `article`, or the default `website`. */
  readonly openGraphType?: string;
}

/**
 * Trims a description to what a search result will actually show.
 *
 * 160 characters is where Google truncates. A longer one is not penalised, it
 * is simply cut mid-sentence — so cutting it deliberately, at a word boundary,
 * is the difference between a readable snippet and one ending in "the produ".
 */
function summarise(text: string, limit = 160): string {
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function renderContentForHeader(input: HeaderInput): string {
  const title = input.title.trim() === '' ? input.shopName : input.title;
  // The shop name is appended rather than replacing the page's own title: a tab
  // reading only the shop name tells a customer nothing about where they are.
  const fullTitle = title === input.shopName ? title : `${title} – ${input.shopName}`;
  const description = input.description ? summarise(input.description) : '';

  /**
   * No canonical link here, deliberately.
   *
   * Themes emit their own from the `canonical_url` global — the reference
   * theme's head does exactly that — so emitting one here too put TWO canonical
   * links on every page, which is worse than none: a crawler seeing conflicting
   * canonicals ignores both. The platform's job is to make `canonical_url`
   * correct, which it does.
   */
  const tags: string[] = [`<title>${escapeHtml(fullTitle)}</title>`];

  if (description) {
    tags.push(`<meta name="description" content="${escapeHtml(description)}">`);
  }

  // Open Graph, so a link shared in a message renders as a card rather than a
  // bare URL. Cheap to emit and the difference is visible to every customer who
  // shares a product.
  tags.push(
    `<meta property="og:type" content="${escapeHtml(input.openGraphType ?? 'website')}">`,
    `<meta property="og:title" content="${escapeHtml(fullTitle)}">`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}">`,
    `<meta property="og:site_name" content="${escapeHtml(input.shopName)}">`,
  );
  if (description) {
    tags.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
  }
  if (input.image) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(input.image)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }

  if (input.locale) {
    tags.push(`<meta property="og:locale" content="${escapeHtml(input.locale)}">`);
  }

  for (const data of input.structuredData ?? []) {
    tags.push(jsonLdScript(data));
  }

  return tags.join('\n');
}
