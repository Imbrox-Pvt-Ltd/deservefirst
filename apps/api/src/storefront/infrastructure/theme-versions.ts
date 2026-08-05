/**
 * Storefront · infrastructure/theme-versions.ts
 * Immutable theme versions, and the pointer that decides which one is live.
 *
 * Two halves of the publish model. The files go to a version store keyed by a
 * content hash and are never modified; the row that says which version a theme
 * serves is what publishing moves.
 *
 * `applyRoleChange` is deliberately ONE statement rather than a transaction.
 * A single UPDATE is atomic on its own, so there is no window where a store has
 * two live themes or none — and the executor has no transaction API to reach
 * for, which would otherwise have been the first thing added here. A `CASE`
 * expression does the demote and the promote together.
 * Layer: infrastructure.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { Binder, writerFor } from '../../core/database/bind';
import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import type { ThemeRepository, ThemeVersionStore } from '../application';
import type { RoleChange, ThemeRecord, ThemeSource } from '../domain';
import { confinePath } from '../domain';
import { FilesystemThemeSource } from './filesystem-theme-source';

/**
 * Versions written to disk, one directory per reference.
 *
 * The development and single-node path. Object storage is the production one
 * and uses the same layout as keys, which is why the reference is part of the
 * path rather than a column that maps to one.
 */
export class FilesystemThemeVersionStore implements ThemeVersionStore {
  constructor(private readonly root: string) {}

  private directory(themeId: string, versionRef: string): string {
    /**
     * Both parts are constrained before they become a path.
     *
     * A theme id comes from the database and a reference from a content hash,
     * so neither is attacker-controlled today — and both end up in a filesystem
     * path, which is exactly the sort of thing that stops being true quietly.
     */
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(themeId)) throw new Error(`Unusable theme id "${themeId}"`);
    if (!/^v_[0-9a-f]{16}$/.test(versionRef)) throw new Error(`Unusable version "${versionRef}"`);
    return join(this.root, themeId, versionRef);
  }

  async write(
    themeId: string,
    versionRef: string,
    files: readonly { path: string; contents: string }[],
  ): Promise<void> {
    const base = this.directory(themeId, versionRef);

    for (const file of files) {
      // The same confinement the renderer uses, so a version cannot hold a file
      // the renderer would later refuse to read.
      const confined = confinePath(file.path);
      const target = resolve(base, confined);
      if (!target.startsWith(resolve(base) + sep)) {
        throw new Error(`"${file.path}" would be written outside its version`);
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.contents, 'utf8');
    }
  }

  async has(themeId: string, versionRef: string): Promise<boolean> {
    try {
      const entries = await readdir(this.directory(themeId, versionRef));
      return entries.length > 0;
    } catch {
      return false;
    }
  }

  sourceFor(
    themeId: string,
    versionRef: string,
  ): ThemeSource & { manifest(): Promise<ReadonlySet<string>> } {
    return new FilesystemThemeSource(this.directory(themeId, versionRef));
  }

  /** Reads one file back, for tests and for a diff view. */
  async read(themeId: string, versionRef: string, path: string): Promise<string | null> {
    try {
      return await readFile(join(this.directory(themeId, versionRef), confinePath(path)), 'utf8');
    } catch {
      return null;
    }
  }
}

interface Row extends Record<string, unknown> {}

export class SqlThemeRepository implements ThemeRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
    private readonly newId: () => string = () => `tv_${Date.now()}`,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private storeId(): string {
    return requireStoreContext('storefront.themes').storeId;
  }

  private toRecord(row: Row): ThemeRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      role: String(row.role) as ThemeRecord['role'],
      versionRef: String(row.source_ref),
    };
  }

  /**
   * Records an installed theme, always unpublished.
   *
   * The role is written here rather than taken as an argument, so there is no
   * call site that could install a theme straight into `main`. Publishing has
   * its own path, with its own preflight.
   *
   * `source_kind` describes where the VERSION STORE keeps files, which is the
   * filesystem today — not where they came from. Writing `object_store` because
   * an archive was uploaded made the resolver refuse the theme outright: it
   * gates on this column, object storage is not implemented, and a store whose
   * theme lives there resolves to nothing. The install succeeded, the promotion
   * succeeded, and the storefront went dark.
   */
  async create(input: { id: string; name: string; versionRef: string }): Promise<void> {
    const bind = new Binder(this.dialect);
    const now = new Date();

    const sql = `INSERT INTO ${this.q('themes')} (
        ${this.q('id')}, ${this.q('store_id')}, ${this.q('name')}, ${this.q('role')},
        ${this.q('source_kind')}, ${this.q('source_ref')},
        ${this.q('created_at')}, ${this.q('updated_at')}, ${this.q('version')}
      ) VALUES (${bind.add(input.id)}, ${bind.add(this.storeId())}, ${bind.add(input.name)},
        ${bind.add('unpublished')}, ${bind.add('filesystem')}, ${bind.add(input.versionRef)},
        ${bind.add(now)}, ${bind.add(now)}, 1)`;

    const statement = bind.finish(sql);
    await writerFor(this.executor, 'installing a theme').execute(statement.sql, statement.parameters);
  }

  async byId(themeId: string): Promise<ThemeRecord | null> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('name')}, ${this.q('role')}, ${this.q('source_ref')}
         FROM ${this.q('themes')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), themeId],
    );
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async mainTheme(): Promise<ThemeRecord | null> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('name')}, ${this.q('role')}, ${this.q('source_ref')}
         FROM ${this.q('themes')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('role')} = 'main'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId()],
    );
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  /**
   * Promotes one theme and demotes the previous live one, in a single statement.
   *
   * The `CASE` is what makes it atomic without a transaction: MySQL applies one
   * UPDATE wholly or not at all, so there is never a moment where a store has
   * two live themes or none. Doing it as two statements would leave that window
   * open on every publish, and it is the window a customer would land in.
   */
  async applyRoleChange(change: RoleChange): Promise<void> {
    const storeId = this.storeId();
    const writable = writerFor(this.executor, 'a publish');

    const targets = [change.promote.themeId, ...(change.demote ? [change.demote.themeId] : [])];
    const now = new Date();

    /**
     * Built through a `Binder`, so the parameters cannot fall out of order.
     *
     * The first version reused `p(1)` for the three `id = ?` comparisons, which
     * is correct on Postgres and wrong on MySQL — there every `?` consumes the
     * NEXT value, so a timestamp landed in `source_ref`. The counts matched, so
     * nothing complained. See `core/database/bind.ts`.
     */
    const bind = new Binder(this.dialect);
    const sql =
      `UPDATE ${this.q('themes')}
          SET ${this.q('role')} = CASE WHEN ${this.q('id')} = ${bind.add(change.promote.themeId)} THEN 'main' ELSE 'unpublished' END,
              ${this.q('source_ref')} = CASE WHEN ${this.q('id')} = ${bind.add(change.promote.themeId)} THEN ${bind.add(change.promote.versionRef)} ELSE ${this.q('source_ref')} END,
              ${this.q('published_at')} = CASE WHEN ${this.q('id')} = ${bind.add(change.promote.themeId)} THEN ${bind.add(now)} ELSE ${this.q('published_at')} END,
              ${this.q('updated_at')} = ${bind.add(now)},
              ${this.q('version')} = ${this.q('version')} + 1
        WHERE ${this.q('store_id')} = ${bind.add(storeId)}
          AND ${this.q('id')} IN (${bind.addAll(targets)})`;

    const statement = bind.finish(sql);
    const { affectedRows } = await writable.execute(statement.sql, statement.parameters);

    if (affectedRows === 0) {
      throw new Error('No theme was published — the theme may belong to another store.');
    }

    // The history row is what a rollback reads. Written after the pointer moved,
    // so a failed publish leaves no record of one.
    const insert = new Binder(this.dialect);
    const insertSql =
      `INSERT INTO ${this.q('theme_versions')}
         (${this.q('id')}, ${this.q('store_id')}, ${this.q('theme_id')}, ${this.q('version_ref')},
          ${this.q('published_at')}, ${this.q('version')}, ${this.q('created_at')}, ${this.q('updated_at')})
       VALUES (${insert.add(this.newId())}, ${insert.add(storeId)}, ${insert.add(change.promote.themeId)},
               ${insert.add(change.promote.versionRef)}, ${insert.add(now)}, 1, ${insert.add(now)}, ${insert.add(now)})`;

    const insertStatement = insert.finish(insertSql);
    await this.executor.query(insertStatement.sql, insertStatement.parameters);
  }

  async history(themeId: string): Promise<readonly { versionRef: string; publishedAt: string }[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('version_ref')}, ${this.q('published_at')}
         FROM ${this.q('theme_versions')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('theme_id')} = ${this.p(2)}
        ORDER BY ${this.q('published_at')} DESC
        LIMIT 50`,
      [this.storeId(), themeId],
    );

    return rows.map((row) => ({
      versionRef: String(row.version_ref),
      publishedAt: new Date(String(row.published_at)).toISOString(),
    }));
  }

  /** Every theme this store has, for the editor's theme picker. */
  async all(): Promise<readonly ThemeRecord[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('name')}, ${this.q('role')}, ${this.q('source_ref')}
         FROM ${this.q('themes')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('role')} = 'main' DESC, ${this.q('updated_at')} DESC`,
      [this.storeId()],
    );
    return rows.map((row) => this.toRecord(row));
  }
}
