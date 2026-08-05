/**
 * Storefront · engine/filters/font.ts
 * The font filters: pick a variant, emit the @font-face.
 *
 * A font in a theme is not a string — it is an object with a family, a weight,
 * a style and a list of variants the merchant's chosen font actually has.
 * `font_modify` is how a theme asks for "the bold version of this", and it has
 * to be able to answer "there isn't one", because asking a browser to synthesise
 * bold from a regular weight produces the smeared text that gives web fonts a
 * bad name.
 * Layer: engine.
 */

import { arg, numberArg, stringify, type FilterGroup } from '../types';
import { handleize } from './string';

export interface ThemeFont {
  readonly family: string;
  readonly weight: string | number;
  readonly style: string;
  readonly fallback_families?: string;
  /** Weight/style pairs the family actually ships. */
  readonly variants?: readonly { weight: string | number; style: string }[];
  readonly system?: boolean;
}

function asFont(value: unknown): ThemeFont | null {
  if (!value || typeof value !== 'object') return null;
  const font = value as Partial<ThemeFont>;
  if (typeof font.family !== 'string' || font.family === '') return null;
  return {
    family: font.family,
    weight: font.weight ?? 400,
    style: font.style ?? 'normal',
    fallback_families: font.fallback_families,
    variants: font.variants,
    system: font.system,
  };
}

/** Whether the family ships this weight and style. */
function hasVariant(font: ThemeFont, weight: string | number, style: string): boolean {
  // No declared variant list means we cannot prove absence, so the request is
  // honoured. Refusing by default would break every font whose metadata we have
  // not loaded yet.
  if (!font.variants) return true;
  return font.variants.some(
    (variant) => String(variant.weight) === String(weight) && variant.style === style,
  );
}

export const fontFilters: FilterGroup = {
  name: 'font',
  filters: [
    /**
     * Asks for a different weight or style of the same family.
     *
     * Returns nothing when the variant does not exist — themes test for that
     * (`assign bold = font | font_modify: 'weight', 'bolder'` then `if bold`),
     * which only works if the absent case is falsy rather than the original.
     */
    {
      name: 'font_modify',
      apply: (_context, value, args) => {
        const font = asFont(value);
        if (!font) return null;

        const property = stringify(arg(args, 0));
        const target = arg(args, 1);

        if (property === 'style') {
          const style = stringify(target);
          return hasVariant(font, font.weight, style) ? { ...font, style } : null;
        }

        if (property !== 'weight') return null;

        const weight = resolveWeight(font.weight, target);
        if (weight === null) return null;
        return hasVariant(font, weight, font.style) ? { ...font, weight } : null;
      },
    },

    /**
     * The `@font-face` rule for this font.
     *
     * `font-display: swap` is worth understanding rather than passing through:
     * it tells the browser to show the fallback immediately and swap when the
     * webfont arrives, which trades a flash of restyled text for text that is
     * readable during the load. The reference theme asks for it explicitly.
     */
    {
      name: 'font_face',
      returnsHtml: true,
      apply: (context, value, args) => {
        const font = asFont(value);
        // A system font is already on the machine; an @font-face for it would
        // be a request for a file that does not exist.
        if (!font || font.system) return '';

        const display = stringify(args.named.font_display) || 'swap';
        const base = context.assetBaseUrl.replace(/\/+$/, '');
        const slug = `${handleize(font.family)}_${font.style}_${font.weight}`;

        const src = [
          `url("${base}/fonts/${slug}.woff2") format("woff2")`,
          `url("${base}/fonts/${slug}.woff") format("woff")`,
        ].join(', ');

        return [
          '@font-face {',
          `  font-family: "${font.family.replace(/"/g, '')}";`,
          `  font-weight: ${font.weight};`,
          `  font-style: ${font.style};`,
          `  font-display: ${/^[a-z-]+$/.test(display) ? display : 'swap'};`,
          `  src: ${src};`,
          '}',
        ].join('\n');
      },
    },
  ],
};

/**
 * A target weight, given the current one.
 *
 * Accepts a number, or the relative words the reference product defines.
 * `bolder`/`lighter` step by 300 and clamp, which is what makes
 * `font_modify: 'weight', 'bolder'` work on a family whose regular is 300.
 */
function resolveWeight(current: string | number, target: unknown): number | null {
  const now = numberArg(current, 400);
  const word = stringify(target).toLowerCase();

  if (word === 'bolder') return Math.min(900, now + 300);
  if (word === 'lighter') return Math.max(100, now - 300);
  if (word === 'bold') return 700;
  if (word === 'normal' || word === 'regular') return 400;

  const numeric = numberArg(target, Number.NaN);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(900, Math.max(100, Math.round(numeric / 100) * 100));
}
