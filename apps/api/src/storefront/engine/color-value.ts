/**
 * Storefront · engine/color-value.ts
 * A colour setting, as the object a theme reads.
 *
 * The third instance of one pattern, and the pattern is worth naming: a theme
 * treats a setting as an OBJECT and we hand it a string. Fonts were the first
 * — `settings.type_base_font.family` on a `dm_sans_n4` string — and this is
 * the same fault for colours.
 *
 * The reference theme's hero gates its entire block loop on colour properties:
 *
 *     {% if color_product_text.alpha != 0.0 and color_product_text != blank %}
 *
 * `.alpha` on a string is nothing, and in Liquid `nothing != 0.0` is TRUE, so
 * branches meant to be skipped were taken and branches meant to be taken were
 * not. Nothing errored; some headings simply never appeared.
 *
 * The critical property, and the reason this is a wrapper rather than a plain
 * object: **it must still print as the colour**. Themes write
 * `background: {{ settings.menu_bg_color }}` far more often than they read a
 * component, so a value that stringified to `[object Object]` would replace a
 * missing heading with a broken stylesheet — a much worse trade.
 * Layer: engine.
 */

import { formatColor, parseColor, rgbToHsl, type Rgb } from './color';

/**
 * A colour that behaves as its own CSS text and as an object.
 *
 * `toString`, `valueOf` and `toLiquid` all return the CSS string, because the
 * three are reached by different paths — interpolation, comparison, and the
 * engine's own value resolution — and a value that answered one of them
 * differently would print correctly in some places and not others.
 */
export class ColorValue {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;

  private constructor(
    private readonly css: string,
    rgb: Rgb,
  ) {
    this.red = rgb.r;
    this.green = rgb.g;
    this.blue = rgb.b;
    this.alpha = rgb.a ?? 1;

    const hsl = rgbToHsl(rgb);
    this.hue = Math.round(hsl.h);
    this.saturation = Math.round(hsl.s);
    this.lightness = Math.round(hsl.l);
  }

  /**
   * Builds one, or returns null for anything that is not a colour.
   *
   * Null rather than a black default: a theme testing `!= blank` is asking
   * whether the merchant chose a colour, and answering with black would turn
   * "no colour set" into "the colour is black" — which is how a transparent
   * overlay becomes an opaque one.
   */
  static from(value: unknown): ColorValue | null {
    if (value instanceof ColorValue) return value;
    if (typeof value !== 'string' || value.trim() === '') return null;

    const rgb = parseColor(value);
    if (rgb === null) return null;

    return new ColorValue(value.trim(), rgb);
  }

  get rgb(): string {
    return `${this.red}, ${this.green}, ${this.blue}`;
  }

  get rgba(): string {
    return `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha})`;
  }

  get hsl(): string {
    return `${this.hue}, ${this.saturation}%, ${this.lightness}%`;
  }

  /** The hex form, for a theme that wants it regardless of what was written. */
  get hex(): string {
    return formatColor({ r: this.red, g: this.green, b: this.blue, a: this.alpha });
  }

  toString(): string {
    return this.css;
  }

  valueOf(): string {
    return this.css;
  }

  /** liquidjs asks for this before rendering a value it does not recognise. */
  toLiquid(): string {
    return this.css;
  }

  toJSON(): string {
    return this.css;
  }
}

/**
 * Replaces colour strings in a settings object with colour values.
 *
 * By key name, matching how the font settings are resolved and for the same
 * reason: a setting called `menu_bg_color` is a colour, and a product code that
 * happens to parse as one is not. `color_scheme` is excluded because its value
 * is a scheme NAME — `scheme-1` — and not a colour at all.
 */
export function resolveColorSettings(
  settings: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...settings };

  for (const [key, value] of Object.entries(settings)) {
    if (!/colou?r/i.test(key)) continue;
    // `color_scheme` names a scheme; `color_schemes` is a list of them.
    if (/^colou?r_schemes?$/i.test(key)) continue;

    const color = ColorValue.from(value);
    if (color) resolved[key] = color;
  }

  return resolved;
}
