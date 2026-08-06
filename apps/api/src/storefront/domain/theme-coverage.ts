/**
 * Storefront · domain/theme-coverage.ts
 * What a theme reaches for, and whether this platform has it.
 *
 * The question a developer porting a theme actually has is not "what does the
 * documentation list" — it is "will THIS theme run here, and if not, what is
 * missing". A static reference cannot answer that: it is stale the moment the
 * other platform ships anything, and it says nothing about the theme in their
 * hand.
 *
 * So compatibility is measured against the theme itself. `theme:check` already
 * reports foreign names and Liquid mistakes; this is the third question, and
 * the one that decides whether a page renders at all.
 *
 * The comparison is pure. Extracting what a theme uses needs a Liquid parser
 * and lives behind the engine boundary — a regex over the source looks like it
 * works and does not: `replace: '|||sizes|||'` reads as a filter named `sizes`,
 * and a translation key like `'general.meta.page'` reads as an object called
 * `general`. Both were in the first attempt at this, and both were wrong.
 * Layer: domain (pure).
 */

/** One thing a theme used, and where. */
export interface Usage {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface ThemeUsage {
  readonly filters: readonly Usage[];
  readonly tags: readonly Usage[];
  /** Root object references — `product` from `product.featured_image.src`. */
  readonly objects: readonly Usage[];
}

/** What this platform provides, for the comparison. */
export interface PlatformSurface {
  readonly filters: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
  readonly objects: ReadonlySet<string>;
}

export interface CoverageGap {
  readonly kind: 'filter' | 'tag' | 'object';
  readonly name: string;
  /** How many files reach for it — the order to fix them in. */
  readonly files: number;
  /** The first place it appears, so there is somewhere to look. */
  readonly firstSeen: { readonly file: string; readonly line: number };
  /**
   * Whether this is certainly the platform's gap.
   *
   * A name read in ONE snippet is very often that snippet's own optional
   * parameter — `{% render 'share-button', align: 'left' %}` puts `align` in
   * scope, and a snippet documenting the parameter in a `{% comment %}` block
   * has nothing to bind it. Nothing in the theme can distinguish that from a
   * platform object it wanted and did not get.
   *
   * So it is reported and marked, rather than hidden or asserted. A checker
   * that quietly drops uncertain findings is one that misses real gaps; one
   * that states them as fact is one people stop believing.
   */
  readonly certain: boolean;
}

export interface CoverageReport {
  readonly gaps: readonly CoverageGap[];
  readonly counts: {
    readonly filters: number;
    readonly tags: number;
    readonly objects: number;
  };
}

/**
 * Names that are never a missing feature.
 *
 * A theme's own variables outnumber the platform's objects several times over
 * — every `{% assign %}`, every `{% for %}` binding, every `{% capture %}`. A
 * report that listed those would bury the real gaps under a hundred lines of a
 * theme's own local names, which is the failure mode that makes a checker
 * ignorable.
 *
 * Handled by tracking what the theme BINDS rather than by a deny-list, which is
 * why this set is small: it holds only the names Liquid itself introduces.
 */
/**
 * Liquid's own control flow, which no platform "provides".
 *
 * `endif`, `else` and `when` are part of the language's grammar rather than
 * features a platform implements — the engine handles them while parsing and
 * never registers them as tags. Reporting them as missing put nine entries at
 * the TOP of the first report, ordered by reach, so the real gaps were below a
 * screenful of noise.
 */
const LIQUID_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'else', 'elsif', 'endif', 'unless', 'endunless', 'case', 'when', 'endcase',
  'for', 'endfor', 'break', 'continue', 'cycle', 'tablerow', 'endtablerow',
  'assign', 'capture', 'endcapture', 'increment', 'decrement', 'echo', 'liquid',
  'comment', 'endcomment', 'raw', 'endraw', 'ifchanged', 'endifchanged',
]);

const LIQUID_BUILTINS: ReadonlySet<string> = new Set([
  'forloop',
  'tablerowloop',
  'blank',
  'empty',
  'nil',
  'null',
  'true',
  'false',
]);

/**
 * Compares what a theme used against what the platform provides.
 *
 * `bound` is every name the theme introduced itself — the caller collects it
 * while parsing, because only the parser can see an `{% assign %}` for what it
 * is. A name the theme defined is not a gap in the platform however unfamiliar
 * it looks.
 */
export function compareCoverage(
  usage: ThemeUsage,
  surface: PlatformSurface,
  bound: ReadonlySet<string> = new Set(),
): CoverageReport {
  const gaps: CoverageGap[] = [];

  const collect = (
    kind: CoverageGap['kind'],
    used: readonly Usage[],
    known: ReadonlySet<string>,
  ): void => {
    const grouped = new Map<string, Usage[]>();

    for (const entry of used) {
      if (known.has(entry.name)) continue;
      if (kind === 'tag' && LIQUID_KEYWORDS.has(entry.name)) continue;
      if (kind === 'object' && (bound.has(entry.name) || LIQUID_BUILTINS.has(entry.name))) continue;

      const list = grouped.get(entry.name) ?? [];
      list.push(entry);
      grouped.set(entry.name, list);
    }

    for (const [name, entries] of grouped) {
      // Distinct files, not occurrences: a name used forty times in one snippet
      // is one thing to fix, and ranking it above something in ten files would
      // send a developer to the wrong place first.
      const files = new Set(entries.map((entry) => entry.file));
      const first = [...entries].sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
      )[0] as Usage;

      /**
       * Certain unless it is a single snippet's own name.
       *
       * A filter or tag is always certain: the engine either registers it or it
       * does not, and no theme can introduce one. An object read across several
       * files, or read anywhere outside `snippets/`, is asking the platform for
       * something. One read inside a single snippet may just be its parameter.
       */
      const onlySnippet =
        kind === 'object' &&
        files.size === 1 &&
        [...files][0]?.startsWith('snippets/') === true;

      gaps.push({
        kind,
        name,
        files: files.size,
        firstSeen: { file: first.file, line: first.line },
        certain: !onlySnippet,
      });
    }
  };

  collect('filter', usage.filters, surface.filters);
  collect('tag', usage.tags, surface.tags);
  collect('object', usage.objects, surface.objects);

  /**
   * Ordered by reach, then by name.
   *
   * A filter twelve files depend on breaks twelve templates; one used once
   * breaks a corner. Sorting by that puts the work in the order that makes the
   * theme render soonest.
   */
  gaps.sort((a, b) => b.files - a.files || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return {
    gaps,
    counts: {
      filters: new Set(usage.filters.map((entry) => entry.name)).size,
      tags: new Set(usage.tags.map((entry) => entry.name)).size,
      objects: new Set(usage.objects.map((entry) => entry.name)).size,
    },
  };
}

/**
 * Every object name a theme may reach for on this platform.
 *
 * Two kinds, and they arrive by different routes. The drops are the records —
 * `product`, `collection`, `cart` — registered by `defineDrop` and discoverable
 * from the registry. The rest are values the transport puts in scope for every
 * render, which no registry knows about because they are plain objects.
 *
 * Listed here rather than derived because a name a theme reads and finds
 * missing is a bug either way: if the transport stops providing `settings`, a
 * report claiming it exists is worse than one that never mentioned it. This
 * list is the claim, and `storefront.handler.ts` is what has to honour it.
 */
export function knownObjects(): readonly string[] {
  return [
    // Records, from the drops.
    'product', 'collection', 'collections', 'page', 'blog', 'article', 'cart',
    'customer', 'shop', 'image', 'media', 'variant', 'line_item', 'link',
    'linklist', 'order', 'address', 'form', 'font', 'color', 'filter',
    'filter_value', 'search', 'paginate', 'metafield', 'model', 'video',
    'external_video', 'selling_plan', 'unit_price_measurement', 'policy',
    'store_availability', 'discount', 'gift_card', 'comment',

    // Put in scope by the transport for every render.
    'settings', 'template', 'request', 'routes', 'section', 'block',
    'canonical_url', 'page_title', 'page_description', 'current_page',
    'current_tags', 'all_products', 'content_for_layout', 'content_for_header',
    'content_security_policy_nonce', 'handle', 'theme', 'localization',
    'powered_by_link', 'additional_checkout_buttons', 'scripts',
  ];
}
