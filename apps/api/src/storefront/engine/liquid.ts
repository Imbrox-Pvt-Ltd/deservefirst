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

import { isThemePath, type ThemeSource } from '../domain/theme-source';
import type { RenderContext } from './context';
import { aliasFilters } from './compat';
import { allFilters } from './filters';
import { allTags, type BlockOpening, type TagContext } from './tags';
import type { FilterArgs, TemplateUsage, ThemeEngine } from './types';

/**
 * The state a tag carries from parse to render.
 *
 * liquidjs binds the same object as `this` in both, which is how a tag keeps
 * its arguments and body between the two phases. Typed here rather than left as
 * `never` by a blanket cast, so the registrations below actually type-check.
 */
interface TagState {
  args: string;
  body: string;
  templates: unknown[];
}

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
  /**
   * Also answer to the filter names other platforms use.
   *
   * Off by default: our names are the real ones, and `theme:port` gives a
   * developer a theme in our vocabulary with a diff they can review. This is
   * for themes that cannot be ported — one still tracking an upstream release,
   * or one a merchant has no ability to edit.
   */
  readonly compatibility?: boolean;
  /**
   * Where theme files are read from.
   *
   * Without one, `{% render %}` and `renderFile` have nothing to resolve
   * against — which is correct for the many tests that render a string.
   */
  readonly source?: ThemeSource;
  /**
   * Objects visible everywhere, including inside `{% render %}`.
   *
   * This distinction is not cosmetic and it silently broke a real theme.
   * `{% render %}` isolates its scope — a snippet sees NOTHING its caller had
   * — so passing `product` and `shop` as render scope means a section that
   * delegates to a snippet renders an empty page. The reference product treats
   * those as globals, and the reference theme's own product section is exactly
   * one line: `{% render 'product' %}`.
   *
   * `section` and `block` are deliberately NOT globals. They are per-section
   * locals in the reference product too, which is why themes pass them onward
   * explicitly when a snippet needs one.
   */
  readonly globals?: Record<string, unknown>;
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
    private readonly options: EngineOptions = {},
  ) {
    this.liquid = new Liquid({
      root: options.source ? '' : (options.root as string | string[] | undefined),
      globals: options.globals,
      extname: '.liquid',

      /**
       * Theme file lookup, routed through the source rather than the disk.
       *
       * This is what makes `{% render %}`, `{% section %}` and `renderFile`
       * read a theme wherever it lives — a directory in development, object
       * storage in production, an unsaved buffer in the editor.
       *
       * It is also the confinement point. `contains` is the engine's own hook
       * for "is this path inside the root", and answering it from
       * `isThemePath` means a theme naming `../../etc/passwd` is refused by the
       * lookup rather than by the source having to notice later.
       */
      ...(options.source
        ? {
            fs: {
              sep: '/',
              /**
               * Theme-relative resolution, ignoring the engine's own directory.
               *
               * The directory is discarded deliberately. liquidjs passes `.`
               * when no root is configured, which turned every lookup into
               * `./layout/theme.liquid` — three segments, refused by
               * `confinePath`, and every render failed with a lookup error. A
               * theme path is always relative to the theme root, never to the
               * file doing the including, so there is nothing the directory
               * could correctly contribute.
               *
               * A bare name means a snippet: themes write `{% render 'card' %}`
               * rather than `{% render 'snippets/card' %}`, and that is the
               * convention their authors already have.
               */
              resolve: (_dir: string, file: string, ext: string) => {
                const cleaned = file.replace(/^\.?\/+/, '');
                const path = cleaned.includes('/') ? cleaned : `snippets/${cleaned}`;
                return path.endsWith(ext) ? path : `${path}${ext}`;
              },
              /**
               * Declared async because the engine's type says so — and that is
               * worth a second look rather than a shrug. If liquidjs merely
               * truthiness-checked this instead of awaiting it, a promise would
               * always be truthy and the confinement would silently open.
               * A test renders `{% render '../../etc/passwd' %}` through this
               * exact path to prove it still refuses.
               */
              contains: async (_root: string, file: string) => isThemePath(file),
              exists: (path: string) => options.source!.exists(path),
              existsSync: () => false,
              readFile: async (path: string) => (await options.source!.read(path)) ?? '',
              readFileSync: () => '',
              dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
            },
          }
        : {}),

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

    const registered = options.compatibility
      ? [...allFilters(), ...aliasFilters(allFilters())]
      : allFilters();

    for (const filter of registered) {
      // `function` rather than an arrow: liquidjs binds the filter's own
      // metadata to `this`, and that is where the argument tokens live.
      const self = this;
      this.liquid.registerFilter(filter.name, function (this: FilterCallSite, value: unknown, ...rest: unknown[]) {
        return filter.apply(self.context, fromEngine(value), splitArgs(this, rest));
      });
    }

    this.registerTags();
  }

  /**
   * Registers our tags, translating each kind to the engine's own API.
   *
   * The three kinds map to three genuinely different liquidjs mechanics, each
   * verified against the engine before being relied on: capturing tokens
   * without parsing them, parsing a body and rendering it with a pushed scope,
   * and a tag with no body at all.
   */
  private registerTags(): void {
    const engine = this.liquid;
    const self = this;

    for (const tag of allTags()) {
      if (tag.kind === 'raw') {
        engine.registerTag(tag.name, {
          parse(this: TagState, token: { args: string }, remaining: { name: string; getText?: () => string }[]) {
            this.args = token.args;
            const body: string[] = [];
            // Tokens are consumed as text, never parsed. A `{% schema %}` body
            // is JSON and would fail on its first brace.
            while (remaining.length > 0) {
              const next = remaining.shift();
              if (!next || next.name === `end${tag.name}`) break;
              body.push(next.getText?.() ?? '');
            }
            this.body = body.join('');
          },
          async render(this: TagState, context: unknown) {
            return tag.render(this.body, this.args, self.tagContext(context));
          },
        } as unknown as Parameters<Liquid['registerTag']>[1]);
        continue;
      }

      if (tag.kind === 'inline') {
        engine.registerTag(tag.name, {
          parse(this: TagState, token: { args: string }) {
            this.args = token.args;
          },
          async render(this: TagState, context: unknown) {
            return tag.render(this.args, self.tagContext(context));
          },
        } as unknown as Parameters<Liquid['registerTag']>[1]);
        continue;
      }

      // A block: the body IS Liquid, parsed now and rendered with the scope the
      // tag contributes.
      engine.registerTag(tag.name, {
        parse(this: TagState, token: { args: string }, remaining: unknown[]) {
          this.args = token.args;
          this.templates = [];
          const stream = (engine as never as { parser: { parseStream: (t: unknown[]) => never } })
            .parser.parseStream(remaining) as unknown as {
            on: (event: string, handler: (value?: unknown) => void) => typeof stream;
            start: () => void;
            stop: () => void;
          };
          stream
            .on('template', (template: unknown) => {
              (this.templates).push(template);
            })
            .on(`tag:end${tag.name}`, function (this: { stop: () => void }) {
              this.stop();
            })
            .on('end', () => {
              throw new Error(`{% ${tag.name} %} was never closed with {% end${tag.name} %}`);
            });
          stream.start();
        },
        /**
         * A generator, not an async function — this is not stylistic.
         *
         * `renderer.renderTemplates` returns a generator that liquidjs drives
         * itself; awaiting it resolves to the generator object and renders
         * nothing at all. The symptom was precise and quiet: `{% style %}`
         * emitted `<style></style>` with the body silently missing, and
         * `{% form %}` produced a form with no fields in it. Yielding hands
         * control back to the engine, which is what actually runs the body.
         *
         * Yielding a promise works the same way, so `open` may still be async.
         */
        *render(this: TagState, context: unknown, emitter: { write: (value: string) => void }) {
          const opening = (yield tag.open(this.args, self.tagContext(context))) as BlockOpening;

          if (opening.before) emitter.write(opening.before);

          const scoped = context as { push: (scope: unknown) => void; pop: () => void };
          // Pushed for the body only, so the tag's variables leave scope at the
          // closing tag rather than leaking into the rest of the template.
          if (opening.scope) scoped.push(opening.scope);
          try {
            yield (engine as never as {
              renderer: { renderTemplates: (t: unknown, c: unknown, e: unknown) => unknown };
            }).renderer.renderTemplates(this.templates, context, emitter);
          } finally {
            if (opening.scope) scoped.pop();
          }

          if (opening.after) emitter.write(opening.after);
        },
      } as unknown as Parameters<Liquid['registerTag']>[1]);
    }
  }

  /** The capabilities a tag is given, and no others. */
  private tagContext(context: unknown): TagContext {
    const scope = context as { get?: (path: string[]) => unknown };
    return {
      render: this.context,
      get: (path: string) => {
        try {
          return scope.get?.(path.split('.'));
        } catch {
          // A tag reading a variable that does not exist gets nothing, matching
          // how `strictVariables: false` treats the same read in a template.
          return undefined;
        }
      },
      renderFile: (path: string, extra: Record<string, unknown>) =>
        this.liquid.renderFile(path, extra),
    };
  }

  hasFilter(name: string): boolean {
    return Boolean((this.liquid.filters as Record<string, unknown>)[name]);
  }

  hasTag(name: string): boolean {
    return Boolean((this.liquid.tags as Record<string, unknown>)[name]);
  }

  async render(template: string, scope: Record<string, unknown>): Promise<string> {
    return this.liquid.parseAndRender(template, scope);
  }

  /**
   * Renders a theme file, optionally making values visible inside `{% render %}`.
   *
   * `ambient` is for `section` and `block`. They cannot travel in the scope,
   * because `{% render %}` isolates it — and the reference theme's hero section
   * is one line, `{% render 'hero' %}`, whose snippet then reads
   * `section.settings`, `section.blocks` and `section.id`. Passed as scope, the
   * snippet saw none of it and rendered `id="Hero--"` with an empty block loop:
   * a section that appeared to work while producing nothing.
   *
   * The comment this replaces claimed themes pass `section` onward explicitly
   * when a snippet needs one. Real themes do not, and this one does not.
   *
   * Merged with the engine's own globals rather than replacing them —
   * liquidjs's per-call globals REPLACE, so passing only `section` would take
   * `shop`, `settings` and every drop away from the snippet at the same time.
   */
  /**
   * What one template reaches for.
   *
   * Uses the parser rather than a regular expression, which is the whole point:
   * a regex over `replace: '|||sizes|||'` reports a filter called `sizes`, and
   * over `{{ 'general.meta.page' | t }}` reports an object called `general`.
   * The parser knows a string literal from an identifier, so neither mistake is
   * possible.
   *
   * A template that does not parse contributes nothing rather than throwing.
   * `theme:check` already reports Liquid errors through the linter, and a
   * coverage report that died on the first malformed file would tell a
   * developer far less than one that covered the other four hundred.
   */
  analyse(file: string, source: string): TemplateUsage {
    const filters: { name: string; file: string; line: number }[] = [];
    const tags: { name: string; file: string; line: number }[] = [];
    const objects: { name: string; file: string; line: number }[] = [];
    const bound = new Set<string>();

    const lineAt = (offset: number): number => source.slice(0, offset).split('\n').length;

    /** Pulls filters and the root object out of one expression. */
    const readExpression = (expression: string, line: number): void => {
      if (expression.trim() === '') return;
      try {
        for (const parsed of this.liquid.parse(`{{ ${expression} }}`)) {
          const value = (parsed as { value?: { filters?: { name: string }[]; initial?: unknown } })
            .value;
          if (!value) continue;

          for (const filter of value.filters ?? []) {
            filters.push({ name: filter.name, file, line });
          }

          const initial = value.initial as { postfix?: { getText?: () => string }[] } | undefined;
          const first = initial?.postfix?.[0]?.getText?.();
          if (typeof first !== 'string') continue;

          /**
           * The ROOT of the path, not the whole of it.
           *
           * `product.featured_image.src` is one question — does `product`
           * exist — and reporting the full path would list a different gap for
           * every property a theme happened to read.
           */
          const root = first.split('.')[0] as string;
          // A quoted literal is a value, not a reference to anything.
          if (/^[A-Za-z_][\w-]*$/.test(root)) objects.push({ name: root, file, line });
        }
      } catch {
        // An expression this engine cannot parse is reported by the linter, not
        // here.
      }
    };

    let templates;
    try {
      templates = this.liquid.parse(source);
    } catch {
      return { filters: [], tags: [], objects: [], bound: [] };
    }

    const walk = (nodes: unknown[]): void => {
      for (const node of nodes) {
        const token = (node as { token?: { constructor: { name: string } } }).token;
        if (!token) continue;

        const begin = (token as unknown as { begin?: number }).begin ?? 0;
        const line = lineAt(begin);
        const name = (token as unknown as { name?: string }).name;

        if (typeof name === 'string') {
          tags.push({ name, file, line });

          const args = (token as unknown as { args?: string }).args ?? '';

          /**
           * A `{% liquid %}` block is many statements, one per line.
           *
           * Read as a single tag its arguments are `assign x = …`, so the name
           * bound is "assign" and `x` looks like an object this platform does
           * not provide. The reference theme writes most of its logic this way,
           * and the first report was three quarters the theme's own variables —
           * which is the failure that makes a checker ignorable.
           */
          const statements =
            name === 'liquid'
              ? args.split('\n').map((line) => line.trim()).filter((line) => line !== '')
              : [`${name} ${args}`];

          for (const statement of statements) {
            const match = /^([a-z_][\w]*)\s*([\s\S]*)$/.exec(statement);
            if (!match) continue;

            const inner = match[1] as string;
            const innerArgs = match[2] as string;

            if (name === 'liquid') tags.push({ name: inner, file, line });

            const introduced = boundBy(inner, innerArgs);
            if (introduced) bound.add(introduced);

            /**
             * A snippet's parameters are bound by whoever renders it.
             *
             * `{% render 'share-button', align: 'left' %}` puts `align` in the
             * snippet's scope, so the snippet reading `align` is not asking the
             * platform for anything. Without this every parameter any theme
             * passes anywhere is reported as a missing object.
             */
            if (inner === 'render' || inner === 'include') {
              for (const parameter of innerArgs.matchAll(/([A-Za-z_][\w-]*)\s*:/g)) {
                bound.add(parameter[1] as string);
              }
            }

            readExpression(expressionOf(inner, innerArgs), line);
          }
        } else {
          // An output token: `{{ … }}`.
          const value = (node as { value?: { filters?: { name: string }[]; initial?: unknown } })
            .value;
          if (value) {
            for (const filter of value.filters ?? []) filters.push({ name: filter.name, file, line });
            const initial = value.initial as { postfix?: { getText?: () => string }[] } | undefined;
            const first = initial?.postfix?.[0]?.getText?.();
            if (typeof first === 'string') {
              const root = first.split('.')[0] as string;
              if (/^[A-Za-z_][\w-]*$/.test(root)) objects.push({ name: root, file, line });
            }
          }
        }

        /**
         * Into a block tag's body, because that is where most of a theme is.
         *
         * Everything inside `{% if %}`, `{% for %}` and `{% case %}` is
         * otherwise invisible — the large majority of every file in a real
         * theme. `branches` is the shape that catches people out: its elements
         * are `{ value, templates }` pairs rather than templates, so walking it
         * directly finds nothing and silently reports a clean file.
         */
        for (const key of ['templates', 'elseTemplates', 'defaultTemplates']) {
          const children = (node as Record<string, unknown>)[key];
          if (Array.isArray(children)) walk(children);
        }

        const branches = (node as Record<string, unknown>).branches;
        if (Array.isArray(branches)) {
          for (const branch of branches) {
            const inner = (branch as { templates?: unknown }).templates;
            if (Array.isArray(inner)) walk(inner);
          }
        }
      }
    };

    walk(templates as unknown[]);

    return { filters, tags, objects, bound: [...bound] };
  }

  async renderFile(
    path: string,
    scope: Record<string, unknown>,
    ambient?: Record<string, unknown>,
  ): Promise<string> {
    if (!ambient) return this.liquid.renderFile(path, scope);

    return this.liquid.renderFile(path, scope, {
      globals: { ...(this.options.globals ?? {}), ...ambient },
    });
  }
}

/**
 * Names a tag introduces into the scope, and where in its arguments they are.
 *
 * `{% assign x = ... %}` binds the first word; `{% for x in y %}` binds the
 * loop variable; `{% capture x %}` binds its target. Anything a theme defines
 * for itself is not a gap in the platform, however unfamiliar the name looks.
 */
const BINDING_TAGS: Readonly<Record<string, 'first' | 'for'>> = {
  assign: 'first',
  capture: 'first',
  increment: 'first',
  decrement: 'first',
  for: 'for',
  tablerow: 'for',
};

/**
 * The expression inside a tag's arguments, if it has one.
 *
 * `assign a = b | money` is the value after the `=`; `for x in list` is what
 * follows `in`. Everything else is already an expression — `if product.available`
 * — and is used as it stands.
 */
function expressionOf(tag: string, args: string): string {
  if (args.trim() === '') return '';

  /**
   * Tags whose arguments name a FILE rather than describe a value.
   *
   * `{% layout none %}` and `{% section 'header' %}` take a name. Read as an
   * expression, `none` becomes an object this platform apparently does not
   * provide — which is how a keyword ended up in a compatibility report.
   */
  if (tag === 'layout' || tag === 'section' || tag === 'sections') return '';
  if (BINDING_TAGS[tag] === 'first') {
    const at = args.indexOf('=');
    return at === -1 ? '' : args.slice(at + 1);
  }
  if (BINDING_TAGS[tag] === 'for') {
    const match = /\bin\s+([\s\S]+)$/.exec(args);
    return match ? (match[1] as string) : '';
  }
  return args;
}

/** The name a binding tag introduces. */
function boundBy(tag: string, args: string): string | null {
  const kind = BINDING_TAGS[tag];
  if (!kind) return null;
  const match = /^\s*([A-Za-z_][\w-]*)/.exec(args);
  return match ? (match[1] as string) : null;
}

export function createThemeEngine(
  context: RenderContext,
  options: EngineOptions = {},
): ThemeEngine {
  return new LiquidThemeEngine(context, options);
}
