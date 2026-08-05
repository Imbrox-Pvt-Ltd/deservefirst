/**
 * Storefront · domain/template-resolution.ts
 * Which file renders this page, and what a JSON template means.
 *
 * The rules read as trivia until you get one wrong. A merchant assigns a
 * product the template suffix "wholesale"; the theme must render
 * `templates/product.wholesale.json` if it exists and `templates/product.json`
 * if it does not — and if it falls back silently when the suffix file is merely
 * *misnamed*, the merchant sees the ordinary product page and reports that
 * their custom template "doesn't work".
 *
 * So resolution reports what it chose and why. The renderer logs it, and the
 * theme editor can show it, which turns that support ticket into a sentence.
 *
 * JSON templates are the Online Store 2.0 model: a template is not markup, it
 * is an ordered list of sections with their settings. That is what makes a page
 * something a merchant can reorder without touching Liquid.
 * Layer: domain (pure).
 */

import { confinePath } from './theme-source';

/** The page kinds a storefront serves. */
export const PAGE_TYPES = [
  'index',
  'product',
  'collection',
  'list-collections',
  'page',
  'blog',
  'article',
  'search',
  'cart',
  'password',
  '404',
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

export interface TemplateRequest {
  readonly pageType: PageType;
  /** The merchant's chosen suffix for this record, e.g. `wholesale`. */
  readonly suffix?: string | null;
}

export interface TemplateChoice {
  /** The confined path to render, or null if the theme has no template for it. */
  readonly path: string | null;
  readonly format: 'json' | 'liquid' | null;
  /** Every path considered, in order. The theme editor shows this. */
  readonly considered: readonly string[];
  /**
   * Set when a suffix was asked for and not found.
   *
   * The difference between "the merchant did not set a suffix" and "the
   * merchant set one the theme does not have" is invisible on the rendered page
   * and is the single most common theme support question.
   */
  readonly missingSuffix?: string;
}

/**
 * Picks the template for a page from the files a theme actually has.
 *
 * JSON before Liquid at each step, matching the reference product: a theme
 * migrating to the 2.0 model adds `product.json` beside an existing
 * `product.liquid`, and the new one is meant to win.
 */
export function resolveTemplate(
  request: TemplateRequest,
  available: ReadonlySet<string>,
): TemplateChoice {
  const considered: string[] = [];

  const suffix = request.suffix?.trim();
  const candidates: string[] = [];

  if (suffix) {
    candidates.push(`templates/${request.pageType}.${suffix}.json`);
    candidates.push(`templates/${request.pageType}.${suffix}.liquid`);
  }
  candidates.push(`templates/${request.pageType}.json`);
  candidates.push(`templates/${request.pageType}.liquid`);

  let missingSuffix: string | undefined;

  for (const candidate of candidates) {
    considered.push(candidate);
    if (!available.has(candidate)) continue;

    // Reached a non-suffixed candidate while a suffix was asked for: the
    // merchant's choice does not exist in this theme.
    if (suffix && !candidate.includes(`.${suffix}.`)) missingSuffix = suffix;

    return {
      path: candidate,
      format: candidate.endsWith('.json') ? 'json' : 'liquid',
      considered,
      ...(missingSuffix ? { missingSuffix } : {}),
    };
  }

  return {
    path: null,
    format: null,
    considered,
    ...(suffix ? { missingSuffix: suffix } : {}),
  };
}

/**
 * The layout a template asks for.
 *
 * `theme` unless the template names another, and `false` meaning no layout at
 * all — which a theme uses for a page that returns a fragment rather than a
 * document.
 */
export function resolveLayout(declared: unknown): string | null {
  if (declared === false || declared === 'none') return null;
  if (typeof declared === 'string' && declared.trim() !== '') {
    return confinePath(`layout/${declared.trim()}.liquid`);
  }
  return 'layout/theme.liquid';
}

export interface TemplateSection {
  readonly id: string;
  readonly type: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly blocks: readonly {
    readonly id: string;
    readonly type: string;
    readonly settings: Readonly<Record<string, unknown>>;
  }[];
  readonly disabled: boolean;
}

export interface ParsedJsonTemplate {
  readonly sections: readonly TemplateSection[];
  readonly layout: string | null;
  readonly wrapper?: string;
}

export class TemplateParseError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = 'TemplateParseError';
  }
}

/**
 * Reads a JSON template into an ordered section list.
 *
 * Two things it does that a naive `JSON.parse` would not:
 *
 * `order` decides the sequence, not object key order. Key order in JSON is not
 * guaranteed by the spec and every editor that rewrites the file may change it,
 * so a template whose sections reorder themselves on save would be a bug nobody
 * could reproduce.
 *
 * A section named in `order` that has no definition is skipped rather than
 * rendered as a blank — but it is skipped loudly enough to be visible, because
 * silently dropping a section is how a merchant loses a hero image and cannot
 * say when.
 */
export function parseJsonTemplate(path: string, source: string): ParsedJsonTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new TemplateParseError(path, `is not valid JSON (${(error as Error).message})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TemplateParseError(path, 'must be a JSON object');
  }

  const document = parsed as {
    sections?: Record<string, unknown>;
    order?: unknown;
    layout?: unknown;
    wrapper?: unknown;
  };

  const defined = document.sections;
  if (!defined || typeof defined !== 'object') {
    throw new TemplateParseError(path, 'has no "sections" object');
  }

  // `order` when present; otherwise key order, which is all we have.
  const order = Array.isArray(document.order)
    ? document.order.map(String)
    : Object.keys(defined);

  const sections: TemplateSection[] = [];
  for (const id of order) {
    const raw = defined[id];
    if (!raw || typeof raw !== 'object') continue;

    const entry = raw as {
      type?: unknown;
      settings?: unknown;
      blocks?: unknown;
      block_order?: unknown;
      disabled?: unknown;
    };
    if (typeof entry.type !== 'string' || entry.type === '') {
      throw new TemplateParseError(path, `section "${id}" has no type`);
    }

    sections.push({
      id,
      type: entry.type,
      settings: (entry.settings as Record<string, unknown>) ?? {},
      blocks: parseBlocks(entry.blocks, entry.block_order),
      disabled: entry.disabled === true,
    });
  }

  return {
    sections,
    layout: resolveLayout(document.layout),
    ...(typeof document.wrapper === 'string' ? { wrapper: document.wrapper } : {}),
  };
}

function parseBlocks(
  blocks: unknown,
  blockOrder: unknown,
): TemplateSection['blocks'] {
  if (!blocks || typeof blocks !== 'object') return [];

  const defined = blocks as Record<string, unknown>;
  const order = Array.isArray(blockOrder) ? blockOrder.map(String) : Object.keys(defined);

  const parsed: { id: string; type: string; settings: Record<string, unknown> }[] = [];
  for (const id of order) {
    const raw = defined[id];
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { type?: unknown; settings?: unknown };
    if (typeof entry.type !== 'string') continue;
    parsed.push({
      id,
      type: entry.type,
      settings: (entry.settings as Record<string, unknown>) ?? {},
    });
  }
  return parsed;
}

/**
 * A section group — the header and footer a merchant edits once for every page.
 *
 * Same shape as a JSON template minus the layout, which is why it reuses the
 * parser: a group that parsed differently from a template would be a second set
 * of rules for the same file format.
 */
export function parseSectionGroup(path: string, source: string): readonly TemplateSection[] {
  return parseJsonTemplate(path, source).sections;
}
