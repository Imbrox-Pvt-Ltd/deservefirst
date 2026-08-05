/**
 * Storefront · domain/request-params.ts
 * Query parameters a theme can read, safely.
 *
 * The reference product does not expose these, and the reason is worth stating
 * because it decides the design rather than merely warning about it.
 *
 * **Reflected injection.** Liquid does not escape output — not here, not there.
 * So `{{ request.params.q }}` renders whatever was in the URL, and a link sent
 * to a customer becomes script running on the merchant's domain. That is not a
 * theoretical risk; it is the single most common web vulnerability there is.
 *
 * **Cache correctness.** A storefront caches rendered pages by URL. A theme
 * that reads `?utm_source` and renders it bakes one visitor's value into the
 * page every later visitor receives.
 *
 * Both are fixable, so this exists:
 *
 *   · Values are escaped **before** a theme ever sees them, so reflecting one
 *     is safe by construction rather than by the theme remembering `| escape`.
 *   · Every key a render reads is recorded, so the cache key can include
 *     exactly those parameters and nothing else. Reading `?utm_source` no
 *     longer poisons anything; it varies the cache on that one key.
 *   · Size and count are capped, because a URL is attacker-controlled input
 *     that ends up in a page and in memory.
 *
 * Layer: domain (pure).
 */

/**
 * How many parameters are readable, and how long a value may be.
 *
 * A URL can carry far more than a theme has any use for. The caps are what stop
 * a crafted link turning into a megabyte of reflected markup or a cache key
 * with two hundred components.
 */
export const MAX_PARAMS = 30;
export const MAX_PARAM_LENGTH = 256;

/**
 * Escapes the four characters that let a value escape its context.
 *
 * `&` is deliberately NOT escaped, and the reasoning matters. Escaping it too
 * would be safer only in appearance: with `<`, `>`, `"` and `'` already gone, a
 * value like `&lt;script&gt;` renders as the visible text "<script>" and cannot
 * execute. Leaving `&` alone means a search for "shirts & ties" reads correctly
 * instead of becoming "shirts &amp; ties" on the page.
 *
 * A theme should NOT add `| escape` on top of these — the value arrives safe.
 * Doing so is harmless, only cosmetic: an ampersand would render doubled.
 */
function escapeParam(value: string): string {
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Names a parameter may never take.
 *
 * Two different hazards, both real and both found by testing rather than by
 * thinking about it:
 *
 * `__proto__`, `constructor` and `prototype` are prototype pollution — a query
 * string should not be able to reach an object's prototype.
 *
 * `then` is subtler and worse. The engine awaits values it renders, and an
 * object with a `then` property is a thenable: `?then=x` would make the whole
 * parameter object look like a promise, and awaiting it would hang or resolve
 * to something absurd. `next` and `toLiquid` are the engine's own probes.
 */
const RESERVED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'then',
  'catch',
  'finally',
  'next',
  'toLiquid',
  'valueOf',
  'toString',
]);

export interface ParamAccess {
  /** The object a theme reads. Values are already escaped. */
  readonly params: Readonly<Record<string, string>>;
  /**
   * The keys this render actually read.
   *
   * The caller turns these into the cache key. A page that read nothing caches
   * by path alone; a page that read `?variant` caches per variant, which is
   * correct rather than conservative.
   */
  readonly readKeys: () => readonly string[];
}

/**
 * Builds the readable parameter object for one render.
 *
 * A proxy rather than a plain object, purely to record which keys were touched.
 * Values are escaped up front — the proxy does not do the escaping, so a key
 * read twice cannot be escaped twice.
 */
/**
 * Names the template engine probes for, which no theme is asking about.
 *
 * A render asks whether a value is thenable, whether it can turn itself into a
 * Liquid value, and how to iterate it. Recording those as parameters put three
 * phantom entries into every cache key.
 */
const ENGINE_PROBES: ReadonlySet<string> = new Set([
  'then', 'toLiquid', 'toJSON', 'toString', 'valueOf', 'next', 'length',
  'constructor', 'inspect', 'nodeType', 'size', 'value',
]);

export function readableParams(query: URLSearchParams | string): ParamAccess {
  const search = typeof query === 'string' ? new URLSearchParams(query) : query;

  const safe: Record<string, string> = {};
  let count = 0;

  for (const [key, value] of search) {
    if (count >= MAX_PARAMS) break;
    // A key that is not a plain identifier is not something a theme addresses
    // as `request.params.x`, and allowing arbitrary keys invites prototype
    // names into the object.
    if (!/^[A-Za-z_][\w.-]{0,63}$/.test(key)) continue;
    if (RESERVED_KEYS.has(key)) continue;
    // First value wins for a repeated key; faceting reads its values through
    // the filter drops, which are given the full list separately.
    if (key in safe) continue;

    safe[key] = escapeParam(value.slice(0, MAX_PARAM_LENGTH));
    count++;
  }

  const read = new Set<string>();

  const params = new Proxy(Object.freeze({ ...safe }), {
    /**
     * Records a read whenever a template asks for a parameter — present or not.
     *
     * This used to record only keys the URL actually carried, reasoning that "a
     * key absent from this URL cannot vary the page rendered from it". That is
     * true of a key computed per request, and false once a CACHE learns the
     * list from one render and reuses it for others: the first request to `/`
     * carried no `page`, so `page` was never recorded, the vary list for that
     * path became empty, and every subsequent `/?page=2` was served the cached
     * copy of page one.
     *
     * Asking for a parameter is the dependency. Absence is one of its values.
     *
     * The engine probes objects it renders for `then`, `toLiquid` and friends,
     * so those are excluded by name — recording them put phantom entries in
     * every cache key, which is what the original narrow rule was really for.
     */
    get(target, key) {
      if (typeof key !== 'string') return undefined;

      if (Object.hasOwn(target, key)) {
        read.add(key);
        return Reflect.get(target, key);
      }

      if (!ENGINE_PROBES.has(key) && /^[A-Za-z_][\w.-]{0,63}$/.test(key)) read.add(key);

      // Empty rather than undefined: a theme printing an absent parameter
      // should render nothing, not the word "undefined".
      return '';
    },
    has(target, key) {
      if (typeof key === 'string' && Object.hasOwn(target, key)) read.add(key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      // Iterating reads everything, so everything is recorded — otherwise a
      // theme looping the parameters would produce a page cached under a key
      // that ignored them.
      for (const key of Object.keys(target)) read.add(key);
      return Reflect.ownKeys(target);
    },
    set() {
      return false;
    },
  }) as Readonly<Record<string, string>>;

  return { params, readKeys: () => [...read].sort() };
}

/**
 * The cache key for a page, given what it read.
 *
 * Only the parameters actually used, in a stable order. A page that read
 * nothing gets the bare path, which is what makes caching worth having at all.
 */
export function cacheKeyFor(path: string, query: string, readKeys: readonly string[]): string {
  if (readKeys.length === 0) return path;

  const search = new URLSearchParams(query);
  const relevant = new URLSearchParams();
  for (const key of [...readKeys].sort()) {
    const value = search.get(key);
    if (value !== null) relevant.set(key, value);
  }

  const rendered = relevant.toString();
  return rendered === '' ? path : `${path}?${rendered}`;
}
