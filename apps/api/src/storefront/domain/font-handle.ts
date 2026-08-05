/**
 * Storefront · domain/font-handle.ts
 * The font a merchant picked, from the string their settings hold.
 *
 * A font setting stores a HANDLE — `dm_sans_n4`, `bricolage_grotesque_n7`,
 * `helvetica_n4` — and a theme uses it as an OBJECT: `settings.type_base_font.family`,
 * `| font_modify: 'weight', 'bold'`, `.system?`. The engine's font filters
 * already expect that object; nothing turned the string into one, so every font
 * property read as nothing and the reference theme rendered
 * `font-family: , ;` — a declaration browsers discard, leaving the whole site
 * in the default serif.
 *
 * The handle's shape is `family_words_<style><weight>`: `n` for normal and `i`
 * for italic, then the weight's hundreds digit. `dm_sans_n4` is DM Sans,
 * normal, 400. That trailing group is the only part with a fixed meaning, which
 * is what makes the rest recoverable as a family name.
 *
 * What this does NOT do is host the font. There are no font files to serve, so
 * `font_face` has nothing to emit and the browser uses the fallback stack —
 * which is why the fallback matters and is chosen per family rather than being
 * `sans-serif` for everything. A page in Helvetica because we could not host DM
 * Sans is a page; a page in `font-family: , ;` is a bug.
 * Layer: domain (pure).
 */

export interface FontValue {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  readonly fallback_families: string;
  /** True when the family is one every device already has. */
  readonly system: boolean;
  readonly variants?: readonly { weight: number; style: string }[];
}

/**
 * Families a browser already has, so no download is needed or possible.
 *
 * Themes branch on `system?` to skip emitting an `@font-face` — and since we
 * host nothing, being honest about which are genuinely system fonts is what
 * stops a theme waiting on a stylesheet that will never arrive.
 */
const SYSTEM_FAMILIES = new Set([
  'arial', 'helvetica', 'helvetica neue', 'times', 'times new roman', 'georgia',
  'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'garamond',
  'palatino', 'bookman', 'comic sans ms', 'impact', 'lucida sans unicode',
  'system-ui', '-apple-system',
]);

/** Serif families, whose fallback should not be a sans stack. */
const SERIF_HINTS = ['serif', 'georgia', 'times', 'garamond', 'playfair', 'merriweather', 'lora', 'bookman', 'palatino', 'baskerville', 'crimson', 'spectral'];
const MONO_HINTS = ['mono', 'courier', 'consolas', 'menlo'];

/**
 * Turns a font handle into the object a theme reads.
 *
 * Returns null for anything that is not a handle, so a theme setting holding a
 * plain family name — which some do — is not mangled into a font with a weight
 * nobody asked for. The caller passes those through unchanged.
 */
export function fontFromHandle(handle: unknown): FontValue | null {
  if (typeof handle !== 'string') return null;

  const raw = handle.trim();
  if (raw === '') return null;

  /**
   * The trailing `_n4` / `_i7` is what makes this a handle rather than a name.
   *
   * Without it there is nothing to distinguish `dm_sans` the handle from
   * "DM Sans" the family a merchant typed, and guessing would rewrite one of
   * them wrongly.
   */
  const match = /^(.+?)_([ni])([1-9])$/.exec(raw);
  if (!match) return null;

  const family = titleCase((match[1] as string).replace(/_/g, ' '));
  const style = match[2] === 'i' ? 'italic' : 'normal';
  const weight = Number(match[3]) * 100;

  return {
    family,
    weight,
    style,
    fallback_families: fallbackFor(family),
    system: SYSTEM_FAMILIES.has(family.toLowerCase()),
  };
}

/**
 * A fallback stack matching the family's character.
 *
 * `sans-serif` for everything would put a serif heading font into Arial, which
 * is a more visible wrong than the missing font itself — a page's typography
 * reads as broken rather than as plain.
 */
function fallbackFor(family: string): string {
  const name = family.toLowerCase();
  if (MONO_HINTS.some((hint) => name.includes(hint))) return 'monospace';
  if (SERIF_HINTS.some((hint) => name.includes(hint))) return 'serif';
  return 'sans-serif';
}

/**
 * `dm sans` becomes `DM Sans`, not `Dm Sans`.
 *
 * Short all-consonant words are acronyms in font names far more often than they
 * are words — DM, PT, IBM — and `Dm Sans` in a heading is the kind of detail
 * that makes a platform look careless.
 */
function titleCase(value: string): string {
  return value
    .split(' ')
    .filter((word) => word !== '')
    .map((word) =>
      word.length <= 3 && !/[aeiou]/.test(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * Replaces font handles in a settings object with font values.
 *
 * By key name rather than by sniffing every string: a setting called
 * `type_base_font` is a font, and a colour or a heading that happens to end in
 * `_n4` is not. Matching the value's shape alone would eventually rewrite
 * somebody's product code into a typeface.
 */
export function resolveFontSettings(
  settings: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...settings };

  for (const [key, value] of Object.entries(settings)) {
    if (!/font/i.test(key)) continue;
    const font = fontFromHandle(value);
    if (font) resolved[key] = font;
  }

  return resolved;
}
