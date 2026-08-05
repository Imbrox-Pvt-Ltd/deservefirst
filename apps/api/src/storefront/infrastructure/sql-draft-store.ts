/**
 * Storefront · infrastructure/sql-draft-store.ts
 * A merchant's unsaved edits, kept where a restart cannot lose them.
 *
 * The in-memory store was right for tests and wrong for people: an editor that
 * forgets an afternoon's work because a server was redeployed is one nobody
 * trusts twice.
 *
 * Drafts live in their own table rather than in the theme's files. A draft
 * written into the theme would be visible to every customer the moment it was
 * saved, which is the single thing the editor must never do.
 * Layer: infrastructure.
 */

import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import type { DraftStore } from '../application';
import type { TemplateDocument } from '../domain';

interface Row extends Record<string, unknown> {}

export class SqlDraftStore implements DraftStore {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly newId: () => string,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private storeId(): string {
    return requireStoreContext('storefront.drafts').storeId;
  }

  async read(themeId: string, templatePath: string): Promise<TemplateDocument | null> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('document')}, ${this.q('document_version')}
         FROM ${this.q('theme_drafts')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('theme_id')} = ${this.p(2)}
          AND ${this.q('template_path')} = ${this.p(3)} AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), themeId, templatePath],
    );

    const row = rows[0];
    if (!row) return null;

    const document = parseJson<{ sections: TemplateDocument['sections'] }>(row.document);
    if (!document?.sections) return null;

    return {
      templatePath,
      sections: document.sections,
      // The editor's version, not the row's. The row's changes on every
      // keystroke; the editor's is what a conflict check compares.
      version: Number(row.document_version ?? 1),
    };
  }

  /**
   * Writes the draft, replacing whatever was there.
   *
   * Upsert rather than read-then-write: two saves arriving together would
   * otherwise both find nothing and both insert, leaving a merchant with two
   * drafts for one template and no way to tell which the editor will read.
   */
  async write(themeId: string, document: TemplateDocument): Promise<void> {
    const storeId = this.storeId();
    const now = new Date();
    const payload = JSON.stringify({ sections: document.sections });

    const existing = await this.executor.query<Row>(
      `SELECT ${this.q('id')} FROM ${this.q('theme_drafts')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('theme_id')} = ${this.p(2)}
          AND ${this.q('template_path')} = ${this.p(3)}
        LIMIT 1`,
      [storeId, themeId, document.templatePath],
    );

    if (existing[0]) {
      await this.executor.query(
        `UPDATE ${this.q('theme_drafts')}
            SET ${this.q('document')} = ${this.p(1)},
                ${this.q('document_version')} = ${this.p(2)},
                ${this.q('updated_at')} = ${this.p(3)},
                ${this.q('deleted_at')} = NULL,
                ${this.q('version')} = ${this.q('version')} + 1
          WHERE ${this.q('id')} = ${this.p(4)} AND ${this.q('store_id')} = ${this.p(5)}`,
        [payload, document.version, now, String(existing[0].id), storeId],
      );
      return;
    }

    await this.executor.query(
      `INSERT INTO ${this.q('theme_drafts')}
         (${this.q('id')}, ${this.q('store_id')}, ${this.q('theme_id')}, ${this.q('template_path')},
          ${this.q('document')}, ${this.q('document_version')}, ${this.q('version')},
          ${this.q('created_at')}, ${this.q('updated_at')})
       VALUES (${this.p(1)}, ${this.p(2)}, ${this.p(3)}, ${this.p(4)}, ${this.p(5)}, ${this.p(6)}, 1, ${this.p(7)}, ${this.p(8)})`,
      [this.newId(), storeId, themeId, document.templatePath, payload, document.version, now, now],
    );
  }

  async discard(themeId: string, templatePath: string): Promise<void> {
    await this.executor.query(
      `DELETE FROM ${this.q('theme_drafts')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('theme_id')} = ${this.p(2)}
          AND ${this.q('template_path')} = ${this.p(3)}`,
      [this.storeId(), themeId, templatePath],
    );
  }

  async pending(themeId: string): Promise<readonly string[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('template_path')} FROM ${this.q('theme_drafts')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('theme_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('template_path')} ASC`,
      [this.storeId(), themeId],
    );
    return rows.map((row) => String(row.template_path));
  }
}

/** JSON columns arrive parsed on some drivers and as a string on others. */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
