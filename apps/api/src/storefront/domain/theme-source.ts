/**
 * Storefront · domain/theme-source.ts
 * Where a theme's files come from, and the one path rule that matters.
 *
 * An interface rather than a filesystem, because a theme lives in different
 * places at different times: on disk while a developer works, in object storage
 * once uploaded, and in a preview buffer while the editor has unsaved changes.
 * The renderer should not know which.
 *
 * `confinePath` is the security half. A theme is untrusted code that names its
 * own files — `{% render 'card' %}` and `{{ 'theme.css' | asset_url }}` — so
 * every one of those names is attacker-controlled input to a file read. The
 * rule is enforced here, once, rather than in each of the four places that
 * resolve a theme path.
 * Layer: domain (pure).
 */

/** The directories a theme is allowed to have. Anything else is not a theme file. */
export const THEME_DIRECTORIES = [
  'assets',
  'blocks',
  'config',
  'layout',
  'locales',
  'sections',
  'snippets',
  'templates',
] as const;

export class ThemePathError extends Error {
  constructor(
    readonly attempted: string,
    detail: string,
  ) {
    super(`"${attempted}": ${detail}`);
    this.name = 'ThemePathError';
  }
}

/**
 * Normalises a theme-relative path, or refuses it.
 *
 * Refuses rather than sanitises. Stripping `../` from `....//` leaves `../`,
 * which is why quietly cleaning a path is a worse answer than rejecting one —
 * the sanitiser has to be right about every encoding, and the rejection only
 * has to be right about what a legitimate path looks like.
 *
 * A legitimate one is `<known directory>/<name>` with an optional extension,
 * where the name is word characters, dots, and hyphens. `templates/product.json`
 * and `sections/main-product.liquid` pass; nothing with a slash in the name
 * does, because a theme has no nested directories.
 */
export function confinePath(path: string): string {
  const raw = String(path ?? '').trim();

  if (raw === '') throw new ThemePathError(raw, 'a theme path cannot be empty');

  // Decoded first: a loader that reads `%2e%2e%2f` after the check would be
  // checking a different string from the one it opens.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new ThemePathError(raw, 'is not a decodable path');
  }

  if (decoded.includes('\0')) throw new ThemePathError(raw, 'contains a null byte');
  if (decoded.includes('\\')) throw new ThemePathError(raw, 'contains a backslash');
  if (decoded.startsWith('/')) throw new ThemePathError(raw, 'must be relative to the theme');

  const segments = decoded.split('/');
  if (segments.length !== 2) {
    throw new ThemePathError(
      raw,
      `must be "<directory>/<name>" — a theme has no nested directories (${THEME_DIRECTORIES.join(', ')})`,
    );
  }

  const [directory, name] = segments as [string, string];

  if (!(THEME_DIRECTORIES as readonly string[]).includes(directory)) {
    throw new ThemePathError(raw, `"${directory}" is not a theme directory`);
  }

  /**
   * No dot segments, and nothing but the characters a theme file name uses.
   *
   * A leading underscore is allowed, and that was found the hard way: the
   * reference theme ships `blocks/_slide-image.liquid` and three like it —
   * the convention for a block that is only rendered by another block rather
   * than offered in the editor. Requiring an alphanumeric first character
   * refused four files of a theme the platform otherwise renders, which is the
   * sort of incompatibility that reads as "this platform is broken".
   *
   * A leading DOT stays refused, which is the rule that was actually wanted:
   * `.env` and `.git/config` are not theme files, and `..` is caught below
   * regardless.
   */
  /**
   * `@` is allowed too, for `logo@2x.png`.
   *
   * The retina-asset convention, and common enough in real themes that
   * refusing it drops an image with no error rather than reporting a problem.
   * It is not a path character and cannot separate segments, so it widens the
   * name alphabet without widening what a name can reach.
   */
  if (!/^[A-Za-z0-9_][\w.@-]*$/.test(name) || name.includes('..')) {
    throw new ThemePathError(raw, `"${name}" is not a usable file name`);
  }

  return `${directory}/${name}`;
}

/** Whether a path is confinable, for callers that want a boolean. */
export function isThemePath(path: string): boolean {
  try {
    confinePath(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A theme's files.
 *
 * Every method takes a theme-relative path and is expected to call
 * `confinePath` — the implementations here do, and an implementation that did
 * not would be the hole. `read` returns `null` for a file that is absent rather
 * than throwing, because "does this theme have a custom template" is an ordinary
 * question the renderer asks constantly.
 */
export interface ThemeSource {
  read(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  /** File names within one theme directory, without the directory prefix. */
  list(directory: string): Promise<readonly string[]>;
}
