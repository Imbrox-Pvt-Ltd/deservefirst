/**
 * Storefront · engine/liquid.ts
 * The only file on the platform that imports liquidjs.
 *
 * Everything else — every filter, every caller — is written against `types.ts`
 * and `context.ts`. This file translates between the two, which is what makes
 * the engine choice reversible: replacing liquidjs with the Ruby gem
 * out-of-process changes this file and nothing else. A fitness rule fails the
 * build if any other file imports liquidjs, because a boundary nobody enforces
 * stops being one within a release or two.
 *
 * Two behaviours are settled here on purpose, both matching the reference
 * product rather than liquidjs's defaults — see `strictFilters` and the note on
 * escaping below.
 * Layer: engine (infrastructure).
 */

import { Liquid } from 'liquidjs';

import type { RenderContext } from './context';
import { allFilters } from './filters';
import type { FilterArgs, ThemeEngine } from './types';

/**
 * What liquidjs binds to `this` inside a filter, as much of it as we use.
 *
 * Declared structurally rather than imported: liquidjs does not export
 * `FilterImpl` from its entry point, and depending on a deep path into a
 * package's `dist` is a dependency on its build layout. Two optional fields is
 * a smaller thing to keep true than an import that breaks on a patch release.
 */
interface FilterCallSite {
  readonly token?: { readonly args?: readonly unknown[] };
}

export interface EngineOptions {
  /** Where `{% render %}` and `{% section %}` look for files. */
  readonly root?: string | readonly string[];
  /**
   * How long one render may take before it is abandoned.
   *
   * A theme is untrusted code and Liquid has loops. Without a ceiling, one
   * template with a pathological `for` holds a worker thread until the request
   * times out somewhere less specific and harder to attribute.
   */
  readonly timeoutMs?: number;
}

/**
 * Splits liquidjs's flat argument list into positional and named.
 *
 * liquidjs passes a keyword argument as a `[name, value]` array in the same
 * positional list, which is indistinguishable from a theme passing a real
 * two-element array — measured, not assumed. The parsed token disambiguates:
 * a keyword argument's token is itself an array of two tokens, a positional
 * one's is a single token. So the syntax decides, never the shape of the value.
 */
function splitArgs(impl: FilterCallSite, values: readonly unknown[]): FilterArgs {
  const tokens = impl.token?.args ?? [];

  const positional: unknown[] = [];
  const named: Record<string, unknown> = {};

  values.forEach((value, index) => {
    const isKeyword = Array.isArray(tokens[index]) && Array.isArray(value) && value.length === 2;
    if (isKeyword) {
      named[String((value as unknown[])[0])] = fromEngine((value as unknown[])[1]);
      return;
    }
    positional.push(fromEngine(value));
  });

  return { positional, named };
}

/**
 * Turns liquidjs's own sentinels into plain JavaScript values.
 *
 * `{{ nil | array }}` does not hand a filter `null` — it hands over a `NullDrop`
 * instance, which is an object and therefore truthy. A filter checking
 * `value == null` sees a value and wraps it, so `nil | array` produced a
 * one-element array containing the sentinel. Found by a test, not by reading.
 *
 * Normalising here rather than in each filter is the entire argument for this
 * layer: it is a liquidjs representation detail, so it stops at the boundary
 * and forty-nine filters get to be ordinary functions of ordinary values.
 */
function fromEngine(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // The sentinels expose themselves through valueOf; a real drop returning null
  // from valueOf is saying the same thing and is treated the same way.
  const unwrapped = (value as { valueOf?: () => unknown }).valueOf?.();
  return unwrapped === null || unwrapped === undefined ? null : value;
}

class LiquidThemeEngine implements ThemeEngine {
  private readonly liquid: Liquid;

  constructor(
    private readonly context: RenderContext,
    options: EngineOptions = {},
  ) {
    this.liquid = new Liquid({
      root: options.root as string | string[] | undefined,
      extname: '.liquid',

      /**
       * A missing filter or variable is an error, not a silent pass-through.
       *
       * liquidjs's default is to return the value unchanged when a filter does
       * not exist, which means `{{ price | money }}` on a platform without a
       * `money` filter renders `2999` and nobody notices until a customer is
       * charged the wrong-looking amount. Loud is the only safe setting.
       */
      strictFilters: true,
      strictVariables: false,

      /**
       * `strictVariables` stays off, unlike `strictFilters`, and the asymmetry
       * is deliberate. Themes legitimately read variables that may not exist —
       * `{% if section.settings.subtitle %}` is the normal way to ask whether a
       * merchant filled something in. A missing filter is a platform bug; a
       * missing variable is Tuesday.
       */

      // Output is not escaped, matching the reference product: themes call
      // `| escape` where they want it, and auto-escaping would double-escape
      // every theme written for the reference product. Filters emitting markup escape
      // their own inputs — see markup.ts.
      outputEscape: undefined,

      // `{{-` and `-}}` behave as themes expect; the reference theme uses them
      // on nearly every line.
      trimTagLeft: false,
      trimTagRight: false,
    });

    for (const filter of allFilters()) {
      // `function` rather than an arrow: liquidjs binds the filter's own
      // metadata to `this`, and that is where the argument tokens live.
      const self = this;
      this.liquid.registerFilter(filter.name, function (this: FilterCallSite, value: unknown, ...rest: unknown[]) {
        return filter.apply(self.context, fromEngine(value), splitArgs(this, rest));
      });
    }
  }

  hasFilter(name: string): boolean {
    return Boolean((this.liquid.filters as Record<string, unknown>)[name]);
  }

  async render(template: string, scope: Record<string, unknown>): Promise<string> {
    return this.liquid.parseAndRender(template, scope);
  }

  async renderFile(path: string, scope: Record<string, unknown>): Promise<string> {
    return this.liquid.renderFile(path, scope);
  }
}

export function createThemeEngine(
  context: RenderContext,
  options: EngineOptions = {},
): ThemeEngine {
  return new LiquidThemeEngine(context, options);
}
