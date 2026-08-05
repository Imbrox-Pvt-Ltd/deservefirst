/**
 * Storefront · domain/page-cache.ts
 * What may be cached, under what key, and how a nonce survives it.
 *
 * Rendering the reference theme's homepage is 86 KB of Liquid across 18
 * sections and several dozen queries. Doing that per visitor is the difference
 * between a storefront and a demonstration.
 *
 * Three questions decide everything here, and the third is the one that turns a
 * cache into a security bug.
 *
 * **What may be cached?** Only an anonymous, successful page. A 404 tells you
 * nothing worth keeping, a 422 holds one person's typing, and a page rendered
 * for somebody signed in is theirs.
 *
 * **Under what key?** The store, an epoch, the path, and exactly the query
 * parameters the render actually READ. Keying on the whole query lets anyone
 * fill the cache with `?x=1`, `?x=2`; keying on the path alone serves one
 * visitor's `?variant` to the next.
 *
 * **How does a nonce survive?** It does not — a nonce that repeated would not be
 * a nonce. The body is stored with the nonce swapped for a placeholder and a
 * fresh one substituted on every serve.
 *
 * That placeholder is the subtle part, and getting it wrong is worse than not
 * caching at all. A FIXED marker is exploitable: an attacker stores
 * `<script nonce="...marker...">` in a product title, waits for the page to be
 * cached, and the cache itself substitutes a live nonce into their script —
 * defeating the policy using our own machinery. So the placeholder is random per
 * entry, generated when the page is stored, and never sent to a browser. There
 * is nothing for an attacker to have written down in advance.
 * Layer: domain (pure).
 */

export interface CacheDecision {
  readonly cacheable: boolean;
  /** Why not, for a header a developer can read while wondering. */
  readonly reason?: string;
}

export interface CacheConditions {
  readonly method: string;
  readonly status: number;
  /** Null when the render decided this page must not be cached. */
  readonly cacheKey: string | null;
  /** True when a session cookie came with the request. */
  readonly hasSession: boolean;
  readonly contentType: string;
}

/**
 * Whether this response may be kept.
 *
 * Every clause is a way a cache turns into a leak or a wrong page, so each one
 * says which.
 */
export function decideCacheable(conditions: CacheConditions): CacheDecision {
  if (conditions.method !== 'GET') {
    return { cacheable: false, reason: 'not a GET' };
  }
  if (conditions.status !== 200) {
    // A 404 tells you nothing worth keeping and a 422 holds somebody's typing.
    return { cacheable: false, reason: `status ${conditions.status}` };
  }
  if (conditions.cacheKey === null) {
    return { cacheable: false, reason: 'the render refused caching' };
  }
  if (conditions.hasSession) {
    /**
     * The one that matters most.
     *
     * A page rendered for somebody signed in may hold their name, their orders
     * or their cart, and caching it hands that to the next visitor on the same
     * URL. There is no session on a Phase-1 storefront yet, which is exactly why
     * this belongs here now rather than after there is one.
     */
    return { cacheable: false, reason: 'rendered for a signed-in visitor' };
  }
  if (!conditions.contentType.startsWith('text/html')) {
    return { cacheable: false, reason: 'not HTML' };
  }
  return { cacheable: true };
}

/**
 * The full key, including the store and an epoch.
 *
 * The epoch is what makes invalidation possible without tracking which page
 * mentions which product. Bumping it for a store retires everything that store
 * has cached, which is coarse and correct — and correctness is the one property
 * a cache cannot trade away, because a stale price is worse than a slow page.
 */
export function fullCacheKey(storeId: string, epoch: number, pageKey: string): string {
  return `page:${storeId}:${epoch}:${pageKey}`;
}

/**
 * Where the read-parameter list for a path is remembered.
 *
 * A lookup has to compute the key BEFORE rendering, but which parameters a page
 * reads is only known AFTER — so the first render of a path teaches the cache
 * what that path varies on, exactly as HTTP's own `Vary` works. Kept under the
 * same epoch as the pages, so a publish retires the lesson along with them: a
 * template that starts reading a new parameter gets a fresh epoch anyway.
 */
export function varyKey(storeId: string, epoch: number, path: string): string {
  return `vary:${storeId}:${epoch}:${path}`;
}

/**
 * Swaps a nonce out of a body, for storage.
 *
 * Replaces the exact value rather than matching `nonce="[^"]*"`, which would
 * also rewrite a nonce a theme hard-coded for something else — a cache that
 * quietly edits a theme's markup is a bug that costs somebody a day.
 */
export function substitute(body: string, from: string, to: string): string {
  if (from === '' || !body.includes(from)) return body;
  return body.split(from).join(to);
}

/**
 * How long a page stays cached.
 *
 * Short on purpose. A merchant who changes a price and waits five minutes to
 * see it assumes the platform is broken and changes it again. The epoch is what
 * makes an edit visible at once; this is only the ceiling for whatever the
 * epoch does not catch.
 */
export const DEFAULT_TTL_SECONDS = 60;
