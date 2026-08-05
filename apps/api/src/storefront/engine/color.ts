/**
 * Storefront · engine/color.ts
 * Colour parsing and manipulation, with no Liquid in sight.
 *
 * Ten of the storefront filters are colour maths, and every one of them is the
 * same three steps: parse a CSS colour, do arithmetic in some space, format it
 * back. Doing that here rather than in the filters means the arithmetic can be
 * tested against known values directly, and it means `color_lighten` is four
 * lines instead of forty.
 *
 * The formulae are the standard ones — HSL for lighten/darken/saturate, WCAG
 * relative luminance for contrast, the w3c perceived-brightness weighting for
 * brightness. Named where used, because "why 0.2126" is a fair question.
 * Layer: engine (pure).
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0–1. Themes pass rgba() through these filters and expect it preserved. */
  readonly a: number;
}

export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
  readonly a: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const round = (value: number): number => Math.round(value);

/**
 * The CSS named colours a theme is likely to write.
 *
 * Not all 148: the full table is noise here, and a theme reaching for
 * `lightgoldenrodyellow` in a colour setting is not a case worth carrying. The
 * ones below are what appear in real theme defaults.
 */
const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  transparent: 'rgba(0,0,0,0)',
};

/**
 * Parses a CSS colour, or returns `null`.
 *
 * `null` rather than a thrown error or a default: the reference product's colour
 * filters return nothing for an unparseable input, and a theme that falls back to
 * its own default is better served by an empty string than by black.
 */
export function parseColor(input: unknown): Rgb | null {
  if (input === null || input === undefined) return null;

  // A colour setting can arrive as an object when it came from settings JSON.
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : String(input).trim().toLowerCase();
  if (raw === '') return null;

  const named = NAMED[raw];
  const text = named ?? raw;

  if (text.startsWith('#')) return parseHex(text);
  if (text.startsWith('rgb')) return parseRgbFunction(text);
  if (text.startsWith('hsl')) return parseHslFunction(text);
  return null;
}

function parseHex(text: string): Rgb | null {
  const hex = text.slice(1);
  const expand = (char: string): number => Number.parseInt(char + char, 16);

  if (hex.length === 3 || hex.length === 4) {
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    return {
      r: expand(hex[0] as string),
      g: expand(hex[1] as string),
      b: expand(hex[2] as string),
      a: hex.length === 4 ? expand(hex[3] as string) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const byte = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
    return {
      r: byte(0),
      g: byte(2),
      b: byte(4),
      a: hex.length === 8 ? byte(6) / 255 : 1,
    };
  }
  return null;
}

/** Splits `rgb(1, 2, 3)` and `rgb(1 2 3 / 50%)` alike. */
function functionParts(text: string): string[] | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close === -1) return null;
  return text
    .slice(open + 1, close)
    .split(/[,/\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** A channel written as `128` or as `50%`. */
function channel(part: string | undefined, scale: number): number {
  if (part === undefined) return 0;
  if (part.endsWith('%')) return (Number.parseFloat(part) / 100) * scale;
  return Number.parseFloat(part);
}

function parseRgbFunction(text: string): Rgb | null {
  const parts = functionParts(text);
  if (!parts || parts.length < 3) return null;
  const values = [channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255)];
  if (values.some((value) => !Number.isFinite(value))) return null;
  return {
    r: clamp(round(values[0] as number), 0, 255),
    g: clamp(round(values[1] as number), 0, 255),
    b: clamp(round(values[2] as number), 0, 255),
    a: parts.length > 3 ? clamp(channel(parts[3], 1), 0, 1) : 1,
  };
}

function parseHslFunction(text: string): Rgb | null {
  const parts = functionParts(text);
  if (!parts || parts.length < 3) return null;
  const h = Number.parseFloat(parts[0] as string);
  const s = Number.parseFloat(parts[1] as string) / 100;
  const l = Number.parseFloat(parts[2] as string) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return hslToRgb({
    h,
    s: clamp(s, 0, 1),
    l: clamp(l, 0, 1),
    a: parts.length > 3 ? clamp(channel(parts[3], 1), 0, 1) : 1,
  });
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l, a: rgb.a };

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let h: number;
  if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / delta + 2) / 6;
  else h = ((r - g) / delta + 4) / 6;

  return { h: h * 360, s, l, a: rgb.a };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360 / 360;
  const { s, l } = hsl;

  if (s === 0) {
    const value = round(l * 255);
    return { r: value, g: value, b: value, a: hsl.a };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const toChannel = (t: number): number => {
    let shifted = t;
    if (shifted < 0) shifted += 1;
    if (shifted > 1) shifted -= 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };

  return {
    r: round(toChannel(h + 1 / 3) * 255),
    g: round(toChannel(h) * 255),
    b: round(toChannel(h - 1 / 3) * 255),
    a: hsl.a,
  };
}

/**
 * Back to a string, choosing the notation by whether alpha is in play.
 *
 * A fully opaque colour comes back as hex because that is what themes write and
 * what merchants recognise in a settings panel; a translucent one has to be
 * `rgba()`, since `#rrggbbaa` is not understood everywhere a theme's CSS lands.
 */
export function formatColor(rgb: Rgb): string {
  if (rgb.a >= 1) {
    const hex = (value: number): string => clamp(round(value), 0, 255).toString(16).padStart(2, '0');
    return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`;
  }
  const alpha = Math.round(rgb.a * 100) / 100;
  return `rgba(${clamp(round(rgb.r), 0, 255)}, ${clamp(round(rgb.g), 0, 255)}, ${clamp(round(rgb.b), 0, 255)}, ${alpha})`;
}

/** Shifts lightness by whole percentage points, the way `color_lighten` does. */
export function lighten(rgb: Rgb, amount: number): Rgb {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, l: clamp(hsl.l + amount / 100, 0, 1) });
}

export function saturate(rgb: Rgb, amount: number): Rgb {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({ ...hsl, s: clamp(hsl.s + amount / 100, 0, 1) });
}

/**
 * Weighted mix, where `weight` is how much of the FIRST colour to keep.
 *
 * The direction is worth stating because it is the opposite of what the
 * argument order suggests: `a | color_mix: b, 25` is a quarter of `a`.
 */
export function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  const w = clamp(weight, 0, 100) / 100;
  const blend = (from: number, to: number): number => round(to + (from - to) * w);
  return {
    r: blend(a.r, b.r),
    g: blend(a.g, b.g),
    b: blend(a.b, b.b),
    a: a.a * w + b.a * (1 - w),
  };
}

/**
 * Perceived brightness on 0–255.
 *
 * The w3c weighting rather than a plain average, because green looks far
 * brighter than blue at the same value — a theme deciding whether to put white
 * or black text on a background needs the perceptual number, not the arithmetic
 * one.
 */
export function brightness(rgb: Rgb): number {
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
}

/** WCAG relative luminance, which is a different question from brightness. */
function luminance(rgb: Rgb): number {
  const channelLuminance = (value: number): number => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** The WCAG contrast ratio, 1–21. A theme uses it to pick a legible foreground. */
export function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Sum of per-channel distance, 0–765. The other legibility heuristic. */
export function difference(a: Rgb, b: Rgb): number {
  return (
    Math.max(a.r, b.r) - Math.min(a.r, b.r) +
    (Math.max(a.g, b.g) - Math.min(a.g, b.g)) +
    (Math.max(a.b, b.b) - Math.min(a.b, b.b))
  );
}
