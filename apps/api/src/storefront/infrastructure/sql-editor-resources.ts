/**
 * Storefront · infrastructure/sql-editor-resources.ts
 * Finding the record a theme setting should point at.
 *
 * Reads the catalogue and content tables directly, the same way
 * `sql-storefront-data.ts` does and for the same reason: these are one store's
 * own records, and routing an editor's type-ahead through another module's
 * service layer would add a hop without adding a rule.
 *
 * One deliberate difference from the storefront's own queries, and it is the
 * point of the file. The storefront filters to PUBLISHED records because a
 * by-handle lookup for an anonymous visitor is a handle oracle. This does not:
 * it runs for a signed-in merchant looking at their own store, and a merchant
 * building a homepage before launch is referring to drafts on purpose. Hiding
 * them would make the picker useless exactly when it is most needed. What it
 * does instead is SAY which are unpublished, because a section pointing at an
 * invisible record renders empty and that is worth knowing before launch day
 * rather than after.
 * Layer: infrastructure.
 */

import { Binder } from '../../core/database/bind';
import type { QueryExecutor } from '../../core/list-engine';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import {
  normaliseSearchTerm,
  SEARCH_LIMIT,
  type ResourceMatch,
  type SearchableType,
} from '../domain';

type Row = Record<string, unknown>;

/**
 * How each searchable type maps to a table.
 *
 * A closed record keyed by the allow-list, so a type that is not one of them
 * cannot reach this — the type system refuses it here and `isSearchableType`
 * refuses it at the edge. A table name assembled from a query parameter is the
 * bug this shape exists to make unwritable.
 */
const SOURCES: Readonly<
  Record<
    SearchableType,
    {
      readonly table: string;
      /** How this kind decides whether customers can see it. */
      readonly publishedWhen: 'status' | 'published-at' | 'always';
      /** An extra column worth showing beside the title. */
      readonly context: string | null;
    }
  >
> = {
  product: { table: 'products', publishedWhen: 'status', context: 'product_type' },
  collection: { table: 'collections', publishedWhen: 'always', context: null },
  page: { table: 'pages', publishedWhen: 'status', context: null },
  blog: { table: 'blogs', publishedWhen: 'always', context: null },
  article: { table: 'blog_posts', publishedWhen: 'status', context: 'author' },
  link_list: { table: 'menus', publishedWhen: 'always', context: null },
};

export class SqlEditorResources {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  async search(type: SearchableType, term: string): Promise<readonly ResourceMatch[]> {
    const storeId = requireStoreContext('storefront.editor.resources').storeId;
    const source = SOURCES[type];
    const search = normaliseSearchTerm(term);

    const bind = new Binder(this.dialect);

    const published =
      source.publishedWhen === 'status'
        ? `CASE WHEN ${this.q('status')} = 'published' THEN 1 ELSE 0 END`
        : source.publishedWhen === 'published-at'
          ? `CASE WHEN ${this.q('published_at')} IS NOT NULL THEN 1 ELSE 0 END`
          : '1';

    const context = source.context ? this.q(source.context) : `''`;

    /**
     * Bound in the order the placeholders appear in the finished statement.
     *
     * The store predicate comes first in the SQL, so it is added first here.
     * Building the filter above the statement read naturally and was wrong: its
     * values were bound before the store id, so on MySQL — where each `?` takes
     * the NEXT value — the store predicate would have been compared against the
     * merchant's search term. `Binder` caught it on the count; the ordering was
     * the real defect underneath.
     */
    const store = bind.add(storeId);

    /**
     * Matched on title AND handle, because merchants search for both.
     *
     * Somebody who remembers "the linen one" types a word from the title;
     * somebody pasting from a URL has the handle. Matching only the title would
     * fail the second, which is the case the picker exists to fix.
     *
     * No `ESCAPE` clause: backslash is already the default for `LIKE` in both
     * MySQL and Postgres, and `normaliseSearchTerm` has escaped the wildcards
     * with it. Spelling it out put a quoted backslash inside the statement,
     * which is exactly the shape that confuses anything scanning SQL for
     * placeholders — including our own placeholder count.
     */
    const filter =
      search === ''
        ? ''
        : `AND (${this.q('title')} LIKE ${bind.add(`%${search}%`)}
             OR ${this.q('handle')} LIKE ${bind.add(`%${search}%`)})`;

    const sql = `SELECT ${this.q('handle')} AS handle, ${this.q('title')} AS title,
                        ${context} AS context, ${published} AS published
                   FROM ${this.q(source.table)}
                  WHERE ${this.q('store_id')} = ${store}
                    AND ${this.q('deleted_at')} IS NULL
                    AND ${this.q('handle')} IS NOT NULL
                    ${filter}
                  ORDER BY ${this.q('title')} ASC
                  LIMIT ${SEARCH_LIMIT}`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);

    return rows.map((row) => ({
      handle: String(row.handle),
      title: String(row.title ?? row.handle),
      subtitle: row.context ? String(row.context) : null,
      // MySQL answers a CASE with 1/0 and Postgres with a boolean; both are
      // truthy-correct only after this, and `'0'` is a string that is not.
      published: row.published === 1 || row.published === true || row.published === '1',
    }));
  }
}
