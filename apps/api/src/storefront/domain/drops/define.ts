/**
 * Storefront · domain/drops/define.ts
 * How a drop is declared, and why the declaration is the security boundary.
 *
 * A theme is untrusted third-party code. It sees precisely what a drop exposes
 * and nothing else, so every property added here is a property every theme on
 * the platform can read — and the argument for adding one always sounds
 * reasonable in isolation. That is the whole risk, and it is why a drop is a
 * declared allow-list rather than an object handed over.
 *
 * The danger is concrete, not theoretical. Our own resource definitions mark
 * `costPerItem` private and `internalNotes` internal; `passwordHash`,
 * `mfaSecret` and `webhookSecret` are internal too. A drop built by spreading
 * an entity would put a merchant's margins — or a credential — into every
 * theme. `drops-expose-nothing-private` in the fitness suite fails the build on
 * exactly that, cross-checked against the manifests rather than a list kept
 * here.
 *
 * Three mechanics, each measured against liquidjs rather than assumed:
 *   · Plain objects with enumerable getters. Class getters are invisible to the
 *     engine — a drop written as a class silently exposes nothing.
 *   · Getters may return promises; the engine awaits them, in output, in
 *     `{% for %}` and through filters. So a drop is lazy by default and a
 *     collection page does not load what it never renders.
 *   · `constructor`, `__proto__` and `toString` are already refused by the
 *     engine, so prototype walking is not a hole we have to close.
 * Layer: domain (pure).
 */

/**
 * What a drop may reach besides its own source row.
 *
 * Loaders are the tenant boundary. They are built already scoped to one store,
 * so a drop cannot widen its own reach — there is no store id to pass and
 * therefore no store id to get wrong.
 */
export interface DropContext {
  readonly currency: string;
  readonly locale: string;
  /** Absolute base for URLs a theme renders. */
  readonly baseUrl: string;
  /**
   * Loading related records, already scoped to this store.
   *
   * Typed loosely here because `domain` may not depend on any module's
   * contracts (§14.1); the composition root supplies the real, typed thing.
   */
  readonly load: Readonly<Record<string, (...args: never[]) => unknown>>;
  /**
   * Told whenever a theme reads a property no drop of this type declares.
   *
   * Off unless something opts in, because it turns every drop into a Proxy.
   * With it on, rendering a store's own pages produces the exact list of what
   * its theme expects and we do not provide — including inside `{% for %}`,
   * where the loop variable's type is not knowable by reading the template.
   *
   * This exists because auditing statically kept missing whole classes of gap:
   * a nested read like `filter.min_value.value` is invisible to a check that
   * only looks at which OBJECTS a theme names.
   */
  readonly onMissingProperty?: (dropName: string, property: string) => void;
}

export type DropProperty<Source> = (source: Source, context: DropContext) => unknown;

export type DropSpec<Source> = Readonly<Record<string, DropProperty<Source>>>;

export interface DropFactory<Source> {
  readonly dropName: string;
  /** Exactly the properties a theme can see. Read by the audit. */
  readonly properties: readonly string[];
  (source: Source, context: DropContext): Record<string, unknown>;
}

/**
 * Every drop declared, so the audit can enumerate them.
 *
 * A registry rather than a hand-kept list, because a drop that forgot to
 * register itself is exactly the one nobody reviewed.
 */
const REGISTRY = new Map<string, DropFactory<never>>();

/**
 * Names the engine and the runtime ask for on every object.
 *
 * Excluded from the audit because they are probes rather than reads — liquidjs
 * checks for `then` to decide whether a value is a promise, and reporting those
 * would bury the real misses under one entry per drop per render.
 */
const PROBED: ReadonlySet<string> = new Set([
  'then', 'toLiquid', 'toJSON', 'toString', 'valueOf', 'constructor',
  'inspect', 'nodeType', 'length', 'size', 'first', 'last',
  // Iteration and comparison, asked of every value the engine handles.
  'next', 'equals', 'indexOf', 'Symbol(Symbol.iterator)', 'toPrimitive',
]);

export function defineDrop<Source>(name: string, spec: DropSpec<Source>): DropFactory<Source> {
  const properties = Object.keys(spec);

  if (REGISTRY.has(name)) {
    // Two drops of one name means whichever loaded second wins, and which that
    // is depends on import order.
    throw new Error(`A drop named "${name}" is already defined`);
  }

  const factory = ((source: Source, context: DropContext): Record<string, unknown> => {
    const drop: Record<string, unknown> = {};
    // Memoised per instance: a theme reads `product.price` many times per page,
    // and a lazy getter that reloads on every read is a worse bug than an eager
    // one because it only shows up under load.
    const resolved = new Map<string, unknown>();

    for (const property of properties) {
      Object.defineProperty(drop, property, {
        // Enumerable so `{% for %}` and the engine's own property access see it.
        enumerable: true,
        configurable: false,
        get() {
          if (resolved.has(property)) return resolved.get(property);
          const value = (spec[property] as DropProperty<Source>)(source, context);
          resolved.set(property, value);
          return value;
        },
      });
    }

    /**
     * Frozen, so a theme cannot add a property and have another part of the
     * same render read it back. Liquid has no assignment into an object, but
     * this costs nothing and closes the question.
     */
    const frozen = Object.freeze(drop);
    if (!context.onMissingProperty) return frozen;

    return new Proxy(frozen, {
      get(target, key, receiver) {
        if (typeof key === 'string' && !properties.includes(key) && !PROBED.has(key)) {
          context.onMissingProperty!(name, key);
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }) as DropFactory<Source>;

  Object.defineProperty(factory, 'dropName', { value: name, enumerable: true });
  Object.defineProperty(factory, 'properties', { value: Object.freeze(properties), enumerable: true });

  REGISTRY.set(name, factory as DropFactory<never>);
  return factory;
}

/** Every declared drop, for the audit and for documentation. */
export function declaredDrops(): ReadonlyMap<string, DropFactory<never>> {
  return REGISTRY;
}

/**
 * Builds a context whose loaders answer each distinct question once per render.
 *
 * Per-property memoisation is not enough, and the difference is not subtle. A
 * product page reads `price_min`, `price_max`, `price_varies` and `variants`;
 * each is a separate property, each memoised, and each was calling the variant
 * loader — four queries for one answer. On a collection page that multiplies by
 * the number of products.
 *
 * Caching at the loader fixes all of them at once and also covers the case
 * per-property memoisation never could: the same product appearing in two
 * places on one page, as a grid item and as a related product.
 *
 * The cache lives for one render, because a context is built per render. That
 * is deliberate — a longer-lived cache would serve one shopper's page from
 * another's data, which is the kind of bug that is invisible in development.
 */
export function createDropContext(context: DropContext): DropContext {
  const cache = new Map<string, unknown>();
  const memoised: Record<string, (...args: never[]) => unknown> = {};

  for (const [name, loader] of Object.entries(context.load)) {
    memoised[name] = (...args: never[]) => {
      /**
       * Arguments are ids and handles, so joining them is a sufficient key.
       *
       * The separator is NUL, written as an escape rather than the raw byte it
       * used to be. It has to be a character that cannot appear in an argument:
       * with a space, `load('a b')` and `load('a', 'b')` produce the same key
       * and one silently returns the other's rows.
       */
      const key = `${name}:${args.join('\u0000')}`;
      if (cache.has(key)) return cache.get(key);
      const value = (loader as (...rest: never[]) => unknown)(...args);
      cache.set(key, value);
      return value;
    };
  }

  return { ...context, load: memoised };
}

/**
 * A list of drops, built lazily.
 *
 * Themes iterate collections of thousands; mapping eagerly would build every
 * drop to render the twenty on the page. The array is real — Liquid needs
 * `size` and indexing — but each element is only constructed when read.
 */
export function dropList<Source>(
  factory: DropFactory<Source>,
  sources: readonly Source[],
  context: DropContext,
): readonly Record<string, unknown>[] {
  const built: (Record<string, unknown> | undefined)[] = new Array(sources.length);

  /** Builds one element on first read, and remembers it. */
  const at = (index: number): Record<string, unknown> | undefined => {
    const existing = built[index];
    if (existing) return existing;
    const source = sources[index];
    if (source === undefined) return undefined;
    const drop = factory(source, context);
    built[index] = drop;
    return drop;
  };

  return new Proxy([] as unknown as Record<string, unknown>[], {
    get(_target, key) {
      if (key === 'length') return sources.length;

      /**
       * `size` is Liquid's name for the length, and it must be answered HERE.
       *
       * The engine derives `first` and `last` from `length` and an index, which
       * this proxy already serves — so those worked and hid the gap. It asks
       * the object itself for `size`, and the trap below returned `undefined`
       * for every key it did not recognise.
       *
       * The cost was not a blank number. Themes GATE on it:
       * `{% if product.media.size > 0 %}` wraps the reference theme's entire
       * product gallery, so images loaded correctly, reached the drop
       * correctly, and were never rendered. `product.variants.size > 1` decides
       * whether a variant picker appears at all. An empty value compares false
       * against every number, so each of those guards silently took the wrong
       * branch.
       *
       * `{{ list | size }}` worked throughout, because a filter receives the
       * materialised array — which is exactly why this survived: the two forms
       * are interchangeable to a theme author and only one of them worked.
       */
      if (key === 'size') return sources.length;

      if (typeof key === 'string' && /^\d+$/.test(key)) return at(Number(key));

      if (key === Symbol.iterator) {
        return function* iterate(): Generator<Record<string, unknown> | undefined> {
          for (let index = 0; index < sources.length; index++) yield at(index);
        };
      }

      // Array methods the engine uses — map, slice, sort — operate on a
      // materialised copy. Reaching one of these means something wanted the
      // whole list anyway, so building it is not the waste laziness avoids.
      const value = Array.prototype[key as keyof typeof Array.prototype];
      if (typeof value === 'function') {
        const materialised = sources.map((_source, index) => at(index));
        return (value as (...args: unknown[]) => unknown).bind(materialised);
      }

      return undefined;
    },

    has(_target, key) {
      if (key === 'length' || key === 'size') return true;
      return typeof key === 'string' && /^\d+$/.test(key) && Number(key) < sources.length;
    },

    ownKeys() {
      return [...sources.map((_source, index) => String(index)), 'length'];
    },

    getOwnPropertyDescriptor(_target, key) {
      if (key === 'length') {
        return { configurable: false, enumerable: false, value: sources.length, writable: false };
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  }) as readonly Record<string, unknown>[];
}
