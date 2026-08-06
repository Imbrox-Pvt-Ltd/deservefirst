/**
 * Storefront · domain/theme-compat.ts
 * Finding names a theme uses that belong to another platform.
 *
 * Pure, and takes the name map as an argument rather than importing it — which
 * is what keeps this file free of any other company's vocabulary. The map is
 * data (`config/theme-compat.json`); this is the logic that acts on it.
 *
 * Three things use it, for the two answers a developer might want:
 *   `theme:check` — tell me what to change, I will change it
 *   `theme:port`  — change it for me, once, so I can review the diff
 *   compatibility mode — answer to the old names at runtime
 * Layer: domain (pure).
 */

export interface CompatMap {
  /** `foreign filter name -> ours` */
  readonly filters: Readonly<Record<string, string>>;
  readonly objects: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  /**
   * Properties another platform reads off an object we already provide.
   *
   * Keyed `object.property`, because a bare property name is ambiguous — two
   * drops may both have something called `attributes` and mean different
   * things. The value names the property of ours that answers it.
   *
   * Distinct from `objects`: there the whole object has another name, here the
   * object is the same and only the field differs. A block's editor attributes
   * are the case that forced this — the data already existed as
   * `block.editor_attributes`, and 77 files of the reference theme could not
   * reach it because they ask for it by another platform's name.
   */
  readonly properties: Readonly<Record<string, string>>;
  /**
   * URL schemes other platforms use for internal links inside theme settings.
   *
   * A merchant picking "the about page" in an editor produces
   * `<scheme>://pages/about` in the theme's settings, not a path — see
   * `internal-links.ts`.
   */
  readonly linkSchemes: readonly string[];
}

export interface CompatFinding {
  readonly file: string;
  readonly line: number;
  /** What the theme wrote. */
  readonly found: string;
  /** What it should say instead. */
  readonly replacement: string;
  readonly kind: 'filter' | 'object' | 'tag' | 'property';
}

const EMPTY: CompatMap = { filters: {}, objects: {}, tags: {}, properties: {}, linkSchemes: [] };

/**
 * Substitutes `{slug}` in every replacement.
 *
 * Done once when the map is loaded rather than per lookup, so the brand name
 * appears in exactly one place at runtime and the table stays honest about
 * where its targets come from.
 */
export function resolveCompatMap(raw: unknown, slug: string): CompatMap {
  if (!raw || typeof raw !== 'object') return EMPTY;

  const section = (name: 'filters' | 'objects' | 'tags' | 'properties'): Record<string, string> => {
    const held = (raw as Record<string, unknown>)[name];
    if (!held || typeof held !== 'object') return {};

    const out: Record<string, string> = {};
    for (const [foreign, target] of Object.entries(held as Record<string, unknown>)) {
      if (typeof target !== 'string') continue;
      out[foreign] = target.replace(/\{slug\}/g, slug);
    }
    return out;
  };

  const schemes = (raw as Record<string, unknown>).linkSchemes;

  return {
    filters: section('filters'),
    objects: section('objects'),
    tags: section('tags'),
    properties: section('properties'),
    linkSchemes: Array.isArray(schemes)
      ? schemes.filter((scheme): scheme is string => typeof scheme === 'string' && scheme !== '')
      : [],
  };
}

/**
 * Every foreign name in one template, with what to write instead.
 *
 * Only inside Liquid delimiters. A theme's own JavaScript may legitimately
 * mention any of these strings — in a comment, a URL, an analytics key — and
 * rewriting those would break working code to fix nothing.
 */
export function findForeignNames(
  file: string,
  source: string,
  map: CompatMap,
): readonly CompatFinding[] {
  const findings: CompatFinding[] = [];

  const lineAt = (index: number): number => source.slice(0, index).split('\n').length;

  for (const tag of source.matchAll(/\{[{%]([\s\S]*?)[%}]\}/g)) {
    const body = tag[1] as string;
    const offset = tag.index as number;

    const scan = (
      table: Readonly<Record<string, string>>,
      kind: CompatFinding['kind'],
      pattern: (name: string) => RegExp,
    ): void => {
      for (const [foreign, replacement] of Object.entries(table)) {
        if (!pattern(foreign).test(body)) continue;
        findings.push({ file, line: lineAt(offset), found: foreign, replacement, kind });
      }
    };

    // A filter is only a filter after a pipe; an object only at a reference
    // position. Matching the bare word anywhere would rename a string literal
    // that happens to contain it.
    scan(map.filters, 'filter', (name) => new RegExp(`\\|\\s*${escapeRegex(name)}\\b`));
    scan(map.objects, 'object', (name) => new RegExp(`\\b${escapeRegex(name)}\\b`));
    scan(map.tags, 'tag', (name) => new RegExp(`^\\s*-?\\s*${escapeRegex(name)}\\b`));
  }

  return findings;
}

/**
 * Rewrites a template's foreign names, returning the new source.
 *
 * Same positional rules as the finder, so what `theme:check` reports is exactly
 * what `theme:port` changes — a checker and a fixer that disagree are worse
 * than either alone.
 */
export function portTemplate(source: string, map: CompatMap): { source: string; changes: number } {
  let changes = 0;

  const ported = source.replace(/\{[{%][\s\S]*?[%}]\}/g, (tag) => {
    let body = tag;

    for (const [foreign, replacement] of Object.entries(map.filters)) {
      body = body.replace(
        new RegExp(`(\\|\\s*)${escapeRegex(foreign)}\\b`, 'g'),
        (_whole, pipe: string) => {
          changes++;
          return `${pipe}${replacement}`;
        },
      );
    }

    for (const [foreign, replacement] of Object.entries(map.objects)) {
      body = body.replace(new RegExp(`\\b${escapeRegex(foreign)}\\b`, 'g'), () => {
        changes++;
        return replacement;
      });
    }

    for (const [foreign, replacement] of Object.entries(map.tags)) {
      body = body.replace(
        new RegExp(`(\\{%-?\\s*)${escapeRegex(foreign)}\\b`, 'g'),
        (_whole, open: string) => {
          changes++;
          return `${open}${replacement}`;
        },
      );
    }

    return body;
  });

  return { source: ported, changes };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
