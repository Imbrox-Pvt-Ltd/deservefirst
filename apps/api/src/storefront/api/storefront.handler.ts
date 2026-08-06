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
  cartDrop,
  normaliseQuantity,
  requestCookieHeader,
  requestTokenFrom,
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
  facetsAreActive,
  parseFilterCriteria,
  parseSort,
  DEFAULT_SORT,
  FACET_PARAM_KEYS,
  NO_FILTERS,
  type FilterCriteria,
  predictiveSearchDrop,
  normaliseSearchTerms,
  NO_SEARCH,
  normaliseIntent,
  normaliseLimit,
  NOT_PERFORMED,
  articleDrop,
  blogDrop,
  searchDrop,
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
  /**
   * The raw Cookie header, for the draft request a visitor is carrying.
   *
   * Raw rather than parsed, so the storefront decides what it will read. A
   * parsed bag invites the next caller to trust whatever is in it.
   */
  readonly cookies?: string | null;
  /**
   * Whether this arrived over HTTPS.
   *
   * Decides `Secure` and the `__Host-` cookie prefix, which cannot be guessed
   * from the hostname: development serves real store hostnames over plain
   * HTTP, and a browser silently DROPS a Secure cookie there — so the whole
   * flow would appear to work and never persist a single line.
   */
  readonly secure?: boolean;
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
  /**
   * Property names other platforms read, mapped to ours.
   *
   * From `config/theme-compat.json`. Without them a theme written elsewhere
   * reads a name we do not answer to and renders nothing where the value it
   * wanted already exists under our own name.
   */
  readonly propertyAliases?: Readonly<Record<string, string>>;
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
/**
 * Records properties a theme reads that no drop declares.
 *
 * Off unless `DF_DROP_AUDIT` is set, because it turns every drop into a Proxy.
 * With it on, fetching a store's own pages prints the exact list of what its
 * theme expects and we do not provide — the thing repeated static sweeps kept
 * failing to find, because a nested read like `filter.min_value.value` is
 * invisible to a check that only looks at which objects a theme names.
 *
 * Each miss is printed once. A property read inside a `{% for %}` over 200
 * products is one gap, not two hundred lines of log.
 */
const DROP_AUDIT: ((dropName: string, property: string) => void) | undefined =
  process.env.DF_DROP_AUDIT
    ? (() => {
        const seen = new Set<string>();
        return (dropName: string, property: string): void => {
          const entry = `${dropName}.${property}`;
          if (seen.has(entry)) return;
          seen.add(entry);
          process.stderr.write(`DROP-MISS ${entry}\n`);
        };
      })()
    : undefined;

/**
 * Whether a render has read data belonging to one visitor.
 *
 * A Proxy rather than a flag set where the drop is built, because building it
 * is not the problem — a page that never prints the cart is perfectly
 * shareable, and marking every page personal because the object was in scope
 * would turn the page cache off for the whole platform.
 */
interface PersonalData {
  watch<T extends object>(value: T): T;
  touched(): boolean;
}

function watchPersonalData(): PersonalData {
  let seen = false;
  return {
    watch(value) {
      return new Proxy(value, {
        get(target, key, receiver) {
          // Engine probes are not reads of anybody's data; liquidjs asks every
          // value whether it is a promise before doing anything with it.
          if (key !== 'then' && key !== 'toLiquid') seen = true;
          return Reflect.get(target, key, receiver);
        },
      });
    },
    touched: () => seen,
  };
}

/** For the render paths that have no cache and no visitor data to protect. */
function neverPersonal(): PersonalData {
  return { watch: (value) => value, touched: () => false };
}

/**
 * A policy in the shape the page template expects.
 *
 * Null for one that has not been written: an unwritten policy is not a blank
 * page a shopper should be able to land on, it is a page that does not exist.
 */
async function policyAsPage(data: StorefrontData, handle: string) {
  const policy = await data.policyByHandle(handle);
  if (!policy) return null;
  return {
    id: policy.id,
    handle: policy.handle,
    title: policy.title,
    body: policy.body ?? '',
    templateSuffix: null,
    publishedAt: null,
    updatedAt: null,
  };
}

/** The path without its query, for matching an endpoint. */
function canonicalPathOf(path: string): string {
  const index = path.indexOf('?');
  return index === -1 ? path : path.slice(0, index);
}

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
      input.method === 'POST'
        ? input.path.startsWith('/cart/')
          ? this.mutateRequest(store, input, canonicalPathOf(input.path))
          : this.submit(store, input)
        : this.serveCached(store, input),
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

    /**
     * How this visitor has narrowed and ordered the list.
     *
     * Parsed once and handed to the loaders, so a theme reading
     * `collection.products` gets the filtered list without knowing filters
     * exist — which is what lets a theme written elsewhere work unchanged.
     */
    const view: CollectionView = {
      criteria: parseFilterCriteria(input.query),
      sort: parseSort(input.query),
      currentUrl: input.query === '' ? input.path : `${input.path}?${input.query}`,
      /**
       * Filled in by `scopeFor` once the page's own collection is known.
       *
       * Without it, a "featured collection" section on a filtered page would be
       * filtered too — a shopper ticking "Blue" would empty a carousel that has
       * nothing to do with what they ticked.
       */
      collectionId: null,
    };

    /**
     * Watches whether this render read anything belonging to one visitor.
     *
     * The reference theme's header prints `data-cart-count="{{ cart.item_count }}"`
     * on EVERY page, so the markup of an ordinary product page contains one
     * shopper's cart. A shared cache entry built from that would hand the next
     * visitor somebody else's basket count — so a page that touched the cart is
     * not cacheable, and the flag has to come from the render itself rather
     * than from a guess about which pages are personal.
     */
    const personal = watchPersonalData();

    const drops = createDropContext({
      onMissingProperty: DROP_AUDIT,
      propertyAliases: this.options.propertyAliases,
      currency: shop.currency,
      locale: 'en',
      baseUrl: `https://${shop.domain}`,
      load: loadersFor(store.data, view),
    });

    // Built before the engine, because the drops become its globals.
    const { scope, found } = await this.scopeFor(
      store, match, drops, budget, shop, input, access, view, personal,
    );

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
    /**
     * The theme's own reads, plus the parameters the platform read for it.
     *
     * Filters and sort are consumed before a theme sees them, so nothing
     * records them as a dependency — and without them here a filtered page is
     * stored under the unfiltered key and served to everyone.
     *
     * Only on a collection, which is the only page they change. Adding them
     * everywhere would put six names in every product page's vary list to
     * describe a dependency that page does not have.
     */
    const varyKeys = [
      ...new Set([
        ...access.readKeys(),
        // A collection varies on its filters and sort; a search page varies on
        // the term. Both are read by the platform rather than by the theme, so
        // neither is recorded by watching `request.params` — and a page whose
        // key omits them is stored once and served to everyone. That is not
        // hypothetical: `?q=cotton` returned the results for `?q=linen`.
        ...(match.pageType === 'collection' ? FACET_PARAM_KEYS : []),
        ...(match.pageType === 'search' ? ['q'] : []),
      ]),
    ];

    return {
      status,
      headers: {
        ...SECURITY_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        link: `<${canonical}>; rel="canonical"`,
        /**
         * A filtered view is not a page of its own (§37.6).
         *
         * The canonical already names the unfiltered collection, but a
         * canonical is a hint rather than an instruction — search engines
         * honour it only while every other signal agrees. A catalogue of 200
         * products has tens of thousands of filter combinations, and each one
         * indexed separately is thin duplicate content competing with the page
         * the merchant actually wants ranked.
         *
         * `follow`, not `nofollow`: the products linked from a filtered view
         * are real pages that should still be discovered and still pass their
         * signals on. It is the combination page that must not be indexed, not
         * the catalogue behind it.
         */
        ...(facetsAreActive(view.criteria) ? { 'x-robots-tag': 'noindex, follow' } : {}),
        'cache-control':
          status !== 200
            ? 'no-store'
            : personal.touched()
              ? 'private, no-store'
              : 'public, max-age=0, s-maxage=60',
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
      /**
       * The theme's own reads, plus the parameters the platform read for it.
       *
       * Filters and sort are consumed before a theme sees them, so nothing
       * records them as a dependency — and without them here a filtered page
       * is stored under the unfiltered key and served to everyone.
       */
      /**
       * Never cached once the render has read this visitor's own data.
       *
       * `private` rather than `public` for the same reason: a proxy between us
       * and the browser must not keep it either.
       */
      cacheKey:
        status === 200 && !personal.touched() ? cacheKeyFor(path, input.query, varyKeys) : null,
      cacheVary: varyKeys,
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
    view?: CollectionView,
    personal: PersonalData = neverPersonal(),
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
       * The list this visitor has been building, on EVERY page.
       *
       * The header renders `cart.item_count` everywhere, so a cart that only
       * existed on `/cart` would be a badge reading zero on every other page.
       */
      /**
       * An absent implementation means an empty cart, not a broken page.
       *
       * The same rule the drops follow for every other loader: the theme
       * editor and the tests render without a full data source behind them,
       * and a header that throws takes the whole page with it.
       */
      cart: personal.watch(
        cartDrop(
          (await data.draftRequest?.(requestTokenFrom(input.cookies))) ?? {
            items: [],
            currency: shop.currency,
          },
          drops,
        ),
      ),
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
      /**
       * The search results page.
       *
       * There was no branch here at all, so `/search?q=…` rendered its layout
       * with no `search` object and showed nothing — a 200 that looked like a
       * shop with an empty catalogue. The drop had existed the whole time.
       */
      case 'search': {
        const terms = normaliseSearchTerms(new URLSearchParams(input.query).get('q'));
        const results = terms === ''
          ? { products: [], collections: [], pages: [], articles: [], queries: [] }
          : await data.search(terms, 50);

        /**
         * One list, in the order a shopper expects to find things.
         *
         * Products first because that is what a shop is for; pages and
         * articles after, where somebody searching "returns" will still find
         * the policy.
         */
        const found = [
          ...results.products.map((row) => productDrop(row, drops)),
          ...results.pages.map((row) => pageDrop(row, drops)),
          ...results.articles.map((row) => articleDrop(row, drops)),
        ];

        return {
          scope: {
            ...base,
            page_title: terms === '' ? 'Search' : `Search: ${terms}`,
            search: searchDrop(
              {
                terms,
                // Asked, as distinct from asked and found nothing — the same
                // distinction the recommendations and predictive search drops
                // turn on.
                performed: terms !== '',
                resultsCount: found.length,
                results: found,
                // The same ordering controls a collection has; the theme
                // renders one snippet for both.
                currentSort: parseSort(input.query),
              },
              drops,
            ),
            paginate: paginateDrop(
              { currentPage: page, currentOffset: 0, items: found.length, pageSize: 24, basePath: input.path },
              drops,
            ),
          },
          found: true,
        };
      }

      case 'collection': {
        const row = await data.collectionByHandle(match.handle ?? '');
        if (!row) return { scope: base, found: false };
        /**
         * Named before anything reads a loader, so the filters apply to THIS
         * collection and to no other one the page happens to render.
         */
        if (view) view.collectionId = row.id;
        const collection = collectionDrop(row, drops);
        /**
         * Awaited here rather than left for the drop to await.
         *
         * The loaders are promises behind a synchronous signature, which is
         * what makes drops lazy — but a promise handed to a drop that the theme
         * never reads is a promise nobody ever awaits, and a rejected one of
         * those takes the whole process down rather than failing this request.
         * That is not theoretical: this exact line crashed the API for every
         * tenant when the query underneath it was wrong.
         *
         * A collection page counts its products to draw pagination, so nothing
         * is lost by asking now.
         */
        const items = await data.productCountOfCollection(row.id, view?.criteria);
        return {
          scope: {
            ...base,
            page_title: row.title,
            collection,
            paginate: paginateDrop(
              { currentPage: page, currentOffset: 0, items, pageSize: 24, basePath: input.path },
              drops,
            ),
          },
          found: true,
        };
      }
      case 'page': {
        /**
         * A policy is loaded as a page, because that is what a theme renders
         * it with — see the router. The `policy` object exists separately for
         * `shop.refund_policy`; this is the page a shopper lands on.
         */
        const row =
          match.parentHandle === 'policies'
            ? await policyAsPage(data, match.handle ?? '')
            : await data.pageByHandle(match.handle ?? '');
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

        /**
         * The blog is in scope beside the article, carrying which post is
         * being read.
         *
         * Themes render "previous / next post" from `blog.next_article`, which
         * is asked OF the blog — so the blog has to be told which post the page
         * is about; it has no other way to know.
         */
        const blog = await data.blogByHandle(match.parentHandle ?? '');

        return {
          scope: {
            ...base,
            article: articleDrop(row, drops),
            ...(blog ? { blog: blogDrop({ ...blog, currentArticleId: row.id }, drops) } : {}),
            page_title: row.title,
          },
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
      onMissingProperty: DROP_AUDIT,
      propertyAliases: this.options.propertyAliases,
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
      onMissingProperty: DROP_AUDIT,
      propertyAliases: this.options.propertyAliases,
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
      onMissingProperty: DROP_AUDIT,
      propertyAliases: this.options.propertyAliases,
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

  /**
   * Adding to, changing or emptying the draft request.
   *
   * Phase 1 sells nothing (§25), so this assembles a Request/RFQ rather than a
   * cart that leads to a checkout. Themes address it as the cart because that
   * is the object their markup already knows.
   *
   * Answers with a redirect rather than JSON. The theme's own scripts expect
   * JSON from these paths and will be given it when the endpoints are wired to
   * them; a redirect is what a plain HTML form needs, and it is the version
   * that works with JavaScript switched off — which is the one worth having
   * first, because it is the one that cannot silently stop working.
   */
  private async mutateRequest(
    store: ResolvedStore,
    input: StorefrontRequestInput,
    path: string,
  ): Promise<StorefrontResponse> {
    /**
     * A cross-site POST is refused outright.
     *
     * A browser sends `Origin` on every POST and cannot be made to lie about
     * it, so comparing it to the host this store answers on is the whole check.
     * Without it, any page anywhere could empty a shopper's list.
     */
    const origin = (input.origin ?? '').trim();
    if (origin !== '') {
      const host = normaliseHost(input.host);
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase().replace(/:\d+$/, '');
      } catch {
        originHost = '';
      }
      if (originHost !== host) return text(403, 'That request did not come from this store.');
    }

    const fields = input.form ?? {};
    const token = requestTokenFrom(input.cookies);
    let settled = token;

    if (path === '/cart/add') {
      const variantId = String(fields.id ?? fields.variant_id ?? '').trim();
      // Absent quantity means one, which is what an "Add to list" button sends.
      const quantity = fields.quantity === undefined ? 1 : normaliseQuantity(fields.quantity);
      if (variantId === '' || quantity <= 0) {
        return text(422, 'A variant and a quantity are required.');
      }
      const result = await store.data.addToRequest(token, variantId, quantity);
      /**
       * A variant this store does not have is refused, not ignored.
       *
       * The id came from a form, so it names whatever the sender chose — and
       * silently succeeding would leave a shopper looking at a list that did
       * not gain the thing they asked for.
       */
      if (!result.added) return text(422, 'That product is not available.');
      settled = result.token;
    } else if (path === '/cart/change' || path === '/cart/update') {
      const lineId = String(fields.line ?? fields.id ?? '').trim();
      if (token && lineId !== '') {
        await store.data.setRequestLine(token, lineId, normaliseQuantity(fields.quantity));
      }
    } else if (path === '/cart/submit') {
      return this.submitRequest(store, input, token);
    } else if (path === '/cart/clear') {
      if (token) await store.data.clearRequest(token);
    } else {
      return text(404, 'No such endpoint.');
    }

    const back = typeof fields.return_to === 'string' && fields.return_to.startsWith('/')
      ? fields.return_to
      : '/cart';

    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      location: back,
      // Never cached: this is one visitor's list, and the response carries the
      // cookie that names it.
      'cache-control': 'no-store',
    };

    /**
     * The cookie is set only when there is a token to set.
     *
     * Re-sending it on every change would refresh its lifetime on each click,
     * which is harmless — but sending one for a visitor who has no draft at all
     * hands out an identifier for nothing.
     */
    if (settled) {
      headers['set-cookie'] = requestCookieHeader(settled, input.secure ?? false);
    }

    return { status: 303, headers, body: '', cacheKey: null };
  }

  /**
   * Sends the list a shopper has been building.
   *
   * The end of the Phase 1 flow (§25): no checkout and no payment, a merchant
   * receives the request and answers it. Until this existed a shopper could
   * assemble a list and then do nothing with it, which is a shop that cannot be
   * asked for anything.
   *
   * Rate limited with the same budget as every other submission, because this
   * is the one place an anonymous stranger causes a merchant to be notified —
   * and an unlimited one is a way to fill somebody's inbox.
   */
  private async submitRequest(
    store: ResolvedStore,
    input: StorefrontRequestInput,
    token: string | null,
  ): Promise<StorefrontResponse> {
    const submissions = store.submissions;
    if (!submissions) return text(503, 'This store cannot take requests yet.');

    const fields = input.form ?? {};
    const email = String(fields.email ?? '').trim();
    const name = String(fields.name ?? '').trim();
    const message = String(fields.body ?? fields.message ?? '').trim();

    /**
     * An address is the whole point.
     *
     * A request nobody can reply to is not a request; it is a row that will sit
     * in a queue until somebody deletes it. Checked before the rate limit is
     * spent, so a shopper who mistypes their address does not also lose their
     * budget for the retry.
     */
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return text(422, 'A valid email address is required to send this request.');
    }

    const draft = token ? await store.data.draftRequestRef(token) : null;
    // An empty list is not something to send a merchant.
    if (!draft || draft.lineCount === 0) {
      return text(422, 'There is nothing in this request to send.');
    }

    if (this.options.submissionLimit) {
      const decision = await this.options.submissionLimit(
        `request:${normaliseHost(input.host)}:${input.clientIp ?? 'unknown'}`,
      );
      if (!decision.allowed) {
        return text(429, 'Too many requests. Please wait a moment and try again.', {
          'retry-after': String(Math.max(1, decision.retryAfterSeconds)),
        });
      }
    }

    const { reference } = await submissions.submitRequest({
      requestId: draft.id,
      version: draft.version,
      contactEmail: email,
      contactName: name === '' ? null : name,
      message: message === '' ? null : message,
    });

    /**
     * The cookie is cleared, so the next thing added starts a new draft.
     *
     * The row is no longer a draft, so `draftRequest` would return an empty
     * cart for this token anyway — but leaving a token that names a submitted
     * request pointing at nothing is a confusing thing to carry around, and
     * clearing it is one header.
     */
    return {
      status: 303,
      headers: {
        ...SECURITY_HEADERS,
        location: `/cart?request=${encodeURIComponent(reference)}`,
        'cache-control': 'no-store',
        'set-cookie': requestCookieHeader('', input.secure ?? false).replace(
          /Max-Age=\d+/,
          'Max-Age=0',
        ),
      },
      body: '',
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
/**
 * What one visitor has asked to see of a collection.
 *
 * `collectionId` is mutable on purpose: the filters belong to the page's own
 * collection, and which collection that is only becomes known after the route
 * has been resolved and the row loaded — by which time the loaders have already
 * been handed to the drops.
 */
interface CollectionView {
  readonly criteria: FilterCriteria;
  readonly sort: string;
  readonly currentUrl: string;
  collectionId: string | null;
}

function loadersFor(
  data: StorefrontData,
  view?: CollectionView,
): Record<string, (...args: never[]) => unknown> {
  /** Only the page's own collection is filtered — see `CollectionView`. */
  const filtered = (id: string): boolean => view !== undefined && view.collectionId === id;

  return {
    variantsOfProduct: ((id: string) => data.variantsOfProduct(id)) as never,
    imagesOfProduct: ((id: string) => data.imagesOfProduct(id)) as never,
    productsOfCollection: ((id: string) =>
      filtered(id)
        ? data.productsOfCollection(id, view!.criteria, view!.sort)
        : data.productsOfCollection(id)) as never,
    productCountOfCollection: ((id: string) =>
      filtered(id)
        ? data.productCountOfCollection(id, view!.criteria)
        : data.productCountOfCollection(id)) as never,
    facetsOfCollection: ((id: string) =>
      data.facetsOfCollection(id, filtered(id) ? view!.criteria : NO_FILTERS)) as never,
    productCount: (() => data.productCount()) as never,
    collectionCount: (() => data.collectionCount()) as never,
    productTypes: (() => data.productTypes()) as never,
    productVendors: (() => data.productVendors()) as never,
    collectionsOfProduct: ((id: string) => data.collectionsOfProduct(id)) as never,
    policies: (() => data.policies()) as never,
    metafieldsOf: ((ownerEntity: string, ownerId: string) =>
      data.metafieldsOf(ownerEntity, ownerId)) as never,
    productTypesOfCollection: ((id: string) => data.productTypesOfCollection(id)) as never,
    productVendorsOfCollection: ((id: string) => data.productVendorsOfCollection(id)) as never,
    currentUrl: (() => view?.currentUrl ?? '/') as never,
    currentSort: (() => view?.sort ?? DEFAULT_SORT) as never,
    image: ((id: string) => data.image(id)) as never,
    availabilitiesOfVariant: ((id: string) => data.availabilitiesOfVariant(id)) as never,
    articlesOfBlog: ((id: string) => data.articlesOfBlog(id)) as never,
    articleCountOfBlog: ((id: string) => data.articleCountOfBlog(id)) as never,
    blogOfArticle: ((id: string) => data.blogOfArticle(id)) as never,
    tagsOfBlog: ((id: string) => data.tagsOfBlog(id)) as never,
    adjacentArticles: ((blogId: string, articleId: string) =>
      data.adjacentArticles(blogId, articleId)) as never,
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
