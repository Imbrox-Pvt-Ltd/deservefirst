/**
 * Storefront · engine/types.ts
 * The shape of a filter, in our vocabulary rather than liquidjs's.
 *
 * This is the point of the layer. Every filter in `filters/` is written against
 * these types and imports nothing from liquidjs; `liquid.ts` translates them at
 * the boundary. So a filter is an ordinary function of its inputs — testable by
 * calling it, readable without knowing the engine, and unchanged if we ever swap
 * liquidjs for the Ruby gem out-of-process.
 *
 * Layer: engine.
 */

import type { RenderContext } from './context';

/**
 * A filter's arguments, positional and named.
 *
 * Storefront filters take both — `image_url: width: 200` is named, `truncate: 20`
 * is positional, and `color_mix: other, 50` is both — so a single call shape has
 * to carry the two. Keyword arguments arrive already evaluated.
 */
export interface FilterArgs {
  readonly positional: readonly unknown[];
  readonly named: Readonly<Record<string, unknown>>;
}

export type FilterFn = (
  context: RenderContext,
  value: unknown,
  args: FilterArgs,
) => unknown;

export interface FilterDefinition {
  readonly name: string;
  readonly apply: FilterFn;
  /**
   * This filter emits markup, so it is responsible for escaping its own inputs.
   *
   * A contract between maintainers rather than a switch the engine reads.
   * Liquid does not escape output — neither the reference product nor liquidjs
   * does, and turning it on would double-escape every theme written for that
   * product. So marking a filter here does not make it safe; it records that
   * safety is this filter's job, and a test asserts every one of them routes
   * through `markup.ts` rather than concatenating values into tags.
   */
  readonly returnsHtml?: boolean;
}

/**
 * Filters grouped by what they are about.
 *
 * Grouping is for the people maintaining this, not the engine: forty-nine
 * filters in one file is a file nobody edits confidently, and "where does
 * `color_mix` live" should have an obvious answer.
 */
export interface FilterGroup {
  readonly name: string;
  readonly filters: readonly FilterDefinition[];
}

/** Convenience for the common case of one positional argument. */
export function arg(args: FilterArgs, index: number): unknown {
  return args.positional[index];
}

/**
 * A filter argument as a number, or a fallback.
 *
 * Liquid is forgiving about types — `"3"` and `3` are both a three — and a
 * filter that returns `NaN` because a theme passed a string from a setting
 * would be a bug reported as "the padding is broken".
 */
export function numberArg(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * A value as a string, the way Liquid does it.
 *
 * `nil` renders as empty rather than "null", which matters because themes rely
 * on it: `{{ product.description | strip_html }}` on a product without one
 * should produce nothing, not the word "undefined".
 */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringify).join('');
  return String(value);
}

/**
 * The engine, as the rest of the platform sees it.
 *
 * Deliberately small. Everything a caller needs is "render this template with
 * this data"; anything more specific is the engine's business.
 */
export interface ThemeEngine {
  render(template: string, scope: Record<string, unknown>): Promise<string>;
  /** Renders a named file through the configured loader. */
  renderFile(path: string, scope: Record<string, unknown>): Promise<string>;
  /** Whether a filter of this name is available — used by conformance checks. */
  hasFilter(name: string): boolean;
  hasTag(name: string): boolean;
}
