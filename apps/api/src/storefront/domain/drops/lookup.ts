/**
 * Storefront · domain/drops/lookup.ts
 * Looking a record up by handle — `all_products['my-handle']`.
 *
 * This is what makes a query parameter useful rather than merely readable: a
 * theme can take `?product-handle=x` and render that product. It is also the
 * single most dangerous thing a theme can be given, so the three guards below
 * are the feature rather than decoration around it.
 *
 * **Published only.** A lookup by handle is a handle oracle: a visitor can
 * guess, or scrape a sitemap, and ask for anything. If the loader returned
 * drafts, a competitor could read an unreleased catalogue by trying names. The
 * scoping is enforced by the loader the composition root supplies, and the
 * `publishedOnly` flag here is the contract that says so out loud.
 *
 * **A budget.** One lookup is a query. A lookup inside `{% for i in (1..1000) %}`
 * is a thousand queries from one request, and a theme is untrusted code that a
 * merchant installed. So a render gets a fixed number of DISTINCT lookups and
 * nothing after that — the same ceiling the reference product uses, for the same
 * reason.
 *
 * **Normalised keys.** Whatever arrives is handleized before it reaches the
 * loader, so a parameter cannot smuggle a pattern, a path, or an escape into a
 * query. `?h=../../etc` becomes the handle `etc` and simply finds nothing.
 * Layer: domain (pure).
 */

import { handleize } from '../handles';
import type { DropContext, DropFactory } from './define';

/**
 * Distinct lookups one render may perform.
 *
 * Twenty is the reference product's number and it is a good one: enough for a
 * page that composes several named products, far too few to be worth abusing.
 * Repeats are free — the budget counts distinct handles, and the loader cache
 * in `createDropContext` answers the second read of the same one.
 */
export const MAX_LOOKUPS_PER_RENDER = 20;

export interface LookupBudget {
  /** Records a handle and reports whether it may be loaded. */
  spend(handle: string): boolean;
  used(): number;
  /** Handles refused after the ceiling, for logging and for the editor. */
  refused(): readonly string[];
}

export function createLookupBudget(max = MAX_LOOKUPS_PER_RENDER): LookupBudget {
  const spent = new Set<string>();
  const refused = new Set<string>();

  return {
    spend(handle) {
      // Already loaded: free, because the answer is cached for this render.
      if (spent.has(handle)) return true;
      if (spent.size >= max) {
        refused.add(handle);
        return false;
      }
      spent.add(handle);
      return true;
    },
    used: () => spent.size,
    refused: () => [...refused],
  };
}

export interface LookupOptions<Row> {
  /** Loads one published record by handle, already scoped to this store. */
  readonly load: (handle: string) => Row | null | undefined;
  readonly factory: DropFactory<Row>;
  readonly budget: LookupBudget;
  /**
   * Asserts the loader returns only publishable records.
   *
   * Not a switch — there is no `false`. It exists so that a loader wired up
   * without the published filter is a visible lie at the call site rather than
   * an omission nobody notices.
   */
  readonly publishedOnly: true;
}

/**
 * A by-handle lookup object a theme can index.
 *
 * A proxy, because the keys are not known ahead of time — the whole point is
 * that the handle comes from somewhere dynamic. Everything else about it is
 * closed: no enumeration, no writing, and nothing reachable that is not a
 * handle lookup.
 */
export function lookupDrop<Row>(
  options: LookupOptions<Row>,
  context: DropContext,
): Readonly<Record<string, unknown>> {
  const built = new Map<string, unknown>();

  /**
   * One lookup, shared by every trap that can trigger one.
   *
   * Shared because the engine does not read properties the obvious way: it
   * resolves them through `getOwnPropertyDescriptor`, not `get`. A proxy that
   * implemented only `get` returned nothing for every lookup and ran no
   * queries at all — measured, after this feature silently did nothing.
   */
  const resolve = (key: string): unknown => {
    /**
     * The engine probes rendered values for these. Answering with a lookup
     * would spend budget on a handle nobody asked for, and a `then` that
     * returned an object would make this look like a promise.
     */
    if (RESERVED.has(key)) return undefined;

    const handle = handleize(key);
    if (handle === '') return null;

    if (built.has(handle)) return built.get(handle);

    if (!options.budget.spend(handle)) {
      /**
       * Over budget: nothing, rather than an error.
       *
       * A theme that loops too far should render an incomplete page, not a
       * failed one — and `{% if product %}` is already how a theme checks, so
       * nil degrades along a path themes already handle.
       */
      built.set(handle, null);
      return null;
    }

    const row = options.load(handle);
    const drop = row ? options.factory(row, context) : null;
    built.set(handle, drop);
    return drop;
  };

  /**
   * The target is extensible on purpose, and it is not a loose end.
   *
   * A proxy over a frozen target may not report a property the target does not
   * have — every lookup threw "incompatible with the existing property". The
   * object is still closed to a theme: `set` refuses writes and `ownKeys`
   * refuses enumeration, which is what actually matters. Freezing the target
   * only forbade the traps from answering.
   */
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      return resolve(key);
    },

    /**
     * Not enumerable, but every key "exists".
     *
     * The two traps do different jobs and conflating them broke the feature
     * outright. `ownKeys` returning nothing is what makes
     * `{% for p in all_products %}` yield nothing — that loop must never become
     * a request to load the entire catalogue.
     *
     * `has` is a different question: the engine asks it before reading a
     * property, so answering `false` meant every lookup silently returned
     * nothing and no query ever ran. Any key may exist here — whether it
     * resolves is the loader's answer, not the proxy's.
     */
    ownKeys: () => [],

    /**
     * How the engine actually reads a property, so it performs the lookup.
     *
     * `configurable: true` is required rather than cosmetic: a proxy may only
     * omit a key from `ownKeys` if its descriptor is configurable, and omitting
     * them is what keeps the object non-enumerable.
     */
    getOwnPropertyDescriptor(_target, key) {
      if (typeof key !== 'string') return undefined;
      const value = resolve(key);
      if (value === undefined) return undefined;
      return { configurable: true, enumerable: false, writable: false, value };
    },

    has: (_target, key) => typeof key === 'string' && !RESERVED.has(key),
    set: () => false,
  }) as Readonly<Record<string, unknown>>;
}

const RESERVED = new Set([
  'then',
  'catch',
  'finally',
  'next',
  'toLiquid',
  'valueOf',
  'toString',
  'constructor',
  'prototype',
  '__proto__',
  'size',
  'first',
  'last',
]);
