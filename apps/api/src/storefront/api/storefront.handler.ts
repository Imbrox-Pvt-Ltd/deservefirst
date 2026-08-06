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
  buildCsp,
  assetPathFor,
  assetResponseFor,
  flattenTranslations,
  localeFileFor,
  resolveThemeSettings,
  cacheKeyFor,
  canonicalPath,
  canonicalRedirect,
  cspHeaderName,
  decideCacheable,
  DEFAULT_TTL_SECONDS,
  fullCacheKey,
  substitute,
  varyKey,
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
  variantDrop,
  recommendationsDrop,
  routesDrop,
  predictiveSearchDrop,
  normaliseSearchTerms,
  NO_SEARCH,
  normaliseIntent,
  normaliseLimit,
  NOT_PERFORMED,
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
import {
  PageRenderer,
  renderContentForHeader,
  renderStoreNotFoundPage,
  withTitleFallback,
} from '../application';
import {
  createThemeEngine,
  defaultContext,
  resolveColorSettings,
  type RenderContext,
} from '../engine';
import { resolveLinkSettings } from '../domain';
import { randomUUID } from 'node:crypto';

import { platformContext, storefrontContext, withRequestContext } from '../../core/tenant-context';
import type {
  CachedPage,
  PageCache,
  ResolvedStore,
  StorefrontData,
  StoreResolver,
} from './storefront-ports';

export interface StorefrontResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * A Buffer for an asset, a string for a page.
   *
   * Widened rather than given a second field, because every caller already
   * hands this to the transport unchanged — and an asset that travelled in a
   * different field would be one every caller had to learn about, with the
   * ones that did not silently serving nothing.
   */
  readonly body: string | Buffer;
  /** What this response should be cached under, or null if it must not be. */
  readonly cacheKey: string | null;
  /**
   * The query parameters this render read, which is what the key varies on.
   *
   * Carried separately from the key because a lookup has to build the key
   * BEFORE rendering, and only a completed render knows this — the cache
   * remembers it per path, the way HTTP's own `Vary` does.
   */
  readonly cacheVary?: readonly string[];
  /**
   * The nonce in this response, for the cache to swap out before storing.
   *
   * Transport metadata like `cacheKey`, not something a caller sends onward.
   */
  readonly nonce?: string | null;
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
  /**
   * Send a Content-Security-Policy, and whether to enforce it.
   *
   * Report-only by default, deliberately. A policy switched straight to
   * enforcing is one that takes existing storefronts down on the day it ships —
   * measuring first is how it becomes enforceable without a support queue.
   */
  readonly csp?: { readonly enabled: boolean; readonly enforce?: boolean; readonly reportUri?: string | null };
  /** Hosts allowed to frame a storefront — the admin, for the theme editor. */
  readonly frameAncestors?: readonly string[];
  /**
   * Where rendered pages are kept. Without one, every request re-renders.
   *
   * Optional so a test can render without one, and so the editor's preview path
   * can deliberately go without: a merchant dragging a section expects to see
   * the result, not a page from thirty seconds ago.
   */
  readonly pageCache?: PageCache;
  /** Seconds a cached page stays usable. */
  readonly pageCacheTtlSeconds?: number;
  /**
   * URL schemes other platforms use for internal links in theme settings.
   *
   * From `config/theme-compat.json`. Without them a theme's own links reach the
   * browser as an unknown scheme and do nothing when clicked.
   */
  readonly linkSchemes?: readonly string[];
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
  /**
   * Flattened locale files, by theme version.
   *
   * Unbounded only in the sense that a platform has finitely many published
   * theme versions being served at once; an entry is a few hundred short
   * strings and a publish replaces rather than adds to the working set.
   */
  private readonly translations = new Map<string, Record<string, string>>();
  /** Theme settings, by version, for the same reason. */
  private readonly settings = new Map<string, Record<string, unknown>>();

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

    /**
     * One page, one URL — decided before anything is rendered.
     *
     * A store with a verified primary domain answers on its platform subdomain
     * and on every alias too, and serving identical pages from several
     * hostnames splits the search ranking between them. That costs the merchant
     * exactly the traffic they connected a domain to get.
     *
     * Before the render rather than after, because a page rendered and then
     * discarded is 86 KB of Liquid nobody reads. Before the POST branch too:
     * a form posted to an alias should land on the canonical host, and 308
     * rather than 301 is what preserves the method and the body while it does.
     */
    const canonical = canonicalRedirect({
      requestHost: normaliseHost(input.host),
      primaryHost: store.primaryHost ?? null,
      path: input.path.split('?')[0] ?? '/',
      query: input.query,
    });

    if (canonical !== null) {
      return {
        status: input.method === 'POST' ? 308 : 301,
        headers: { ...SECURITY_HEADERS, location: canonical },
        body: '',
        // The redirect itself is stable and cacheable; where it lands decides
        // its own caching.
        cacheKey: null,
      };
    }

    return withRequestContext(storefrontContext(store.storeId), () =>
      input.method === 'POST' ? this.submit(store, input) : this.serveCached(store, input),
    );
  }

  /**
   * The cache, wrapped around `serve`.
   *
   * Deliberately a wrapper rather than something `renderPage` consults. Every
   * rule about what may be kept then lives in one place next to the lookup, and
   * the render path stays a function from a request to a page — which is what
   * makes it testable without a cache and cacheable without knowing it is.
   */
  private async serveCached(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const cache = this.options.pageCache;
    // The editor's preview must never be served from a cache: a merchant
    // dragging a section expects to see the result, not a page from a minute ago.
    if (!cache || input.designMode) return this.serve(store, input);

    const path = input.path.split('?')[0] ?? '/';
    const epoch = cache.epochFor(store.storeId);

    /**
     * Two lookups, both O(1): what this path varies on, then the page itself.
     *
     * The vary list has to be read first because the key is built from it, and
     * it can only have been learned from an earlier render of this same path.
     * A path nobody has rendered under this epoch is simply a miss.
     */
    const vary = await cache.get(varyKey(store.storeId, epoch, path));
    if (vary) {
      const keys = parseVary(vary.body);
      const hit = await cache.get(
        fullCacheKey(store.storeId, epoch, cacheKeyFor(path, input.query, keys)),
      );
      if (hit) return fromCache(hit);
    }

    const response = await this.serve(store, input);

    const decision = decideCacheable({
      method: input.method,
      status: response.status,
      cacheKey: response.cacheKey,
      hasSession: input.hasSession ?? false,
      contentType: response.headers['content-type'] ?? '',
    });

    if (!decision.cacheable) {
      // The reason travels in the header. "Why is this page not cached" is
      // otherwise a question that costs somebody an afternoon.
      return withHeader(response, 'x-cache', `bypass: ${decision.reason}`);
    }

    await this.keep(cache, store.storeId, epoch, path, response);
    return withHeader(response, 'x-cache', 'miss');
  }

  /** Stores a rendered page, with its nonce swapped out. */
  private async keep(
    cache: PageCache,
    storeId: string,
    epoch: number,
    path: string,
    response: StorefrontResponse,
  ): Promise<void> {
    /**
     * A fresh marker per entry, from `randomUUID`.
     *
     * The security-relevant line in this file. A fixed marker would let someone
     * store `<script nonce="MARKER">` in a product title and have the cache
     * substitute a live nonce into it on the way out — the policy defeated
     * using our own machinery. This value is random and never leaves the
     * process, so there is nothing to write down in advance.
     */
    const placeholder = response.nonce ? `df-nonce-${randomUUID()}` : null;
    const swap = (value: string): string =>
      placeholder && response.nonce ? substitute(value, response.nonce, placeholder) : value;

    /**
     * Only a rendered page reaches here.
     *
     * `decideCacheable` refuses anything that is not `text/html`, so an asset's
     * Buffer never arrives — this states that rather than casting it away, so a
     * future caller that starts caching assets fails loudly instead of storing
     * a body the nonce substitution would corrupt.
     */
    if (typeof response.body !== 'string') return;

    const ttl = (this.options.pageCacheTtlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    const expiresAt = Date.now() + ttl;

    await cache.set(fullCacheKey(storeId, epoch, response.cacheKey as string), {
      status: response.status,
      // Headers are swapped too: the nonce appears in the policy as well as in
      // the markup, and the two must still agree after substitution.
      headers: Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [name, swap(value)]),
      ),
      body: swap(response.body),
      noncePlaceholder: placeholder,
      expiresAt,
    });

    // And the lesson about this path, so the next request can build the key.
    await cache.set(varyKey(storeId, epoch, path), {
      status: 200,
      headers: {},
      body: JSON.stringify(response.cacheVary ?? []),
      noncePlaceholder: null,
      expiresAt,
    });
  }

  private async serve(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const path = input.path.split('?')[0] ?? '/';

    /**
     * A theme's own files, before anything else looks at the path.
     *
     * Before redirects and before routing, because an asset is not a page: a
     * merchant's redirect rule for `/assets/old.css` would otherwise intercept
     * a file the theme is asking for, and `matchRoute` would spend a database
     * lookup deciding that `/assets/theme.css` is not a product.
     */
    const assetPath = assetPathFor(path);
    if (assetPath !== null) {
      // A `v=` in the query means the URL identifies one version of the file,
      // which is what makes an immutable cache safe.
      return this.asset(store, assetPath, new URLSearchParams(input.query).has('v'));
    }

    /**
     * The section-rendering endpoint a theme's JavaScript fetches.
     *
     * Before routing, because `/recommendations/products` is not a page and
     * `matchRoute` would spend a lookup deciding it is not a product either.
     */
    if (path === '/recommendations/products') {
      return this.recommendations(store, input);
    }

    /**
     * What a shopper is probably looking for, while they are still typing.
     *
     * Same shape as the recommendations endpoint and for the same reason: the
     * theme names one of its OWN sections and gets that section's markup back.
     */
    if (path === '/search/suggest') {
      return this.suggest(store, input);
    }

    /**
     * `/variants/{id}?section_id=…` — pickup availability for one variant.
     *
     * The theme re-fetches this every time a customer picks a different size,
     * because whether it can be collected is a property of the variant and not
     * of the product.
     */
    const variantMatch = /^\/variants\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (variantMatch) {
      return this.variantSection(store, input, variantMatch[1] as string);
    }

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

    /**
     * One nonce per render, and never reused.
     *
     * A nonce a theme could predict is not a nonce, so it comes from
     * `randomUUID` rather than anything derived from the request — two visitors
     * on the same cached path must not share one.
     */
    const nonce = this.options.csp?.enabled ? randomUUID().replace(/-/g, '') : null;

    const engineContext: RenderContext = defaultContext({
      currency: shop.currency as never,
      assetBaseUrl: `https://${shop.domain}/assets`,
      cdnBaseUrl: `https://${shop.domain}/files`,
      platformAssetBaseUrl: `https://${shop.domain}/platform`,
      assetVersion: store.themeVersion ?? undefined,
      translations: await this.translationsFor(store),
      nonce,
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
     * The nonce, so a theme can mark its own inline script as its own.
     *
     * Consistent with the threat model rather than a hole in it: a theme is
     * installed code that can already emit whatever it likes through
     * `{% javascript %}`. What the policy protects against is INJECTED content —
     * a reflected parameter, a product title carrying markup — and none of that
     * can reach this value.
     *
     * Without it, every theme writing `<script>` directly stops working the day
     * the policy is enforced, and the only fix would be rewriting other
     * people's themes. `theme:check` reports the ones that need it.
     */
    scope.content_security_policy_nonce = nonce ?? '';

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
      linkSchemes: this.options.linkSchemes ?? [],
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
        ...(nonce
          ? {
              [cspHeaderName(!this.options.csp?.enforce)]: buildCsp({
                nonce,
                assetHosts: [`https://${shop.domain}`],
                frameAncestors: this.options.frameAncestors,
                reportOnly: !this.options.csp?.enforce,
                reportUri: this.options.csp?.reportUri ?? null,
              }),
            }
          : {}),
      },
      /**
       * A title only if the theme did not write one.
       *
       * Applied here rather than in `content_for_header`, because only the
       * finished document can answer whether a theme emitted one — and every
       * real theme does, so for them this changes nothing.
       */
      body: withTitleFallback(page.html, String(scope.page_title ?? shop.name), shop.name),
      /**
       * The key includes exactly the parameters this render read.
       *
       * A page that read nothing caches by path; one that read `?variant`
       * caches per variant. Without this the first visitor's parameters would
       * be served to everyone after them.
       *
       * A nonced page is cacheable, which it was not when the policy landed.
       * The nonce is swapped for a per-entry random marker on the way in and a
       * fresh one substituted on the way out, so a cached body carries no
       * nonce at all and no two visitors share one.
       */
      cacheKey: status === 200 ? cacheKeyFor(path, input.query, access.readKeys()) : null,
      cacheVary: access.readKeys(),
      nonce,
    };
  }

  /**
   * The theme's own wording, read once per version.
   *
   * Cached because a locale file is hundreds of keys and re-reading and
   * re-flattening it per request would be real work for a value that cannot
   * change without the version changing. Keyed by version reference for that
   * reason — a publish produces a new one, so the cache cannot go stale.
   *
   * A theme with no locale files renders with none, which is how the storefront
   * behaved before this existed. Refusing to serve a page over a missing
   * translation file would be worse than the missing translations.
   */
  private async translationsFor(store: ResolvedStore): Promise<Record<string, string>> {
    const key = store.themeVersion ?? store.storeId;
    const cached = this.translations.get(key);
    if (cached) return cached;

    let loaded: Record<string, string> = {};
    try {
      const file = localeFileFor(await store.theme.list('locales'), 'en');
      if (file) {
        const contents = await store.theme.read(`locales/${file}`);
        if (contents) loaded = flattenTranslations(JSON.parse(contents));
      }
    } catch {
      // Malformed JSON in one locale file must not take the storefront down.
      // The page renders with `translation missing`, which says what is wrong.
      loaded = {};
    }

    this.translations.set(key, loaded);
    return loaded;
  }

  /**
   * The theme's settings, read once per version.
   *
   * Cached for the same reason as the translations and keyed the same way: the
   * file cannot change without the version changing, so a publish invalidates
   * it by producing a new key.
   */
  private async settingsFor(store: ResolvedStore): Promise<Record<string, unknown>> {
    const key = store.themeVersion ?? store.storeId;
    const cached = this.settings.get(key);
    if (cached) return cached;

    let loaded: Record<string, unknown> = {};
    try {
      const contents = await store.theme.read('config/settings_data.json');
      if (contents) {
        loaded = resolveLinkSettings(
          resolveColorSettings(resolveThemeSettings(JSON.parse(contents))),
          this.options.linkSchemes ?? [],
        );
      }
    } catch {
      // A settings file a merchant has broken costs them their colours, not
      // their storefront: the theme's own defaults are still a page.
      loaded = {};
    }

    this.settings.set(key, loaded);
    return loaded;
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
     *
     * Read through `access.params` rather than from the query string directly,
     * and that is not a stylistic choice: the proxy is what RECORDS which
     * parameters a render depended on, and the page cache keys on exactly that
     * list. Reading the query directly meant `page` was never recorded, so
     * `?page=2` was served the cached copy of page one — the precise bug the
     * read-key design exists to prevent, reintroduced by going around it.
     */
    const requested = Number(access.params.page ?? 1);
    const page = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1;

    const base: Record<string, unknown> = {
      shop: shopDrop(shop, drops),
      /**
       * The merchant's theme configuration, from the theme's own file.
       *
       * Read here rather than through `StorefrontData` because it lives in the
       * THEME, not in the database — `data.settings()` returned an empty object
       * and said the theme source reads it, which nothing did. A store-level
       * override belongs in that port when there is one; there is not yet.
       */
      settings: await this.settingsFor(store),
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
      /**
       * Where things live, which themes never hardcode.
       *
       * Absent, every `{{ routes.cart_url }}` rendered empty — and the theme
       * puts them into a JavaScript config on every page, so its scripts were
       * fetching `''`, which is the current page.
       */
      routes: routesDrop({}, drops),
      /**
       * Asked: no.
       *
       * An answer rather than an absence — see `drops/recommendations.ts`.
       */
      recommendations: recommendationsDrop(NOT_PERFORMED, drops),
      /**
       * Typed: nothing yet.
       *
       * The header renders the search dropdown's shell on every page, and the
       * section counts `resources.products.size` before anyone has typed.
       */
      predictive_search: predictiveSearchDrop(NO_SEARCH, drops),
      /**
       * The page number, as a GLOBAL and not only inside `request`.
       *
       * Themes compare it directly — the reference theme's `<title>` is guarded
       * by `{% if current_page != 1 %}` — and an undefined value is not equal
       * to 1, so the guard passed on every page and every title on the site
       * read "Demo Store – Page {{ page }}". A missing global does not error in
       * Liquid; it quietly makes a condition true.
       */
      current_page: page,
      /**
       * The tags a collection is being filtered by.
       *
       * Null, NOT an empty array. An empty array is TRUTHY in Liquid, so `[]`
       * made `{% if current_tags %}` pass and every title on the site gained a
       * trailing `Tagged ""`. Null is how a theme is told there are none — and
       * it is what the reference product supplies. Tag filtering itself is not
       * built yet.
       */
      current_tags: null,
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

  /**
   * One of the theme's files, as bytes.
   *
   * Read through `readBytes` rather than `read`: a PNG decoded as UTF-8 has
   * every invalid byte sequence replaced, so what reaches the browser is not
   * what is on disk. A source that cannot do that serves nothing rather than
   * serving something corrupt.
   */
  private async asset(
    store: ResolvedStore,
    themePath: string,
    versioned = false,
  ): Promise<StorefrontResponse> {
    const source = store.theme;
    if (!source.readBytes) {
      return text(404, 'Not found');
    }

    let bytes: Buffer | null;
    try {
      bytes = await source.readBytes(themePath);
    } catch {
      // `confinePath` throws for a name that is not a theme path. A request for
      // one is a 404 rather than a 500: it is a URL that does not exist here.
      return text(404, 'Not found');
    }

    if (bytes === null) return text(404, 'Not found');

    const decided = assetResponseFor(themePath, versioned);

    return {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': decided.contentType,
        'cache-control': decided.cacheControl,
        ...(decided.inline
          ? {}
          : { 'content-disposition': 'attachment' }),
      },
      body: bytes,
      // Cached by the URL alone: an asset does not vary on anything, and its
      // path is the whole of its identity.
      cacheKey: themePath,
    };
  }

  /**
   * Products worth showing beside another one, as rendered markup.
   *
   * HTML rather than JSON because that is what the theme asks for: its script
   * fetches this, parses the response as a document and lifts one element out
   * of it. Returning JSON would mean every theme rewriting its own carousel.
   *
   * The section is named by the CALLER, which is the interesting part — a theme
   * decides which of its own sections renders the answer, so the platform never
   * needs to know what a recommendation looks like.
   */
  private async recommendations(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const query = new URLSearchParams(input.query);
    const productId = (query.get('product_id') ?? '').trim();
    const sectionId = (query.get('section_id') ?? '').trim();

    if (productId === '' || sectionId === '') {
      return text(422, 'A product_id and a section_id are required.');
    }

    const shop = await store.data.shop();
    const limit = normaliseLimit(query.get('limit'));
    const intent = normaliseIntent(query.get('intent'));

    const products = await store.data.recommendedProducts(productId, limit);

    const drops = createDropContext({
      currency: shop.currency,
      locale: 'en',
      baseUrl: `https://${shop.domain}`,
      load: loadersFor(store.data),
    });

    const engineContext: RenderContext = defaultContext({
      currency: shop.currency as never,
      assetBaseUrl: `https://${shop.domain}/assets`,
      cdnBaseUrl: `https://${shop.domain}/files`,
      platformAssetBaseUrl: `https://${shop.domain}/platform`,
      assetVersion: store.themeVersion ?? undefined,
      translations: await this.translationsFor(store),
    });

    const scope: Record<string, unknown> = {
      shop: shopDrop(shop, drops),
      settings: await this.settingsFor(store),
      routes: routesDrop({}, drops),
      /**
       * `performed: true` is the whole point of the request.
       *
       * The same theme template renders on the product page, where nobody has
       * asked, and here, where somebody has. Without this it cannot tell an
       * unasked question from an empty answer.
       */
      recommendations: recommendationsDrop({ performed: true, intent, products }, drops),
    };

    const engine = createThemeEngine(engineContext, { source: store.theme, globals: scope });
    const renderer = new PageRenderer(engine, store.theme, {
      explainFailures: this.options.explainFailures ?? false,
      linkSchemes: this.options.linkSchemes ?? [],
    });

    const { html, found } = await renderer.renderSectionAlone(sectionId, scope);
    if (!found) return text(404, 'No such section.');

    return {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        // Recommendations follow the catalogue, so they are cached briefly and
        // revalidated rather than held for the page's lifetime.
        'cache-control': 'public, max-age=60, must-revalidate',
      },
      body: html,
      // Keyed by everything that changes the answer.
      cacheKey: `/recommendations/products?p=${productId}&s=${sectionId}&l=${limit}&i=${intent}`,
    };
  }

  /**
   * A section rendered for one variant, for the pickup-availability fetch.
   *
   * Shares its shape with the recommendations endpoint: the theme names one of
   * its OWN sections and receives that section's markup, so the platform never
   * has to know what pickup availability should look like.
   */
  private async variantSection(
    store: ResolvedStore,
    input: StorefrontRequestInput,
    variantId: string,
  ): Promise<StorefrontResponse> {
    const sectionId = (new URLSearchParams(input.query).get('section_id') ?? '').trim();
    if (sectionId === '') return text(422, 'A section_id is required.');

    const shop = await store.data.shop();
    const drops = createDropContext({
      currency: shop.currency,
      locale: 'en',
      baseUrl: `https://${shop.domain}`,
      load: loadersFor(store.data),
    });

    const engineContext: RenderContext = defaultContext({
      currency: shop.currency as never,
      assetBaseUrl: `https://${shop.domain}/assets`,
      cdnBaseUrl: `https://${shop.domain}/files`,
      platformAssetBaseUrl: `https://${shop.domain}/platform`,
      assetVersion: store.themeVersion ?? undefined,
      translations: await this.translationsFor(store),
    });

    /**
     * The variant is built from its id alone.
     *
     * Everything the section reads hangs off `store_availabilities`, which is
     * loaded by id — so fetching the variant row first would be a query whose
     * only purpose was to prove the id exists. A variant that does not exist
     * has no availabilities, and the section renders nothing, which is the
     * right answer either way.
     */
    const scope: Record<string, unknown> = {
      shop: shopDrop(shop, drops),
      settings: await this.settingsFor(store),
      routes: routesDrop({}, drops),
      product_variant: variantDrop({ id: variantId, productId: '' }, drops),
    };

    const engine = createThemeEngine(engineContext, { source: store.theme, globals: scope });
    const renderer = new PageRenderer(engine, store.theme, {
      explainFailures: this.options.explainFailures ?? false,
      linkSchemes: this.options.linkSchemes ?? [],
    });

    const { html, found } = await renderer.renderSectionAlone(sectionId, scope);
    if (!found) return text(404, 'No such section.');

    return {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        /**
         * Not cached at all.
         *
         * Stock changes with every order, and a customer told a shop has one
         * left drives there. Sixty seconds of staleness is cheap for a
         * recommendation and expensive for this.
         */
        'cache-control': 'no-store',
      },
      body: html,
      cacheKey: null,
    };
  }

  /**
   * Search results while the shopper is still typing, as rendered markup.
   *
   * An empty `q` is answered with an unperformed search rather than a 422: the
   * theme clears the field and re-fetches, and an error there would put a
   * failure in the dropdown for the ordinary act of deleting what you typed.
   *
   * Not cached. A search term is close to a fingerprint of the person typing
   * it, and holding thousands of one-hit entries would push the pages that are
   * actually read back out of the cache.
   */
  private async suggest(
    store: ResolvedStore,
    input: StorefrontRequestInput,
  ): Promise<StorefrontResponse> {
    const query = new URLSearchParams(input.query);
    const sectionId = (query.get('section_id') ?? '').trim();
    if (sectionId === '') return text(422, 'A section_id is required.');

    const terms = normaliseSearchTerms(query.get('q'));
    const shop = await store.data.shop();

    const drops = createDropContext({
      currency: shop.currency,
      locale: 'en',
      baseUrl: `https://${shop.domain}`,
      load: loadersFor(store.data),
    });

    const engineContext: RenderContext = defaultContext({
      currency: shop.currency as never,
      assetBaseUrl: `https://${shop.domain}/assets`,
      cdnBaseUrl: `https://${shop.domain}/files`,
      platformAssetBaseUrl: `https://${shop.domain}/platform`,
      assetVersion: store.themeVersion ?? undefined,
      translations: await this.translationsFor(store),
    });

    /**
     * Nothing typed is not the same as nothing found.
     *
     * `performed: false` makes the theme render its empty state — the recent
     * searches and default panel — instead of "no results for ''".
     */
    const found =
      terms === ''
        ? NO_SEARCH
        : { performed: true, terms, results: await store.data.search(terms, 10) };

    const scope: Record<string, unknown> = {
      shop: shopDrop(shop, drops),
      settings: await this.settingsFor(store),
      routes: routesDrop({}, drops),
      predictive_search: predictiveSearchDrop(found, drops),
    };

    const engine = createThemeEngine(engineContext, { source: store.theme, globals: scope });
    const renderer = new PageRenderer(engine, store.theme, {
      explainFailures: this.options.explainFailures ?? false,
      linkSchemes: this.options.linkSchemes ?? [],
    });

    const rendered = await renderer.renderSectionAlone(sectionId, scope);
    if (!rendered.found) return text(404, 'No such section.');

    return {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: rendered.html,
      // Never cached — see the note above the method.
      cacheKey: null,
    };
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
 * A cached page becomes a response, with a nonce nobody has seen before.
 *
 * The substitution is why a cached storefront and a Content-Security-Policy can
 * coexist. Without it the choice is a cache that replays one nonce to everyone
 * — which is not a nonce — or no cache at all.
 */
function fromCache(entry: CachedPage): StorefrontResponse {
  const nonce = entry.noncePlaceholder ? randomUUID().replace(/-/g, '') : null;
  const swap = (value: string): string =>
    entry.noncePlaceholder && nonce ? substitute(value, entry.noncePlaceholder, nonce) : value;

  return {
    status: entry.status,
    headers: {
      ...Object.fromEntries(
        Object.entries(entry.headers).map(([name, value]) => [name, swap(value)]),
      ),
      'x-cache': 'hit',
    },
    body: swap(entry.body),
    // Already stored; re-storing what we just read would only reset its expiry.
    cacheKey: null,
    nonce,
  };
}

/**
 * The remembered vary list, defensively.
 *
 * A malformed entry means no caching for that path rather than a 500 — a cache
 * that can take the site down is worse than the requests it saves.
 */
function parseVary(body: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function withHeader(
  response: StorefrontResponse,
  name: string,
  value: string,
): StorefrontResponse {
  return { ...response, headers: { ...response.headers, [name]: value } };
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
    availabilitiesOfVariant: ((id: string) => data.availabilitiesOfVariant(id)) as never,
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
