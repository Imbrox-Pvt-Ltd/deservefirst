/**
 * Storefront · application/theme-install.ts
 * Installing a theme from an archive.
 *
 * The order here is the whole design, and every step is before the next one for
 * a reason:
 *
 *   1. **unpack** — bounded and path-checked, in `core/archive`
 *   2. **shape** — is this a theme at all, in `domain/theme-package`
 *   3. **check** — will it run here, using the same rules `theme:check` reports
 *   4. **store** — content-addressed, immutable, exactly as a publish does
 *   5. **record** — a row, always UNPUBLISHED
 *
 * Nothing is written until steps 1–3 have passed on the whole archive. An
 * installer that wrote as it unpacked would leave half a theme in storage when
 * the twentieth file turned out to be unacceptable, and the merchant would be
 * looking at a theme that cannot render with no way to tell why.
 *
 * The last step is the one that matters most: an installed theme is never live.
 * Uploading is not publishing. A merchant installing a theme to look at it must
 * not discover they have replaced the storefront their customers are on.
 * Layer: application.
 */

import { readZip, ZipError, type ZipLimits } from '../../core/archive';
import {
  findForeignNames,
  formatFindings,
  hasBlockingFinding,
  lintTemplate,
  readThemePackage,
  themeNameFrom,
  versionRefFor,
  type CompatMap,
  type PackagedFile,
  type PackageProblem,
  type TemplateFinding,
} from '../domain';
import type { ThemeVersionStore } from './publish-service';

export interface InstalledTheme {
  readonly themeId: string;
  readonly name: string;
  readonly versionRef: string;
  readonly fileCount: number;
  /** Advisory findings. An install can succeed with these. */
  readonly warnings: readonly TemplateFinding[];
}

export class ThemeInstallError extends Error {
  constructor(
    readonly code: 'unreadable' | 'not-a-theme' | 'will-not-run',
    message: string,
    /** Everything wrong, so one upload produces one list rather than a queue. */
    readonly problems: readonly PackageProblem[] = [],
  ) {
    super(message);
    this.name = 'ThemeInstallError';
  }
}

export interface ThemeInstallRepository {
  /** Records the installed theme. Always unpublished — see below. */
  create(input: {
    readonly id: string;
    readonly name: string;
    readonly versionRef: string;
  }): Promise<void>;
}

export class ThemeInstallService {
  constructor(
    private readonly versions: ThemeVersionStore,
    private readonly themes: ThemeInstallRepository,
    private readonly compat: CompatMap,
    private readonly newId: () => string,
    private readonly limits?: ZipLimits,
  ) {}

  async install(archive: Buffer, name?: string): Promise<InstalledTheme> {
    const { files, strippedRoot } = this.shape(this.unpack(archive));
    const warnings = this.check(files);

    /**
     * The reference is the content, so installing the same archive twice
     * produces the same version.
     *
     * The same function a publish uses, deliberately: an install and a publish
     * of identical files must not produce two references to one theme, or a
     * rollback would land on whichever happened to be written second.
     */
    const versionRef = versionRefFor(files);
    const themeId = this.newId();

    await this.versions.write(themeId, versionRef, files);

    /**
     * Recorded last, and never as the live theme.
     *
     * Written after the files, so a failed write leaves no row pointing at a
     * version that does not exist. And unpublished, because uploading is not
     * publishing — a merchant installing a theme to look at it must not find
     * they have replaced the storefront their customers are on.
     */
    const themeName = name?.trim() || themeNameFrom(strippedRoot);
    await this.themes.create({ id: themeId, name: themeName, versionRef });

    return { themeId, name: themeName, versionRef, fileCount: files.length, warnings };
  }

  private unpack(archive: Buffer): readonly PackagedFile[] {
    let raw;
    try {
      raw = readZip(archive, this.limits);
    } catch (error) {
      if (error instanceof ZipError) {
        // The reader's message already says which file and why; repeating it
        // in our own words would only make it vaguer.
        throw new ThemeInstallError('unreadable', error.message);
      }
      throw error;
    }

    /**
     * Text is decoded; everything else keeps its bytes.
     *
     * The first version decoded EVERY entry as UTF-8, and that is not a
     * rounding error — invalid byte sequences all map to the same replacement
     * character, so an 88-byte PNG came back as 118 bytes of U+FFFD. The
     * reference theme's three images were installed corrupt and the live
     * storefront served them, which is how this was found: by comparing the
     * stored file against the original rather than by anything failing.
     *
     * Decided by extension rather than by sniffing the contents. A theme's file
     * types are a closed set we already enforce, and guessing from the bytes
     * would mean a `.liquid` file that happens to start with unusual characters
     * is stored as binary and never renders.
     */
    return raw.map((entry) => ({
      path: entry.path,
      contents: isTextFile(entry.path) ? entry.contents.toString('utf8') : entry.contents,
    }));
  }

  /**
   * Returns the stripped root alongside the files, because the theme's name
   * comes from it — the archive's own folder is what its author called it.
   */
  private shape(
    entries: readonly PackagedFile[],
  ): { files: readonly PackagedFile[]; strippedRoot: string | null } {
    const result = readThemePackage(entries);

    if (!result.ok) {
      throw new ThemeInstallError(
        'not-a-theme',
        `This archive is not a theme this platform can install (${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}).`,
        result.problems,
      );
    }

    return { files: result.files, strippedRoot: result.strippedRoot };
  }

  /**
   * The same checks `theme:check` reports, run before anything is stored.
   *
   * A theme using another platform's names is refused rather than warned about.
   * Those names do not resolve here, so a theme installed with them renders
   * pages with missing assets and no error at all — the worst kind of failure,
   * because it looks like a working install. `theme:port` is where that is
   * fixed; at install time the honest answer is that this archive will not run
   * as it stands.
   *
   * Lint findings are different. `severity: 'error'` blocks; the rest are
   * advisory and travel back with the install, because refusing a merchant's
   * theme over a heuristic is worse than the mistake.
   */
  private check(files: readonly PackagedFile[]): readonly TemplateFinding[] {
    /**
      * Only `.liquid` files, and their contents are known text.
      *
      * `isTextFile` decoded them, so the cast states what the filter already
      * guarantees rather than hoping. A Buffer reaching a linter would be
      * stringified as "[object Object]" and match nothing — a check that
      * silently passes everything.
      */
    const liquid = files
      .filter((file) => file.path.endsWith('.liquid'))
      .map((file) => ({ path: file.path, contents: String(file.contents) }));

    const foreign = liquid.flatMap((file) =>
      findForeignNames(file.path, file.contents, this.compat).map((found) => ({
        path: `${found.file}:${found.line}`,
        reason: `Uses the ${found.kind} "${found.found}", which does not exist on this platform.`,
        suggestion: found.replacement
          ? `Replace it with "${found.replacement}", or run theme:port to rewrite the whole theme.`
          : 'There is no equivalent here yet; remove the usage or the section that needs it.',
      })),
    );

    if (foreign.length > 0) {
      throw new ThemeInstallError(
        'will-not-run',
        `This theme uses ${foreign.length} name${foreign.length === 1 ? '' : 's'} from another platform, ` +
          'so parts of it would render empty with no error. Run theme:port to rewrite them.',
        foreign,
      );
    }

    const findings = liquid.flatMap((file) => lintTemplate(file.path, file.contents));

    if (hasBlockingFinding(findings)) {
      const blocking = findings.filter((finding) => finding.severity === 'error');
      throw new ThemeInstallError(
        'will-not-run',
        `This theme has ${blocking.length} error${blocking.length === 1 ? '' : 's'} that would ` +
          `render the wrong page rather than fail:\n\n${formatFindings(blocking)}`,
        blocking.map((finding) => ({
          path: `${finding.file}:${finding.line}`,
          reason: finding.message,
          suggestion: finding.suggestion,
        })),
      );
    }

    return findings;
  }
}

/**
 * Whether a theme file is text.
 *
 * The renderer reads templates as strings and serves everything else as bytes,
 * so this is the line between the two. Anything not named here is treated as
 * binary, which is the safe default: storing text as bytes round-trips
 * perfectly, and storing bytes as text does not.
 */
function isTextFile(path: string): boolean {
  return /\.(liquid|json|js|mjs|css|scss|md|txt|map|svg)$/i.test(path);
}
