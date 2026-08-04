/**
 * Content · infrastructure/index.ts
 * Persistence for pages, metaobject definitions and their entries. Every query
 * here is store-scoped — the fitness suite fails the build on any that is not
 * (§14.2).
 *
 * Entry values are a JSON column rather than an entity-attribute-value table.
 * That is what makes a merchant inventing a content type a row rather than a
 * migration (§17.4): the shape lives in the definition, so the storage does not
 * need to know it.
 * Layer: infrastructure.
 */

import { type Connection, type ListQuery, type ResourceDefinition } from '@deservefirst/contracts';

import { SqlAggregateRepository, parseJsonArray, parseJsonColumn } from '../../../core/database';
import { metaobjectDefinitionResource, metaobjectEntryResource, pageResource } from '../contracts';
import type {
  MetaobjectDefinition,
  MetaobjectEntry,
  MetaobjectFieldDefinition,
  Page,
} from '../domain';
import type { DefinitionRepository, EntryRepository, PageRepository } from '../application';

// --- pages -------------------------------------------------------------------

interface PageRow extends Record<string, unknown> {
  id: string;
  handle: string;
  title: string;
  body: string | null;
  status: string;
  template_suffix: string | null;
  published_at: Date | string | null;
  version: number;
}

export class SqlPageRepository
  extends SqlAggregateRepository<Page, PageRow>
  implements PageRepository
{
  protected readonly tableName = 'pages';
  protected readonly resource: ResourceDefinition = pageResource;
  protected readonly operation = 'content.pages';

  protected toDomain(row: PageRow): Page {
    return {
      id: row.id,
      handle: row.handle,
      title: row.title,
      body: row.body ?? '',
      status: row.status as Page['status'],
      templateSuffix: row.template_suffix,
      publishedAt: row.published_at ? new Date(row.published_at as string) : null,
      version: Number(row.version),
    };
  }

  protected toColumns(entity: Page): Record<string, unknown> {
    return {
      handle: entity.handle,
      title: entity.title,
      body: entity.body,
      status: entity.status,
      template_suffix: entity.templateSuffix,
      published_at: entity.publishedAt,
    };
  }
}

// --- metaobject definitions ---------------------------------------------------

interface DefinitionRow extends Record<string, unknown> {
  id: string;
  type: string;
  name: string;
  description: string | null;
  fields: unknown;
  display_name_key: string | null;
  version: number;
}

export class SqlDefinitionRepository
  extends SqlAggregateRepository<MetaobjectDefinition, DefinitionRow>
  implements DefinitionRepository
{
  protected readonly tableName = 'metaobject_definitions';
  protected readonly resource: ResourceDefinition = metaobjectDefinitionResource;
  protected readonly operation = 'content.metaobject-definitions';

  protected toDomain(row: DefinitionRow): MetaobjectDefinition {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      fields: parseJsonArray<MetaobjectFieldDefinition>(row.fields),
      displayNameKey: row.display_name_key,
      version: Number(row.version),
    };
  }

  protected toColumns(entity: MetaobjectDefinition): Record<string, unknown> {
    return {
      // The type doubles as the handle: it is already the stable, unique,
      // URL-safe name a merchant refers to the content type by, and the base
      // entity enforces one handle per store.
      handle: entity.type,
      type: entity.type,
      name: entity.name,
      description: entity.description,
      fields: JSON.stringify(entity.fields),
      display_name_key: entity.displayNameKey,
    };
  }

  async findByType(type: string): Promise<MetaobjectDefinition | null> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<DefinitionRow>(
      `SELECT * FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('type')} = ${p2}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), type],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }
}

// --- metaobject entries --------------------------------------------------------

interface EntryRow extends Record<string, unknown> {
  id: string;
  definition_id: string;
  handle: string;
  values: unknown;
  status: string;
  version: number;
}

export class SqlEntryRepository
  extends SqlAggregateRepository<MetaobjectEntry, EntryRow>
  implements EntryRepository
{
  protected readonly tableName = 'metaobject_entries';
  protected readonly resource: ResourceDefinition = metaobjectEntryResource;
  protected readonly operation = 'content.metaobject-entries';

  protected toDomain(row: EntryRow): MetaobjectEntry {
    const values = parseJsonColumn(row.values);
    return {
      id: row.id,
      definitionId: row.definition_id,
      handle: row.handle,
      values: (values && typeof values === 'object' ? values : {}) as Record<string, unknown>,
      status: row.status as MetaobjectEntry['status'],
      version: Number(row.version),
    };
  }

  protected toColumns(entity: MetaobjectEntry): Record<string, unknown> {
    return {
      definition_id: entity.definitionId,
      handle: entity.handle,
      values: JSON.stringify(entity.values),
      status: entity.status,
    };
  }

  /**
   * Entries of one type. The definition filter is applied here rather than left
   * to the caller: an entry list that accidentally spanned two types would
   * render each row's values against the wrong field definitions, which looks
   * like corrupted data rather than a bad query.
   */
  async listFor(definitionId: string, query: ListQuery): Promise<Connection<MetaobjectEntry>> {
    return this.list({
      ...query,
      filters: [
        ...(query.filters ?? []),
        { field: 'definitionId', operator: ':', value: definitionId },
      ],
    });
  }

  async countFor(definitionId: string): Promise<number> {
    const [p1, p2] = this.args(2);
    const rows = await this.executor.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM ${this.q(this.tableName)}
        WHERE ${this.q('store_id')} = ${p1}
          AND ${this.q('definition_id')} = ${p2}
          AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId(), definitionId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Handles are unique per STORE, not per definition, so the definition does not
   * narrow the search. Scoping it would let two content types both settle on
   * "acme" and fail at insert instead of disambiguating to "acme-2".
   */
  async takenHandlesFor(_definitionId: string, prefix: string): Promise<ReadonlySet<string>> {
    return this.takenHandles(prefix);
  }
}
