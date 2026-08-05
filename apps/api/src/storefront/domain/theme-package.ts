/**
 * Storefront · domain/theme-package.ts
 * Whether a pile of unpacked files is a theme.
 *
 * The door the platform has been missing. `theme:check` and `theme:port` could
 * examine a directory a developer already had, and a theme reached a store by
 * somebody putting files on a disk and writing a row by hand — so "install any
 * theme" was true of the engine and of nothing else.
 *
 * This decides three things, and keeping them apart matters because they fail
 * differently:
 *
 *   · **Shape.** Where the files sit. An archive with everything under
 *     `broadcast-4.2.0/` is the normal case, not an error — every archiver
 *     produces one and every download from a theme store has one.
 *   · **Admission.** What may be written at all. A theme is untrusted
 *     third-party code, and the only defence against a file that does not
 *     belong in a theme is refusing to store it.
 *   · **Completeness.** Whether it can render. A theme with no layout is not a
 *     broken theme, it is not a theme.
 *
 * Everything here is pure: files in, a verdict out. Unpacking is core's job and
 * writing is infrastructure's.
 * Layer: domain (pure).
 */

import { isThemePath } from './theme-source';

export interface PackagedFile {
  readonly path: string;
  readonly contents: string;
}

export interface PackageProblem {
  readonly path: string | null;
  readonly reason: string;
  /** What the person holding this archive should do about it. */
  readonly suggestion: string;
}

export interface PackageResult {
  readonly ok: boolean;
  readonly files: readonly PackagedFile[];
  readonly problems: readonly PackageProblem[];
  /** The folder stripped from the front, when the archive had one. */
  readonly strippedRoot: string | null;
}

/**
 * The directories a theme's files may live in.
 *
 * An allow-list rather than a deny-list, because the question is not "which
 * files are dangerous" — it is "which files does the renderer read". Anything
 * else is at best dead weight in a merchant's storage and at worst somebody
 * using a theme upload as file hosting on the store's own domain.
 */
const THEME_DIRECTORIES = new Set([
  'assets',
  'config',
  'layout',
  'locales',
  'sections',
  'snippets',
  'templates',
  'blocks',
]);

/** A theme cannot render without these. */
const REQUIRED = ['layout/theme.liquid'];

/**
 * Extensions a theme may contain.
 *
 * `.liquid`, `.json` and the web's own asset types. Notably absent: anything
 * executable on the server. A theme is rendered, not run — a `.php` or `.sh` in
 * a theme archive has no purpose that is not somebody testing whether we will
 * store it.
 */
const ALLOWED_EXTENSIONS = new Set([
  '.liquid', '.json', '.js', '.mjs', '.css', '.scss',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.md', '.txt', '.map',
]);

/**
 * Strips a single wrapping folder, if every file shares one.
 *
 * A theme downloaded from anywhere is `theme-name/layout/theme.liquid`, and
 * refusing that would mean telling every developer to re-zip their theme before
 * it would install. Only ONE level, and only when it is unanimous: an archive
 * whose files are already at the root is left alone, and one containing two
 * themes side by side is not silently reduced to one of them.
 */
export function stripCommonRoot(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;

  const first = paths[0]!.split('/');
  if (first.length < 2) return null;

  const candidate = first[0]!;
  // A folder that is itself a theme directory is the theme, not a wrapper.
  if (THEME_DIRECTORIES.has(candidate)) return null;

  return paths.every((path) => path.startsWith(`${candidate}/`)) ? candidate : null;
}

/**
 * Decides whether these files are an installable theme.
 *
 * Collects every problem rather than stopping at the first. Somebody packaging
 * a theme wants the list, not a conversation where each fix reveals the next
 * complaint.
 */
export function readThemePackage(
  entries: readonly PackagedFile[],
): PackageResult {
  const problems: PackageProblem[] = [];

  const root = stripCommonRoot(entries.map((entry) => entry.path));
  const rebased = entries.map((entry) => ({
    path: root ? entry.path.slice(root.length + 1) : entry.path,
    contents: entry.contents,
  }));

  const files: PackagedFile[] = [];

  for (const file of rebased) {
    /**
     * Files an archiver leaves behind, dropped without comment.
     *
     * `__MACOSX/`, `.DS_Store` and `Thumbs.db` are in a large share of real
     * archives. Reporting them as problems would make a correct theme look
     * broken, and the person who zipped it cannot easily stop them appearing.
     */
    if (isArchiveDebris(file.path)) continue;

    if (!isThemePath(file.path)) {
      // Belt and braces: `readZip` already refused traversal, and the theme
      // source refuses it again on every read. This is the third lock, and the
      // cheapest place to fail.
      problems.push({
        path: file.path,
        reason: 'This path is not one a theme may contain.',
        suggestion: 'Remove it from the archive.',
      });
      continue;
    }

    const directory = file.path.split('/')[0] ?? '';
    if (!THEME_DIRECTORIES.has(directory)) {
      problems.push({
        path: file.path,
        reason: `"${directory}" is not a theme directory.`,
        suggestion: `Theme files live in ${[...THEME_DIRECTORIES].sort().join(', ')}.`,
      });
      continue;
    }

    const extension = extensionOf(file.path);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      problems.push({
        path: file.path,
        reason: `"${extension || 'no extension'}" is not a file type a theme may contain.`,
        // Named rather than vague: a developer with a stray file wants to know
        // it is the file, not the theme.
        suggestion: 'Remove it, or serve it from somewhere other than the theme.',
      });
      continue;
    }

    files.push(file);
  }

  const present = new Set(files.map((file) => file.path));
  for (const required of REQUIRED) {
    if (!present.has(required)) {
      problems.push({
        path: required,
        reason: 'A theme cannot render without this file.',
        suggestion:
          root === null
            ? 'Check the archive contains the theme’s folders at its top level.'
            : `Check ${root}/${required} exists in the archive.`,
      });
    }
  }

  if (files.length === 0) {
    problems.push({
      path: null,
      reason: 'This archive contains no theme files at all.',
      suggestion: 'Zip the theme’s own folders — layout, sections, templates and the rest.',
    });
  }

  return { ok: problems.length === 0, files, problems, strippedRoot: root };
}

/** Files an archiver adds that are nobody's fault. */
function isArchiveDebris(path: string): boolean {
  const segments = path.split('/');
  return (
    segments.some((segment) => segment === '__MACOSX' || segment === '.git') ||
    ['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(segments[segments.length - 1] ?? '')
  );
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const at = name.lastIndexOf('.');
  return at <= 0 ? '' : name.slice(at).toLowerCase();
}

/**
 * A theme's name, for the row.
 *
 * From the archive's own wrapping folder when it has one, because that is what
 * the theme's author called it. Falls back to a name the merchant can change
 * rather than to something derived from a filename they never see.
 */
export function themeNameFrom(root: string | null, fallback = 'Uploaded theme'): string {
  if (!root) return fallback;

  return (
    root
      // `broadcast-4.2.0` reads better as `Broadcast 4.2.0`.
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/^\w/, (character) => character.toUpperCase()) || fallback
  );
}
