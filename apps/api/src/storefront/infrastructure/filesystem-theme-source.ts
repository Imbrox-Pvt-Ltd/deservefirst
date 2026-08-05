/**
 * Storefront · infrastructure/filesystem-theme-source.ts
 * A theme read from a directory on disk.
 *
 * This is the development and conformance implementation — it is how
 * `theme/broadcast` gets rendered in a test. Production themes live in object
 * storage and get their own implementation of the same interface; the renderer
 * does not change.
 *
 * Every path goes through `confinePath` first and is then resolved against the
 * root with `path.resolve`, and the result is checked to still be inside it.
 * Two checks rather than one because they fail differently: the first refuses
 * paths that do not look like theme paths, the second catches anything the
 * platform's own path handling would resolve elsewhere — a symlink in the theme
 * directory being the obvious one.
 * Layer: infrastructure.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import {
  confinePath,
  THEME_DIRECTORIES,
  ThemePathError,
  type ThemeSource,
} from '../domain/theme-source';

export class FilesystemThemeSource implements ThemeSource {
  private readonly root: string;
  /** Resolved once; a theme's files do not move under it while it renders. */
  private realRoot: string | null = null;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * The absolute path for a theme-relative one, or null if it escapes.
   *
   * `realpath` is what closes the symlink case: `snippets/card.liquid` can be a
   * legitimate-looking name pointing at `/etc/passwd`, and a check on the
   * unresolved path would pass it.
   */
  private async locate(path: string): Promise<string | null> {
    let confined: string;
    try {
      confined = confinePath(path);
    } catch (error) {
      if (error instanceof ThemePathError) return null;
      throw error;
    }

    const candidate = resolve(this.root, confined);
    if (!candidate.startsWith(this.root + sep)) return null;

    try {
      this.realRoot ??= await realpath(this.root);
      const real = await realpath(candidate);
      // Outside the theme after following links — refuse, whatever it is.
      if (real !== this.realRoot && !real.startsWith(this.realRoot + sep)) return null;
      return real;
    } catch {
      // Does not exist. Not an error here: callers ask about absent files.
      return null;
    }
  }

  async read(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path);
    return bytes === null ? null : bytes.toString('utf8');
  }

  /**
   * The bytes, which is what everything else here is built on.
   *
   * `read` decodes these rather than reading the file twice, so a template and
   * an asset cannot disagree about what is on disk.
   */
  async readBytes(path: string): Promise<Buffer | null> {
    const located = await this.locate(path);
    if (!located) return null;
    try {
      const info = await stat(located);
      // A directory read would otherwise throw EISDIR from inside a render.
      if (!info.isFile()) return null;
      return await readFile(located);
    } catch {
      return null;
    }
  }

  async exists(path: string): Promise<boolean> {
    const located = await this.locate(path);
    if (!located) return false;
    try {
      return (await stat(located)).isFile();
    } catch {
      return false;
    }
  }

  async list(directory: string): Promise<readonly string[]> {
    if (!(THEME_DIRECTORIES as readonly string[]).includes(directory)) return [];

    try {
      const entries = await readdir(join(this.root, directory), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        // Names that would not survive `confinePath` are not offered, so
        // listing and reading agree about what exists.
        .filter((entry) => /^[A-Za-z0-9][\w.-]*$/.test(entry.name) && !entry.name.includes('..'))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Every theme-relative path this theme holds, for template resolution. */
  async manifest(): Promise<ReadonlySet<string>> {
    const paths = new Set<string>();
    for (const directory of THEME_DIRECTORIES) {
      for (const name of await this.list(directory)) {
        paths.add(`${directory}/${name}`);
      }
    }
    return paths;
  }
}

/**
 * A theme held in memory, for tests and for the editor's unsaved preview.
 *
 * Deliberately the same confinement: a test that could read a path the real
 * source refuses would prove the renderer works on inputs production rejects.
 */
export class InMemoryThemeSource implements ThemeSource {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  private confine(path: string): string | null {
    try {
      return confinePath(path);
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<string | null> {
    const confined = this.confine(path);
    return confined ? (this.files[confined] ?? null) : null;
  }

  /**
   * The same files as bytes.
   *
   * This source holds strings, so there is nothing binary to preserve — but
   * without it the editor's preview serves no assets at all, because the
   * transport asks for bytes and a source that cannot answer serves nothing.
   * A preview with no stylesheet is a preview that lies about the page.
   */
  async readBytes(path: string): Promise<Buffer | null> {
    const contents = await this.read(path);
    return contents === null ? null : Buffer.from(contents, 'utf8');
  }

  async exists(path: string): Promise<boolean> {
    const confined = this.confine(path);
    return confined ? confined in this.files : false;
  }

  async list(directory: string): Promise<readonly string[]> {
    return Object.keys(this.files)
      .filter((path) => path.startsWith(`${directory}/`))
      .map((path) => path.slice(directory.length + 1))
      .sort();
  }

  async manifest(): Promise<ReadonlySet<string>> {
    return new Set(Object.keys(this.files));
  }
}
