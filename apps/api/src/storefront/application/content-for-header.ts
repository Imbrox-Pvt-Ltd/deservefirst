/**
 * Storefront · application/content-for-header.ts
 * What the platform injects into every theme's `<head>`.
 *
 * This file used to open by asserting that "a theme's layout does not write a
 * `<title>` tag — the reference theme's does not". That was measured wrong. The
 * reference theme writes its title, its description, its Open Graph tags and
 * its JSON-LD, in `snippets/head.liquid` and `snippets/social-meta.liquid`, and
 * so does every theme built for the product we are compatible with. The result
 * was two `<title>` tags, two `og:title`, two descriptions and two JSON-LD
 * blocks on every page — which search engines treat as conflicting markup
 * exactly as they treat two canonicals.
 *
 * That case had already been found here for the canonical link alone, and the
 * comment explaining it is still below. The same reasoning applies to all of
 * it, so the division is now stated once and applies to everything: **the
 * platform provides the DATA, the theme emits the TAGS.** `page_title`,
 * `canonical_url`, `page_description` and the drops are ours to get right; what
 * ends up in the head is the theme's to decide.
 *
 * Which leaves `content_for_header` emitting nothing — and that is the honest
 * answer rather than an empty gesture. A page must still have a title, so
 * `withTitleFallback` supplies one only when the finished document has none. It
 * looks at what was actually rendered rather than guessing beforehand, which is
 * the only way to be right for a complete theme and a bare one at the same
 * time.
 * Layer: application.
 */

import { escapeHtml } from '../engine';

export interface HeaderInput {
  /** The document title, already decided per page type. */
  readonly title: string;
  readonly description?: string | null;
  /** Absolute canonical URL for this page. */
  readonly canonical: string;
  readonly shopName: string;
  /** Social preview image. */
  readonly image?: string | null;
  /** JSON-LD objects, built by `structured-data.ts`. */
  readonly structuredData?: readonly Record<string, unknown>[];
  readonly locale?: string;
  /** `product`, `article`, or the default `website`. */
  readonly openGraphType?: string;
}

/**
 * What `{{ content_for_header }}` renders: nothing.
 *
 * Kept as a function rather than deleted, because every theme writes the tag
 * and this is where the platform's own additions belong when it has any — an
 * analytics snippet, a consent banner, the things a merchant enables in
 * settings rather than in a theme. None exist yet, and inventing head tags to
 * fill the gap is precisely what produced the duplicates.
 *
 * The original reasoning about canonicals, which is what generalised:
 * themes emit their own from the `canonical_url` global — the reference theme's
 * head does exactly that — so emitting one here too put TWO canonical links on
 * every page, which is worse than none, because a crawler seeing conflicting
 * canonicals ignores both.
 */
export function renderContentForHeader(_input: HeaderInput): string {
  return '';
}

/**
 * A `<title>` for a document that has none.
 *
 * Applied to the FINISHED page, because that is the only place the question can
 * be answered honestly: a theme either wrote one or it did not, and no amount
 * of inspecting the theme beforehand is as reliable as looking at what came
 * out.
 *
 * Returns the html untouched when a title is already there — the case for every
 * real theme — so this costs one regular expression per render and changes
 * nothing, until somebody installs a theme that forgot.
 */
export function withTitleFallback(html: string, title: string, shopName: string): string {
  // `<title` followed by `>` or whitespace. Matching the bare word would find
  // `og:title` and conclude that a theme with no title had one.
  if (/<title[\s>]/i.test(html)) return html;

  const full = title.trim() === '' || title === shopName ? shopName : `${title} – ${shopName}`;
  const tag = `<title>${escapeHtml(full)}</title>`;

  /**
   * Inserted after `<head>`, or at the very start when there is no head either.
   *
   * A theme with no `<head>` is beyond helping, but putting the title first is
   * still better than dropping it: browsers recover, and a title in an odd
   * place is read while a missing one is not.
   */
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return tag + html;

  const at = head.index + head[0].length;
  return html.slice(0, at) + tag + html.slice(at);
}

/**
 * Trims a description to what a search result will actually show.
 *
 * Unused while the platform emits no description of its own, and kept because
 * it is the correct rule and the settings-driven head tags will want it: 160
 * characters is where Google truncates, and a longer description is cut
 * mid-sentence rather than penalised — so cutting it deliberately, at a word
 * boundary, is the difference between a readable snippet and one ending in
 * "the produ".
 */
export function summarise(text: string, limit = 160): string {
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
