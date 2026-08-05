/**
 * Storefront · engine/tags/types.ts
 * The shape of a tag, in our vocabulary rather than liquidjs's.
 *
 * Same discipline as the filters: a tag is written against these types and
 * imports nothing from liquidjs, so `liquid.ts` stays the only file that knows
 * what engine we run. Without this, adding tags would have quietly made the
 * engine irreplaceable — a tag written against liquidjs's parser and emitter is
 * far more entangled than a filter, which is exactly why it needed the
 * abstraction more.
 *
 * Three kinds, because measuring the engine showed three genuinely different
 * mechanics rather than one with options:
 *
 *   raw    — the body is captured as text and never parsed. `{% schema %}` is
 *            JSON and `{% javascript %}` is JavaScript; parsing either as
 *            Liquid would fail on the first brace.
 *   block  — the body IS Liquid, rendered with extra variables in scope and
 *            optional markup around it. `{% paginate %}` and `{% form %}`.
 *   inline — no body. `{% section %}` renders another file entirely.
 * Layer: engine.
 */

import type { RenderContext } from '../context';

/** What a tag may reach while rendering. */
export interface TagContext {
  readonly render: RenderContext;
  /** Reads a variable from the template's own scope. */
  readonly get: (path: string) => unknown;
  /**
   * Renders another template file.
   *
   * Supplied by the boundary rather than reached for, so a tag cannot render
   * an arbitrary path — the loader decides what is resolvable, and that is
   * where a theme is confined to its own files.
   */
  readonly renderFile: (path: string, scope: Record<string, unknown>) => Promise<string>;
}

export interface RawTag {
  readonly name: string;
  readonly kind: 'raw';
  /** `body` is the text between the tags, exactly as written. */
  readonly render: (body: string, args: string, context: TagContext) => string | Promise<string>;
}

/** What a block tag contributes around and inside its body. */
export interface BlockOpening {
  /** Variables added for the body only; they leave scope at the closing tag. */
  readonly scope?: Record<string, unknown>;
  readonly before?: string;
  readonly after?: string;
}

export interface BlockTag {
  readonly name: string;
  readonly kind: 'block';
  readonly open: (args: string, context: TagContext) => BlockOpening | Promise<BlockOpening>;
}

export interface InlineTag {
  readonly name: string;
  readonly kind: 'inline';
  readonly render: (args: string, context: TagContext) => string | Promise<string>;
}

export type TagDefinition = RawTag | BlockTag | InlineTag;

/**
 * Parses a tag's argument string into positional and named parts.
 *
 * liquidjs hands a tag its arguments as one unparsed string — `"'product-card',
 * product: product, index: 2"` — because a tag may invent any syntax it likes.
 * Ours do not, so they share this: quoted strings are positional, `name: value`
 * pairs are named, and a value is left as source for the caller to evaluate
 * against the scope.
 */
export function parseTagArgs(args: string): {
  positional: string[];
  named: Record<string, string>;
} {
  const positional: string[] = [];
  const named: Record<string, string> = {};

  // Split on commas that are not inside quotes; a title like "Hats, caps" is
  // one argument rather than two.
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of args) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    // `name: value`, where the colon is not inside quotes.
    const colon = indexOfUnquoted(trimmed, ':');
    if (colon > 0) {
      named[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
      continue;
    }
    positional.push(trimmed);
  }

  return { positional, named };
}

function indexOfUnquoted(text: string, needle: string): number {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === needle) return index;
  }
  return -1;
}

/** Strips the quotes from a literal, or returns null if it was not one. */
export function asLiteral(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^['"]/.test(trimmed) && trimmed.endsWith(trimmed[0] as string)) {
    return trimmed.slice(1, -1);
  }
  return null;
}
