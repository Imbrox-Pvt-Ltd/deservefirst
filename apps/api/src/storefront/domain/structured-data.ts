/**
 * Storefront · domain/structured-data.ts
 * JSON-LD: Product, Offer, BreadcrumbList, Organization, Article.
 *
 * This is what turns a search result into a rich one — the price, the stock
 * state and the rating that appear under a listing. The theme-facing half is
 * the `structured_data` filter; this is the platform half, which the storefront
 * emits whether or not the theme thought to.
 *
 * The rule throughout: **describe only what the page actually shows**. Marking
 * up a price the page does not display, or a rating from nowhere, is what
 * search engines penalise as structured-data spam — and the penalty lands on
 * the merchant, not on us.
 *
 * `</script>` is escaped in the serialiser rather than by the caller. These
 * objects always end up inside a script element, and one product description
 * containing that sequence would close the tag and turn the rest of the JSON
 * into markup.
 * Layer: domain (pure).
 */

export interface ProductSeoInput {
  readonly title: string;
  readonly description?: string | null;
  readonly url: string;
  readonly sku?: string | null;
  readonly vendor?: string | null;
  readonly images?: readonly string[];
  /** Minor units, matching every other price on the platform. */
  readonly priceMinor?: number | null;
  readonly currency: string;
  readonly available?: boolean;
  /** ISO date after which the price is not guaranteed. */
  readonly priceValidUntil?: string | null;
}

export interface BreadcrumbInput {
  readonly name: string;
  readonly url: string;
}

/**
 * Minor units as the decimal string schema.org expects.
 *
 * String arithmetic rather than division, for the same reason as everywhere
 * else: 4500 / 100 is fine, 4499 / 100 is 44.989999999999995, and a price in a
 * search result that disagrees with the page is a merchant's problem to explain.
 */
function decimalFromMinor(minor: number, exponent = 2): string {
  const negative = minor < 0;
  const digits = String(Math.abs(Math.round(minor))).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Plain text from HTML, for a description field that must not carry markup. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function productJsonLd(product: ProductSeoInput): Record<string, unknown> {
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url: product.url,
    priceCurrency: product.currency,
    availability: product.available
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
  };

  // Only when there is one. An Offer with no price is valid; an Offer with a
  // price of zero because the field was missing is a lie.
  if (product.priceMinor !== null && product.priceMinor !== undefined) {
    offer.price = decimalFromMinor(product.priceMinor);
  }
  if (product.priceValidUntil) offer.priceValidUntil = product.priceValidUntil;

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: product.title,
    url: product.url,
    offers: offer,
  };

  if (product.description) data.description = plainText(product.description).slice(0, 5000);
  if (product.sku) data.sku = product.sku;
  if (product.vendor) data.brand = { '@type': 'Brand', name: product.vendor };
  if (product.images?.length) data.image = [...product.images];

  return data;
}

/**
 * The trail from the store root to this page.
 *
 * `position` is 1-based and must be contiguous — a gap makes the whole list
 * invalid rather than partially understood.
 */
export function breadcrumbJsonLd(trail: readonly BreadcrumbInput[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org/',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

export interface OrganizationInput {
  readonly name: string;
  readonly url: string;
  readonly logo?: string | null;
  readonly sameAs?: readonly string[];
}

export function organizationJsonLd(shop: OrganizationInput): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Organization',
    name: shop.name,
    url: shop.url,
  };
  if (shop.logo) data.logo = shop.logo;
  if (shop.sameAs?.length) data.sameAs = [...shop.sameAs];
  return data;
}

export interface ArticleSeoInput {
  readonly title: string;
  readonly url: string;
  readonly excerpt?: string | null;
  readonly author?: string | null;
  readonly image?: string | null;
  readonly publishedAt?: string | null;
  readonly updatedAt?: string | null;
}

export function articleJsonLd(article: ArticleSeoInput): Record<string, unknown> {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Article',
    headline: article.title.slice(0, 110),
    url: article.url,
  };
  if (article.excerpt) data.description = plainText(article.excerpt);
  if (article.author) data.author = { '@type': 'Person', name: article.author };
  if (article.image) data.image = article.image;
  if (article.publishedAt) data.datePublished = article.publishedAt;
  if (article.updatedAt) data.dateModified = article.updatedAt;
  return data;
}

/**
 * The site-level search box some engines render under a result.
 *
 * Declared once for the store, on the homepage only — on every page it is
 * repetition a crawler ignores at best.
 */
export function websiteJsonLd(name: string, url: string, searchPath = '/search'): Record<string, unknown> {
  return {
    '@context': 'https://schema.org/',
    '@type': 'WebSite',
    name,
    url,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${url}${searchPath}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Serialises JSON-LD for embedding in a page.
 *
 * `<` is escaped as `<`, which survives `JSON.parse` unchanged and makes
 * `</script>` impossible to produce — a product description containing that
 * sequence would otherwise close the tag and spill the rest of the document
 * into the page as markup.
 */
export function renderJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** A ready-to-emit script element. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return `<script type="application/ld+json">${renderJsonLd(data)}</script>`;
}
