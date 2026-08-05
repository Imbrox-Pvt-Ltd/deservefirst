/**
 * Storefront · api/storefront.handler.ts
 * A URL on the storefront host becomes a response.
 *
 * The order of the pipeline is load-bearing and each step is here because
 * putting it later would be wrong:
 *
 *   1. resolve the store — everything after inherits this tenant decision
 *   2. robots.txt and sitemap.xml — machine files, before any theme work
 *   3. redirects — before routing, or a renamed handle 404s on the way past
 *   4. match the route, load the record
 *   5. render, with the drops that page needs
 *   6. status, headers, cache key
 *
 * This is transport: it decides what to call and what to send back, and holds
 * no storefront logic of its own. Routing, redirects, sitemaps and rendering
 * are all domain or application code that is unit-tested without a socket.
 *
 * A `Handler`, deliberately not a `Controller`. In this codebase a controller
 * is a module's declared API routes — it contributes permissions, schemas and
 * operations to the Admin API reference. This contributes none of those: it
 * answers every path on a different hostname with HTML, for anonymous visitors.
 * Calling it a controller made `controllers-are-described` ask for it in
 * `describe.ts`, which was the rule correctly noticing a name that lied.
 * Layer: api.
 */

import {
  admitSubmission,
  cacheKeyFor,
  canonicalPath,
  formDrop,
  formStateFor,
  collectionDrop,
  compileRedirects,
  createDropContext,
  createLookupBudget,
  DEFAULT_PRIORITY,
  lookupDrop,
  matchRoute,
  pageDrop,
  paginateDrop,
  productDrop,
  productJsonLd,
  articleDrop,
  blogDrop,
  readableParams,
  redirectFor,
  renderRobots,
  renderSitemap,
  renderSitemapIndex,
  requestDrop,
  shopDrop,
  templateDrop,
  validateSubmission,
  type PageType,
  type RouteMatch,
} from '../domain';
import { PageRenderer, renderContentForHeader, renderStoreNotFoundPage } from '../application';
import { createThemeEngine, defaultContext, type RenderContext } from '../engine';
import { platformContext, storefrontContext, withRequestContext } from '../../core/tenant-context';
import type { ResolvedStore, StorefrontData, StoreResolver } from './storefront-ports';

export interface StorefrontResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** What this response should be cached under, or null if it must not be. */
  readonly cacheKey: string | null;
}

export interface StorefrontRequestInput {
  readonly host: string;
  readonly path: string;
  readonly query: string;
  readonly method: string;
  /** True when the theme editor is previewing. */
  readonly designMode?: boolean;
  /** Parsed form body, for a POST. */
  readonly form?: Readonly<Record<string, string>>;
  /** The Origin header, which is how a cross-site POST is recognised. */
  readonly origin?: string | null;
  /** Whoever is asking, for the rate limit. */
  readonly clientIp?: string;
  readonly hasSession?: boolean;
  readonly tokenValid?: boolean;
}

export interface StorefrontOptions {
  /** Section failures explain themselves in the markup. Never in production. */
  readonly explainFailures?: boolean;
  /**
   * The budget a single visitor gets for submitting forms.
   *
   * Required in practice: this is the one place an anonymous stranger writes
   * data, so without it a store's enquiry inbox is filled by a bot on the day
   * it launches. Optional in the type only so a test can render without one.
   */
  readonly submissionLimit?: (key: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

/**
 * Headers every storefront response carries.
 *
 * `X-Frame-Options` is deliberately absent. The theme editor previews a store
 * in an iframe, and a blanket DENY would break the product's own editor —
 * framing is controlled by `frame-ancestors` in the CSP instead, which can name
 * the admin host.
 *
 * There is no `Content-Security-Policy` here yet, and that is an admission
 * rather than an oversight: themes emit inline `<script>` and `<style>` through
 * `{% javascript %}` and `{% style %}`, so any CSP worth having needs per-render
 * nonces threaded through those tags. Shipping a policy that themes violate
 * would teach everyone to ignore the console.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // A storefront has no business being asked for these.
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
};

export class StorefrontHandler {
  constructor(
    private readonly resolver: StoreResolver,
    private readonly options: StorefrontOptions = {},
  ) {}

  async handle(input: StorefrontRequestInput): Promise<StorefrontResponse> {
    if (!['GET', 'HEAD', 'POST'].includes(input.method)) {
      return text(405, 'Method not allowed', { allow: 'GET, HEAD, POST' });
    }

    /**
     * The Host header decides the tenant, and resolution runs in a PLATFORM
     * context while everything after it runs in a STORE one, the rest in a STORE one.
     *
     * The two are genuinely different questions and the guard is right to
     * insist. "Which store owns this hostname" is a lookup across every store,
     * so it cannot be store-scoped; everything after it is one store's data and
     * must be. Without the second context the query guard refuses every
     * storefront query with `MissingStoreContextError` — correctly, since an
     * unscoped query is one that could return another tenant's rows.
     */
    const store = await withRequestContext(platformContext(), () =>
      this.resolver.resolve(normaliseHost(input.host)),
    );

    if (!store) {
      /**
       * A branded page rather than bare text.
       *
       * Someone here has almost always mistyped a store name or followed a link
       * to a shop that closed, and this is our own domain — leaving them on an
       * unstyled "Not found" serves nobody.
       *
       * It stays a 404 and carries `noindex`: the page answers on thousands of
       * hostnames with nothing behind them, and a 200 would have search engines
       * collect every one of them. It says nothing about which stores DO exist,
       * because a helpful hint here is a store-enumeration oracle.
       */
      return {
        status: 404,
        headers: {
          ...SECURITY_HEADERS,
          'content-type': 'text/html; charset=utf-8',
          'x-robots-tag': 'noindex, nofollow',
          'cache-control': 'no-store',
        },
        body: renderStoreNotFoundPage({ host: normaliseHost(input.host) }),
        cacheKey: null,
      };
    }

    return withRequestContext(storefrontContext(store.storeId), () =>
      input.method === 'POST' ? this.submit(store, input) : this.serve(store, input),
    );
  }

  private async serve(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const path = input.path.split('?')[0] ?? '/';

    if (path === '/robots.txt') return this.robots(store, input.host);
    if (path === '/sitemap.xml') return this.sitemapIndex(store, input.host);
    if (path.startsWith('/sitemap_')) return this.sitemap(store, path);

    /**
     * Redirects run before routing.
     *
     * After it, a renamed handle would 404 on the way past — the redirect
     * exists precisely because the route no longer resolves.
     */
    const rules = await store.data.redirects();
    const { table } = compileRedirects(rules);
    const destination = redirectFor(table, path, input.query);
    if (destination !== null) {
      return {
        status: 301,
        headers: { ...SECURITY_HEADERS, location: destination },
        body: '',
        // A permanent redirect is cacheable; the destination decides its own.
        cacheKey: path,
      };
    }

    return this.renderPage(store, input, path);
  }

  /**
   * A form submission from a stranger.
   *
   * The order is the defence. Rate limit before anything is parsed, admit
   * before anything is validated, validate before anything is written — so the
   * cheapest refusal happens first and a flood never reaches the database.
   *
   * On failure the page is RE-RENDERED with `form.errors` populated, which is
   * what themes are written for. On success it REDIRECTS: a success that
   * re-rendered would resubmit on refresh, and a merchant would find the same
   * enquiry four times.
   */
  private async submit(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const path = input.path.split('?')[0] ?? '/';
    const fields = input.form ?? {};

    /**
     * The budget, keyed by visitor AND store.
     *
     * By store as well, so one merchant's viral moment cannot exhaust a bucket
     * shared with everyone else's.
     */
    if (this.options.submissionLimit) {
      const decision = await this.options.submissionLimit(
        `storefront:${store.storeId}:submit:${input.clientIp ?? 'unknown'}`,
      );
      if (!decision.allowed) {
        return text(429, 'Too many submissions. Please wait a moment and try again.', {
          'retry-after': String(Math.max(1, decision.retryAfterSeconds)),
        });
      }
    }

    const admitted = admitSubmission({
      formType: String(fields.form_type ?? ''),
      fields,
      origin: input.origin ?? null,
      host: normaliseHost(input.host),
      hasSession: input.hasSession ?? false,
      tokenValid: input.tokenValid ?? false,
    });

    if (!admitted.ok) {
      /**
       * A honeypot is answered as though it worked.
       *
       * Telling a bot it was detected teaches whoever wrote it to stop filling
       * the field. Nothing is stored.
       */
      if (admitted.reason === 'honeypot') return this.redirectAfterPost(path, 'sent');
      return this.rerenderWithErrors(store, input, path, [
        { field: 'form', message: admitted.message },
      ]);
    }

    const errors = validateSubmission(admitted.formType, admitted.fields);
    if (errors.length > 0) {
      return this.rerenderWithErrors(store, input, path, errors);
    }

    if (!store.submissions) {
      // The store cannot take submissions yet. Said plainly rather than
      // pretending it worked, which would lose a customer's enquiry silently.
      return this.rerenderWithErrors(store, input, path, [
        { field: 'form', message: 'This store is not accepting messages at the moment.' },
      ]);
    }

    try {
      return await this.perform(store, admitted.formType, admitted.fields, path);
    } catch (error) {
      return this.rerenderWithErrors(store, input, path, [
        {
          field: 'form',
          // Never the underlying message: it is written for us, not for a
          // customer, and may name a table.
          message: 'Something went wrong sending that. Please try again.',
        },
      ]);
    }
  }

  /** Carries out an admitted, valid submission. */
  private async perform(
    store: ResolvedStore,
    formType: string,
    fields: Readonly<Record<string, string>>,
    path: string,
  ): Promise<StorefrontResponse> {
    const submissions = store.submissions as NonNullable<ResolvedStore['submissions']>;

    switch (formType) {
      case 'product':
      case 'cart': {
        const quantity = Number(fields.quantity ?? 1);
        const { reference } = await submissions.requestQuote({
          contactEmail: (fields.email ?? '').trim(),
          contactName: (fields.name ?? '').trim() || null,
          message: (fields.body ?? '').trim() || null,
          productId: (fields.product_id ?? '').trim() || null,
          quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1,
        });
        // The reference travels in the URL so the theme can thank them by name.
        return this.redirectAfterPost(path, 'requested', reference);
      }

      case 'contact':
      case 'customer': {
        await submissions.contact({
          email: (fields.email ?? '').trim(),
          name: (fields.name ?? '').trim() || null,
          body: (fields.body ?? '').trim(),
        });
        return this.redirectAfterPost(path, 'sent');
      }

      default:
        /**
         * A form we admit but cannot yet carry out.
         *
         * The account forms need customer accounts, which Phase 1 does not have.
         * Refusing here rather than earlier keeps the reason honest: the form is
         * legitimate, the feature is not built.
         */
        return this.rerenderWithErrors(store, { path } as StorefrontRequestInput, path, [
          { field: 'form', message: 'That is not available on this store yet.' },
        ]);
    }
  }

  /**
   * Post/Redirect/Get, so a refresh does not resubmit.
   *
   * The outcome is a query parameter the theme reads — `request.params.posted`
   * — which is exactly what the readable-parameters work was for.
   */
  private redirectAfterPost(path: string, outcome: string, reference?: string): StorefrontResponse {
    const params = new URLSearchParams({ posted: outcome });
    if (reference) params.set('ref', reference);

    return {
      status: 303,
      headers: {
        ...SECURITY_HEADERS,
        location: `${path}?${params.toString()}`,
        // A result page is about one submission and must never be cached.
        'cache-control': 'no-store',
      },
      body: '',
      cacheKey: null,
    };
  }

  /** Re-renders the page the form was on, with the errors a theme displays. */
  private async rerenderWithErrors(
    store: ResolvedStore,
    input: StorefrontRequestInput,
    path: string,
    errors: readonly { field: string; message: string }[],
  ): Promise<StorefrontResponse> {
    const page = await this.renderPage(
      store,
      { ...input, method: 'GET', form: undefined },
      path,
      formStateFor(String(input.form?.form_type ?? ''), input.form ?? {}, errors),
    );

    return {
      ...page,
      // 422: understood, and not acted on. And never cached — it holds one
      // person's typing.
      status: 422,
      headers: { ...page.headers, 'cache-control': 'no-store' },
      cacheKey: null,
    };
  }

  private async renderPage(
    store: ResolvedStore,
    input: StorefrontRequestInput,
    path: string,
    /** Set when re-rendering after a failed submission. */
    formState?: Record<string, unknown>,
  ): Promise<StorefrontResponse> {
    const match = store.closed ? ({ pageType: 'password' } as RouteMatch) : matchRoute(path);

    // An account path is served by the platform, not by a theme template.
    if (match.account) return text(404, 'Not found');

    const shop = await store.data.shop();
    const access = readableParams(input.query);
    const budget = createLookupBudget();

    const engineContext: RenderContext = defaultContext({
      currency: shop.currency as never,
      assetBaseUrl: `https://${shop.domain}/assets`,
      cdnBaseUrl: `https://${shop.domain}/files`,
      platformAssetBaseUrl: `https://${shop.domain}/platform`,
    });

    const drops = createDropContext({
      currency: shop.currency,
      locale: 'en',
      baseUrl: `https://${shop.domain}`,
      load: loadersFor(store.data),
    });

    // Built before the engine, because the drops become its globals.
    const { scope, found } = await this.scopeFor(store, match, drops, budget, shop, input, access);

    // A failed submission puts the theme's own error rendering back in front of
    // the customer, through the SAME drop a theme reads on any other page.
    if (formState) scope.form = formDrop(formState as never, drops);

    /**
     * The drops are GLOBALS, not render scope.
     *
     * `{% render %}` isolates its scope: a snippet sees nothing its caller had.
     * The reference theme's entire product section is one line —
     * `{% render 'product' %}` — so passing the drops as scope rendered a
     * complete page with the product missing from it, and nothing errored.
     *
     * `section` and `block` stay locals, matching the reference product, which
     * is why themes pass them onward explicitly when a snippet needs one.
     */
    const engine = createThemeEngine(engineContext, { source: store.theme, globals: scope });
    const renderer = new PageRenderer(engine, store.theme, {
      explainFailures: this.options.explainFailures ?? false,
    });

    // A handle that resolves to nothing renders the theme's own 404 page, with
    // a 404 status — a soft 404 that returns 200 is indexed as a real page.
    const pageType: PageType = found ? (match.pageType as PageType) : '404';

    /**
     * The head the theme does not write itself.
     *
     * A theme's layout emits `{{ content_for_header }}` and expects the title,
     * the canonical and the structured data to arrive there — the reference
     * theme's layout has no `<title>` tag at all. Passing an empty string, as
     * this did at first, produces a page with no title anywhere in it.
     */
    const canonicalUrl = `https://${shop.domain}${canonicalPath(match)}`;
    const record = scope.product as { title?: string; description?: string } | undefined;

    const page = await renderer.render({
      pageType,
      scope: {
        ...scope,
        content_for_header: renderContentForHeader({
          title: String(scope.page_title ?? shop.name),
          description: record?.description ?? null,
          canonical: canonicalUrl,
          shopName: shop.name,
          openGraphType: match.pageType === 'product' ? 'product' : 'website',
          structuredData: buildStructuredData(match.pageType, scope, canonicalUrl, shop.currency),
        }),
      },
    });

    if (!page.templatePath) {
      // The theme has no template for this page type at all.
      return text(found ? 500 : 404, found ? 'This theme is incomplete' : 'Not found');
    }

    const status = found ? 200 : 404;
    const canonical = canonicalUrl;

    return {
      status,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        link: `<${canonical}>; rel="canonical"`,
        'cache-control': status === 200 ? 'public, max-age=0, s-maxage=60' : 'no-store',
      },
      body: page.html,
      /**
       * The key includes exactly the parameters this render read.
       *
       * A page that read nothing caches by path; one that read `?variant`
       * caches per variant. Without this the first visitor's parameters would
       * be served to everyone after them.
       */
      cacheKey: status === 200 ? cacheKeyFor(path, input.query, access.readKeys()) : null,
    };
  }

  /** The drops a given page type needs, and whether its record exists. */
  private async scopeFor(
    store: ResolvedStore,
    match: RouteMatch,
    drops: ReturnType<typeof createDropContext>,
    budget: ReturnType<typeof createLookupBudget>,
    shop: Awaited<ReturnType<StorefrontData['shop']>>,
    input: StorefrontRequestInput,
    access: ReturnType<typeof readableParams>,
  ): Promise<{ scope: Record<string, unknown>; found: boolean }> {
    const data = store.data;

    /**
     * The page number comes from the URL, once, and everything uses this value.
     *
     * `paginate` and `request.page` disagreeing would show page three's
     * products under page two's pagination controls.
     */
    const requested = Number(new URLSearchParams(input.query).get('page') ?? 1);
    const page = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;

    const base: Record<string, unknown> = {
      shop: shopDrop(shop, drops),
      settings: await data.settings(),
      template: templateDrop({ name: match.pageType }, drops),
      request: requestDrop(
        {
          path: input.path,
          host: input.host,
          origin: `https://${shop.domain}`,
          pageType: match.pageType,
          locale: 'en',
          currency: shop.currency,
          designMode: input.designMode ?? false,
          queryString: input.query,
          params: access.params,
          page,
        },
        drops,
      ),
      /**
       * By-handle lookup, so a theme can render a product named by a query
       * parameter. Published-only and budgeted — see `domain/drops/lookup.ts`.
       */
      /**
       * The document title, which the layout reads directly.
       *
       * Defaulted to the shop name and overridden per page below. Without it
       * every page rendered with an empty `<title>` — invisible in a browser
       * tab and the single most important line a search result shows.
       */
      page_title: shop.name,
      /**
       * The canonical URL, as a global the theme reads.
       *
       * Themes write `<link rel="canonical" href="{{ canonical_url }}">`
       * themselves. Leaving it unset rendered `href=""` on every page — a
       * canonical pointing nowhere, which is worse than omitting the tag.
       */
      canonical_url: `https://${shop.domain}${canonicalPath(match)}`,
      page_description: '',
      all_products: lookupDrop(
        {
          load: (handle) => syncOf(data.productByHandle(handle)),
          factory: productDrop,
          budget,
          publishedOnly: true,
        },
        drops,
      ),
    };

    switch (match.pageType) {
      case 'product': {
        const row = await data.productByHandle(match.handle ?? '');
        if (!row) return { scope: base, found: false };
        return {
          scope: { ...base, product: productDrop(row, drops), page_title: row.title },
          found: true,
        };
      }
      case 'collection': {
        const row = await data.collectionByHandle(match.handle ?? '');
        if (!row) return { scope: base, found: false };
        const collection = collectionDrop(row, drops);
        return {
          scope: {
            ...base,
            page_title: row.title,
            collection,
            paginate: paginateDrop(
              {
                currentPage: page,
                currentOffset: 0,
                items: data.productCountOfCollection(row.id),
                pageSize: 24,
                basePath: input.path,
              },
              drops,
            ),
          },
          found: true,
        };
      }
      case 'page': {
        const row = await data.pageByHandle(match.handle ?? '');
        if (!row) return { scope: base, found: false };
        return { scope: { ...base, page: pageDrop(row, drops), page_title: row.title }, found: true };
      }
      case 'blog': {
        const row = await data.blogByHandle(match.handle ?? '');
        if (!row) return { scope: base, found: false };
        return { scope: { ...base, blog: blogDrop(row, drops), page_title: row.title }, found: true };
      }
      case 'article': {
        const row = await data.articleByHandle(match.parentHandle ?? '', match.handle ?? '');
        if (!row) return { scope: base, found: false };
        return {
          scope: { ...base, article: articleDrop(row, drops), page_title: row.title },
          found: true,
        };
      }
      case '404':
        return { scope: base, found: false };
      default:
        return { scope: base, found: true };
    }
  }

  private async robots(store: ResolvedStore, host: string): Promise<StorefrontResponse> {
    const body = renderRobots({
      closed: store.closed ?? false,
      sitemaps: [`https://${normaliseHost(host)}/sitemap.xml`],
    });
    return text(200, body, { 'content-type': 'text/plain; charset=utf-8' }, '/robots.txt');
  }

  private async sitemapIndex(store: ResolvedStore, host: string): Promise<StorefrontResponse> {
    const origin = `https://${normaliseHost(host)}`;
    const kinds = Object.keys(DEFAULT_PRIORITY).filter((kind) => kind !== 'policy');

    const body = renderSitemapIndex(
      kinds.map((kind) => ({ loc: `${origin}/sitemap_${kind}_1.xml` })),
    );
    return text(200, body, { 'content-type': 'application/xml; charset=utf-8' }, '/sitemap.xml');
  }

  private async sitemap(store: ResolvedStore, path: string): Promise<StorefrontResponse> {
    // `/sitemap_products_1.xml` — the kind is what decides the query.
    const kind = /^\/sitemap_([a-z-]+)_\d+\.xml$/.exec(path)?.[1];
    if (!kind) return text(404, 'Not found');

    const entries = await store.data.sitemapEntries(kind);
    return text(
      200,
      renderSitemap(entries),
      { 'content-type': 'application/xml; charset=utf-8' },
      path,
    );
  }
}

/**
 * The Host header, reduced to a hostname.
 *
 * The port is dropped and the value lowercased, so `Shop.Test:8080` and
 * `shop.test` resolve to one store rather than to none.
 */
function normaliseHost(host: string): string {
  return String(host ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
}

/**
 * Bridges a promise-returning lookup into the synchronous one drops expect.
 *
 * Drops are read during rendering and the engine awaits promise values, so a
 * promise flows through correctly — but the lookup budget needs a decision now.
 * Returning the promise is right: `lookupDrop` hands it to the drop factory,
 * which the engine resolves.
 */
function syncOf<T>(value: Promise<T>): T {
  return value as unknown as T;
}

/** The loaders the drop context needs, all already store-scoped. */
function loadersFor(data: StorefrontData): Record<string, (...args: never[]) => unknown> {
  return {
    variantsOfProduct: ((id: string) => data.variantsOfProduct(id)) as never,
    imagesOfProduct: ((id: string) => data.imagesOfProduct(id)) as never,
    productsOfCollection: ((id: string) => data.productsOfCollection(id)) as never,
    productCountOfCollection: ((id: string) => data.productCountOfCollection(id)) as never,
    image: ((id: string) => data.image(id)) as never,
  };
}

function text(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
  cacheKey: string | null = null,
): StorefrontResponse {
  return {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    },
    body,
    cacheKey: status === 200 ? cacheKey : null,
  };
}


/**
 * JSON-LD for the page, where the page is a kind search engines understand.
 *
 * Only for a page that actually shows what it declares — marking up a price a
 * visitor cannot see is what search engines penalise as structured-data spam,
 * and the penalty lands on the merchant.
 */
function buildStructuredData(
  pageType: string,
  scope: Record<string, unknown>,
  canonical: string,
  currency: string,
): readonly Record<string, unknown>[] {
  if (pageType !== 'product') return [];

  const product = scope.product as
    | { title?: string; description?: string; price?: number; vendor?: string; available?: boolean }
    | undefined;
  if (!product?.title) return [];

  return [
    productJsonLd({
      title: product.title,
      description: product.description ?? null,
      url: canonical,
      currency,
      priceMinor: typeof product.price === 'number' ? product.price : null,
      vendor: product.vendor ?? null,
      available: product.available ?? false,
    }),
  ];
}
