/**
 * Storefront · engine/filters/color.ts
 * The colour filters. All arithmetic lives in `../color`; these are the wiring.
 *
 * Every one of them returns an empty string for an input it cannot parse, which
 * is the reference product's behaviour and the right one: a theme computing a
 * hover colour from a merchant's setting should fall back to its own CSS rather
 * than paint the page black because somebody typed "dark blue".
 * Layer: engine.
 */

import {
  brightness,
  contrast,
  difference,
  formatColor,
  hslToRgb,
  lighten,
  mix,
  parseColor,
  rgbToHsl,
  saturate,
  type Rgb,
} from '../color';
import { arg, numberArg, type FilterDefinition, type FilterGroup } from '../types';

/** Wraps a filter that needs one parseable colour. */
function colorFilter(
  name: string,
  render: (color: Rgb, args: Parameters<FilterDefinition['apply']>[2]) => unknown,
): FilterDefinition {
  return {
    name,
    apply: (_context, value, args) => {
      const color = parseColor(value);
      return color === null ? '' : render(color, args);
    },
  };
}

/** Wraps a filter that needs two: the value and its first argument. */
function pairFilter(
  name: string,
  render: (a: Rgb, b: Rgb, args: Parameters<FilterDefinition['apply']>[2]) => unknown,
): FilterDefinition {
  return {
    name,
    apply: (_context, value, args) => {
      const first = parseColor(value);
      const second = parseColor(arg(args, 0));
      return first === null || second === null ? '' : render(first, second, args);
    },
  };
}

export const colorFilters: FilterGroup = {
  name: 'color',
  filters: [
    colorFilter('color_to_rgb', (color) =>
      color.a >= 1
        ? `rgb(${color.r}, ${color.g}, ${color.b})`
        : `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(color.a * 100) / 100})`,
    ),

    colorFilter('color_to_hsl', (color) => {
      const hsl = rgbToHsl(color);
      const h = Math.round(hsl.h);
      const s = Math.round(hsl.s * 100);
      const l = Math.round(hsl.l * 100);
      return color.a >= 1
        ? `hsl(${h}, ${s}%, ${l}%)`
        : `hsla(${h}, ${s}%, ${l}%, ${Math.round(color.a * 100) / 100})`;
    }),

    colorFilter('color_to_hex', (color) => formatColor({ ...color, a: 1 })),

    /**
     * One component of a colour, as a bare number.
     *
     * Themes use it to build their own `rgba(...)` strings with a computed
     * alpha, which is why an unknown component name returns empty rather than
     * zero — a zero would silently become a valid, wrong colour.
     */
    colorFilter('color_extract', (color, args) => {
      const hsl = rgbToHsl(color);
      switch (String(arg(args, 0) ?? '')) {
        case 'red':
          return color.r;
        case 'green':
          return color.g;
        case 'blue':
          return color.b;
        case 'alpha':
          return color.a;
        case 'hue':
          return Math.round(hsl.h);
        case 'saturation':
          return Math.round(hsl.s * 100);
        case 'lightness':
          return Math.round(hsl.l * 100);
        default:
          return '';
      }
    }),

    /** Sets one component and returns the whole colour. */
    colorFilter('color_modify', (color, args) => {
      const component = String(arg(args, 0) ?? '');
      const amount = numberArg(arg(args, 1), Number.NaN);
      if (!Number.isFinite(amount)) return '';

      switch (component) {
        case 'red':
          return formatColor({ ...color, r: clampByte(amount) });
        case 'green':
          return formatColor({ ...color, g: clampByte(amount) });
        case 'blue':
          return formatColor({ ...color, b: clampByte(amount) });
        case 'alpha':
          return formatColor({ ...color, a: Math.min(1, Math.max(0, amount)) });
        case 'hue':
          return formatColor(hslToRgb({ ...rgbToHsl(color), h: amount }));
        case 'saturation':
          return formatColor(hslToRgb({ ...rgbToHsl(color), s: clampFraction(amount / 100) }));
        case 'lightness':
          return formatColor(hslToRgb({ ...rgbToHsl(color), l: clampFraction(amount / 100) }));
        default:
          return '';
      }
    }),

    colorFilter('color_lighten', (color, args) =>
      formatColor(lighten(color, numberArg(arg(args, 0), 0))),
    ),
    colorFilter('color_darken', (color, args) =>
      formatColor(lighten(color, -numberArg(arg(args, 0), 0))),
    ),
    colorFilter('color_saturate', (color, args) =>
      formatColor(saturate(color, numberArg(arg(args, 0), 0))),
    ),
    colorFilter('color_desaturate', (color, args) =>
      formatColor(saturate(color, -numberArg(arg(args, 0), 0))),
    ),

    colorFilter('color_brightness', (color) => Math.round(brightness(color) * 100) / 100),

    /**
     * `weight` is how much of the FIRST colour survives, and defaults to 50.
     *
     * The order reads backwards, so it is spelled out: `a | color_mix: b, 25`
     * is one quarter `a`.
     */
    pairFilter('color_mix', (first, second, args) =>
      formatColor(mix(first, second, numberArg(arg(args, 1), 50))),
    ),

    /** WCAG ratio, 1–21. Rounded to two places, as the reference product does. */
    pairFilter('color_contrast', (first, second) => Math.round(contrast(first, second) * 100) / 100),

    pairFilter('color_difference', (first, second) => difference(first, second)),

    /**
     * The gap in perceived brightness between two colours.
     *
     * Paired with `color_difference` in the legibility rule themes use: the
     * w3c guidance asks for a brightness difference above 125 *and* a colour
     * difference above 500, which is why both exist and why neither is enough
     * alone.
     */
    pairFilter('brightness_difference', (first, second) =>
      Math.round(Math.abs(brightness(first) - brightness(second)) * 100) / 100,
    ),

    /**
     * A hex colour with an alpha applied.
     *
     * Named for hex input but accepts anything parseable, because themes reach
     * for it with a colour setting whose value may already be `rgb()`.
     */
    colorFilter('hex_to_rgba', (color, args) => {
      const alpha = args.positional.length > 0 ? numberArg(arg(args, 0), 1) : color.a;
      const clamped = Math.min(1, Math.max(0, alpha));
      return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(clamped * 100) / 100})`;
    }),
  ],
};

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
const clampFraction = (value: number): number => Math.min(1, Math.max(0, value));
