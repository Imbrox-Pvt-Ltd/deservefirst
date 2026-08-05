/**
 * Storefront · domain/drops/global.ts
 * The objects present on every page: shop, request, template, navigation.
 *
 * `shop` is the one worth reading twice. A store row carries the merchant's own
 * contact details, their plan, their billing state — none of which belongs on a
 * public page, and all of which a theme would happily render if handed the row.
 * What is here is what a storefront legitimately needs to draw a header and a
 * footer, and nothing beyond it.
 *
 * `request` is the other sharp edge. It carries what a theme needs to know
 * about the page it is on, deliberately not the headers or cookies that came
 * with it: a theme reading a session cookie would turn every installed theme
 * into an account-takeover risk.
 * Layer: domain (pure).
 */

import { defineDrop, dropList, type DropFactory } from './define';

export interface ShopRow {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly domain: string;
  readonly currency: string;
  readonly description?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly address?: Readonly<Record<string, unknown>> | null;
  readonly enabledCurrencies?: readonly string[] | null;
  readonly enabledLocales?: readonly string[] | null;
}

export interface RequestState {
  readonly path: string;
  readonly host: string;
  readonly origin: string;
  /** `index`, `product`, `collection`, `page`, `article`, `search`, `404`. */
  readonly pageType: string;
  readonly locale: string;
  readonly currency: string;
  /** True while the theme editor is rendering a preview. */
  readonly designMode: boolean;
  /** Raw query string, without the leading `?`. */
  readonly queryString?: string;
  /**
   * Escaped, read-recording parameters from `readableParams`.
   *
   * Typed as a plain record rather than the access object, because a drop
   * exposes values and the recording is the caller's business.
   */
  readonly params?: Readonly<Record<string, string>>;
  readonly page?: number;
}

export interface TemplateState {
  readonly name: string;
  readonly suffix?: string | null;
  readonly directory?: string | null;
}

export interface LinkRow {
  readonly title: string;
  readonly url: string;
  readonly type?: string | null;
  readonly active?: boolean;
  readonly children?: readonly LinkRow[];
}

export interface LinklistRow {
  readonly handle: string;
  readonly title: string;
  readonly links: readonly LinkRow[];
}

export interface PaginateState {
  readonly currentPage: number;
  readonly currentOffset: number;
  readonly items: number;
  readonly pageSize: number;
  readonly basePath: string;
}

export const shopDrop = defineDrop<ShopRow>('shop', {
  id: (shop) => shop.id,
  name: (shop) => shop.name,
  description: (shop) => shop.description ?? '',
  /**
   * The public storefront address, not the admin one.
   *
   * A theme printing the admin host into a canonical tag or an email link would
   * send customers to a login screen they cannot use.
   */
  domain: (shop) => shop.domain,
  permanent_domain: (shop) => shop.domain,
  url: (shop) => `https://${shop.domain}`,
  secure_url: (shop) => `https://${shop.domain}`,

  currency: (shop) => shop.currency,
  enabled_currencies: (shop) => shop.enabledCurrencies ?? [shop.currency],
  enabled_locales: (shop) => shop.enabledLocales ?? [],
  money_format: (_shop, context) => context.currency,

  /**
   * Contact details a storefront prints in its own footer.
   *
   * Present because themes render them and customers need them; note that the
   * merchant's billing email and phone are different fields on the store row
   * and are not these.
   */
  email: (shop) => shop.email ?? '',
  phone: (shop) => shop.phone ?? '',
  address: (shop) => shop.address ?? null,

  products_count: (_shop, context) =>
    (context.load.productCount as (() => number) | undefined)?.() ?? 0,
  collections_count: (_shop, context) =>
    (context.load.collectionCount as (() => number) | undefined)?.() ?? 0,
  types: (_shop, context) =>
    (context.load.productTypes as (() => readonly string[]) | undefined)?.() ?? [],
  vendors: (_shop, context) =>
    (context.load.productVendors as (() => readonly string[]) | undefined)?.() ?? [],
});

export const requestDrop = defineDrop<RequestState>('request', {
  path: (request) => request.path,
  host: (request) => request.host,
  origin: (request) => request.origin,
  page_type: (request) => request.pageType,
  locale: (request) => request.locale,

  /** The full URL, for canonical tags and share links. */
  url: (request) => `${request.origin}${request.path}${request.queryString ? `?${request.queryString}` : ''}`,

  /**
   * The query string, escaped like the parameters are.
   *
   * Present because themes build "keep my filters" links from it, and building
   * one by hand from `params` loses any key the theme did not think of.
   */
  query_string: (request) =>
    (request.queryString ?? '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),

  /**
   * Query parameters, already escaped, with every read recorded.
   *
   * The reference product withholds these entirely and it is right to be
   * careful: Liquid does not escape output, so a raw parameter rendered into a
   * page is reflected script, and a cached page built from one visitor's URL is
   * served to the next. `request-params.ts` answers both — the values arrive
   * safe, and the keys a render touched become the cache key.
   *
   * So a theme CAN write `{% if request.params.view == 'grid' %}` and
   * `{{ request.params.utm_campaign }}`, which is the thing themes have always
   * needed and worked around with JavaScript.
   */
  params: (request) => request.params ?? {},

  /** The page number, which paginate reads rather than trusting the template. */
  page: (request) => request.page ?? 1,
  /**
   * True only while the editor previews the theme.
   *
   * Themes use it to disable autoplay and lazy loading so a merchant sees every
   * section at once. Getting it wrong the other way — true in production —
   * would ship a slower storefront to customers.
   */
  design_mode: (request) => request.designMode,
  visual_preview_mode: () => false,
});

export const templateDrop = defineDrop<TemplateState>('template', {
  name: (template) => template.name,
  suffix: (template) => template.suffix ?? null,
  directory: (template) => template.directory ?? null,
});

export const linkDrop: DropFactory<LinkRow> = defineDrop<LinkRow>('link', {
  title: (link) => link.title,
  url: (link) => link.url,
  type: (link) => link.type ?? 'http_link',
  active: (link) => link.active ?? false,
  /**
   * Child links, recursively.
   *
   * Depth is bounded by the menu the merchant built rather than by a rule here;
   * a cycle is impossible because a menu is stored as a tree, not as edges.
   */
  links: (link, context) => dropList(linkDrop, link.children ?? [], context),
  levels: (link) => (link.children?.length ? 1 : 0),
  object: () => null,
});

export const linklistDrop = defineDrop<LinklistRow>('linklist', {
  handle: (list) => list.handle,
  title: (list) => list.title,
  links: (list, context) => dropList(linkDrop, list.links, context),
});

/**
 * Pagination, computed rather than stored.
 *
 * `parts` is what a theme actually renders — the numbered links with gaps —
 * and building it here means every theme gets the same, correct ellipsis
 * behaviour instead of each reimplementing it in Liquid.
 */
export const paginateDrop = defineDrop<PaginateState>('paginate', {
  current_page: (state) => state.currentPage,
  current_offset: (state) => state.currentOffset,
  items: (state) => state.items,
  page_size: (state) => state.pageSize,
  pages: (state) => Math.max(1, Math.ceil(state.items / Math.max(1, state.pageSize))),

  previous: (state) =>
    state.currentPage > 1
      ? { title: '&laquo; Previous', url: pageUrl(state.basePath, state.currentPage - 1), is_link: true }
      : null,
  next: (state) => {
    const pages = Math.max(1, Math.ceil(state.items / Math.max(1, state.pageSize)));
    return state.currentPage < pages
      ? { title: 'Next &raquo;', url: pageUrl(state.basePath, state.currentPage + 1), is_link: true }
      : null;
  },

  parts: (state) => {
    const pages = Math.max(1, Math.ceil(state.items / Math.max(1, state.pageSize)));
    const current = state.currentPage;
    const parts: { title: string; url: string; is_link: boolean }[] = [];

    /**
     * First, last, and a window around the current page — with a gap marker
     * where numbers were skipped. A paginator that lists 400 pages is a row of
     * numbers nobody can use and a lot of markup nobody reads.
     */
    const shown = new Set<number>([1, pages, current - 1, current, current + 1]);
    let previousShown = 0;

    for (let page = 1; page <= pages; page++) {
      if (!shown.has(page)) continue;
      if (page - previousShown > 1) parts.push({ title: '…', url: '', is_link: false });
      parts.push({
        title: String(page),
        url: page === current ? '' : pageUrl(state.basePath, page),
        is_link: page !== current,
      });
      previousShown = page;
    }

    return parts;
  },
});

function pageUrl(basePath: string, page: number): string {
  const [path, query = ''] = basePath.split('?');
  const params = new URLSearchParams(query);
  if (page <= 1) params.delete('page');
  else params.set('page', String(page));
  const rendered = params.toString();
  return rendered === '' ? (path as string) : `${path}?${rendered}`;
}
