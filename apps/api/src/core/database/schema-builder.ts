/**
 * Core · database/schema-builder.ts
 * Generates DDL from an entity declaration (§35.1). The module author declares
 * the entity; the platform derives the base columns, the toolkit's satellite
 * tables and the required indexes — so no one hand-writes a CREATE TABLE and no
 * table ships without its tenant index.
 *
 * This is the schema for *platform structure* only. A merchant adding a
 * metafield never triggers DDL — that is data in the metafields table (§17.4),
 * which is what lets millions of tenants define custom fields.
 * Layer: core/infrastructure.
 */

import type { EntityDeclaration, ResourceDefinition } from '@deservefirst/contracts';

import { moneyColumnNames, snakeCase } from '../entity-toolkit/column-mapping';
import { type SqlDialect } from '../list-engine/dialect';
import { resolveToolkit } from '../entity-toolkit/toolkit';

export interface ColumnSpec {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultValue?: string;
}

/** Maps a declared field type onto a column type per dialect. */
function columnType(dialect: SqlDialect, fieldType: string): string {
  const mysql = dialect.name === 'mysql';
  switch (fieldType) {
    case 'id':
    case 'reference':
      return mysql ? 'VARCHAR(64)' : 'TEXT';
    case 'handle':
      return mysql ? 'VARCHAR(255)' : 'TEXT';
    case 'string':
      return mysql ? 'VARCHAR(255)' : 'TEXT';
    case 'text':
    case 'richtext':
      return mysql ? 'MEDIUMTEXT' : 'TEXT';
    case 'integer':
      return mysql ? 'INT' : 'INTEGER';
    case 'decimal':
      return mysql ? 'DECIMAL(18,4)' : 'NUMERIC(18,4)';
    case 'boolean':
      return mysql ? 'TINYINT(1)' : 'BOOLEAN';
    case 'date':
      return 'DATE';
    case 'datetime':
      return mysql ? 'DATETIME(3)' : 'TIMESTAMPTZ';
    case 'enum':
      return mysql ? 'VARCHAR(64)' : 'TEXT';
    case 'json':
      return mysql ? 'JSON' : 'JSONB';
    case 'file':
      return mysql ? 'VARCHAR(1024)' : 'TEXT';
    default:
      return mysql ? 'VARCHAR(255)' : 'TEXT';
  }
}

/**
 * Money becomes two columns, not one: an exact integer amount and its currency.
 * A single DECIMAL would lose the currency and invite float arithmetic (§15.2).
 */
function moneyColumns(dialect: SqlDialect, fieldName: string): ColumnSpec[] {
  const { amount, currency } = moneyColumnNames(fieldName);
  return [
    { name: amount, type: 'BIGINT', nullable: true },
    { name: currency, type: dialect.name === 'mysql' ? 'CHAR(3)' : 'TEXT', nullable: true },
  ];
}

/** Re-exported for callers that only need the naming convention. */
export const snake = snakeCase;

/** The columns every row carries, plus the boundary column for its scope (§12.1). */
export function baseColumns(
  dialect: SqlDialect,
  softDelete: boolean,
  scope: 'store' | 'organization' | 'platform' = 'store',
): ColumnSpec[] {
  const timestamp = dialect.name === 'mysql' ? 'DATETIME(3)' : 'TIMESTAMPTZ';
  const identifier = dialect.name === 'mysql' ? 'VARCHAR(64)' : 'TEXT';
  const columns: ColumnSpec[] = [
    { name: 'id', type: identifier, nullable: false },
  ];

  // The boundary column is the scope. A platform-scoped table has none, and
  // pretending otherwise would make the isolation guard enforce a fiction.
  if (scope === 'store') {
    columns.push({ name: 'store_id', type: identifier, nullable: false });
  } else if (scope === 'organization') {
    columns.push({ name: 'organization_id', type: identifier, nullable: false });
  }

  columns.push(
    { name: 'handle', type: dialect.name === 'mysql' ? 'VARCHAR(255)' : 'TEXT', nullable: true },
    { name: 'created_at', type: timestamp, nullable: false, defaultValue: 'CURRENT_TIMESTAMP(3)' },
    { name: 'updated_at', type: timestamp, nullable: false, defaultValue: 'CURRENT_TIMESTAMP(3)' },
    { name: 'version', type: dialect.name === 'mysql' ? 'INT' : 'INTEGER', nullable: false, defaultValue: '1' },
  );

  if (softDelete) {
    columns.push({ name: 'deleted_at', type: timestamp, nullable: true });
  }
  return columns;
}

export interface TableDdl {
  readonly table: string;
  readonly createTable: string;
  readonly indexes: readonly { name: string; sql: string }[];
}

export function buildEntityDdl(
  dialect: SqlDialect,
  entity: EntityDeclaration,
  resource: ResourceDefinition,
): TableDdl {
  const toolkit = resolveToolkit(entity);
  const quote = (name: string) => dialect.quoteIdentifier(name);

  const declared = resource.fields.flatMap((field): ColumnSpec[] => {
    // id and handle already come from the base set.
    if (field.name === 'id' || field.name === 'handle') return [];
    if (field.type === 'money') return moneyColumns(dialect, field.name);
    return [
      {
        name: snake(field.name),
        type: columnType(dialect, field.type),
        nullable: !field.required,
      },
    ];
  });

  // createdAt / updatedAt are base columns; drop any duplicate declaration.
  const scope = entity.scope ?? 'store';
  const base = baseColumns(dialect, toolkit.softDelete, scope);
  const baseNames = new Set(base.map((column) => column.name));
  const columns = [...base, ...declared.filter((column) => !baseNames.has(column.name))];

  // published_channels is modelled on the aggregate but has no scalar field.
  if (!columns.some((column) => column.name === 'published_channels')) {
    columns.push({
      name: 'published_channels',
      type: dialect.name === 'mysql' ? 'JSON' : 'JSONB',
      nullable: true,
    });
  }

  const definitions = columns.map((column) => {
    const parts = [`${quote(column.name)} ${column.type}`, column.nullable ? 'NULL' : 'NOT NULL'];
    if (column.defaultValue) parts.push(`DEFAULT ${column.defaultValue}`);
    return `  ${parts.join(' ')}`;
  });
  definitions.push(`  PRIMARY KEY (${quote('id')})`);

  const createTable = `CREATE TABLE IF NOT EXISTS ${quote(entity.tableName)} (\n${definitions.join(',\n')}\n)`;

  // Every store-scoped table gets its tenant index whether the author remembered
  // or not — a missing one degrades every tenant on the shard, not just this one.
  const boundary = scope === 'store' ? 'store_id' : scope === 'organization' ? 'organization_id' : null;
  const indexes = boundary
    ? [
        {
          name: `idx_${entity.tableName}_scope`,
          sql: `CREATE INDEX idx_${entity.tableName}_scope ON ${quote(entity.tableName)} (${quote(boundary)})`,
        },
        {
          name: `idx_${entity.tableName}_scope_created`,
          sql: `CREATE INDEX idx_${entity.tableName}_scope_created ON ${quote(entity.tableName)} (${quote(boundary)}, ${quote('created_at')}, ${quote('id')})`,
        },
        {
          name: `uq_${entity.tableName}_scope_handle`,
          sql: `CREATE UNIQUE INDEX uq_${entity.tableName}_scope_handle ON ${quote(entity.tableName)} (${quote(boundary)}, ${quote('handle')})`,
        },
      ]
    : [
        {
          name: `uq_${entity.tableName}_handle`,
          sql: `CREATE UNIQUE INDEX uq_${entity.tableName}_handle ON ${quote(entity.tableName)} (${quote('handle')})`,
        },
      ];

  return { table: entity.tableName, createTable, indexes };
}

/** DDL for the toolkit's satellite tables — metafields, tags, timeline and friends. */
export function buildToolkitDdl(dialect: SqlDialect, entity: EntityDeclaration): TableDdl[] {
  const toolkit = resolveToolkit(entity);
  const quote = (name: string) => dialect.quoteIdentifier(name);
  const mysql = dialect.name === 'mysql';
  const id = mysql ? 'VARCHAR(64)' : 'TEXT';
  const text = mysql ? 'VARCHAR(255)' : 'TEXT';
  const long = mysql ? 'MEDIUMTEXT' : 'TEXT';
  const ts = mysql ? 'DATETIME(3)' : 'TIMESTAMPTZ';
  const json = mysql ? 'JSON' : 'JSONB';
  const tables: TableDdl[] = [];

  const satellite = (
    suffix: string,
    columns: string[],
    indexes: { name: string; columns: string[]; unique?: boolean }[],
  ) => {
    const name = `${entity.tableName}_${suffix}`;
    tables.push({
      table: name,
      createTable: `CREATE TABLE IF NOT EXISTS ${quote(name)} (\n${[
        `  ${quote('id')} ${id} NOT NULL`,
        `  ${quote('store_id')} ${id} NOT NULL`,
        `  ${quote('owner_id')} ${id} NOT NULL`,
        ...columns.map((column) => `  ${column}`),
        `  ${quote('created_at')} ${ts} NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`,
        `  PRIMARY KEY (${quote('id')})`,
      ].join(',\n')}\n)`,
      indexes: indexes.map((index) => ({
        name: index.name,
        sql: `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${index.name} ON ${quote(name)} (${index.columns
          .map(quote)
          .join(', ')})`,
      })),
    });
  };

  if (toolkit.metafields) {
    satellite(
      'metafields',
      [
        `${quote('definition_id')} ${id} NULL`,
        `${quote('namespace')} ${text} NOT NULL`,
        `${quote('metafield_key')} ${text} NOT NULL`,
        `${quote('value_type')} ${text} NOT NULL`,
        `${quote('value')} ${long} NULL`,
      ],
      [
        {
          name: `uq_${entity.tableName}_mf`,
          columns: ['store_id', 'owner_id', 'namespace', 'metafield_key'],
          unique: true,
        },
      ],
    );
  }

  if (toolkit.tags) {
    satellite('tags', [`${quote('tag')} ${text} NOT NULL`], [
      { name: `uq_${entity.tableName}_tag`, columns: ['store_id', 'owner_id', 'tag'], unique: true },
    ]);
  }

  if (toolkit.timeline) {
    satellite(
      'timeline',
      [
        `${quote('kind')} ${text} NOT NULL`,
        `${quote('actor_id')} ${id} NULL`,
        `${quote('actor_label')} ${text} NOT NULL`,
        `${quote('message')} ${long} NOT NULL`,
        `${quote('changes')} ${json} NULL`,
      ],
      [{ name: `idx_${entity.tableName}_tl`, columns: ['store_id', 'owner_id', 'created_at'] }],
    );
  }

  if ((entity.translatableFields ?? []).length > 0) {
    satellite(
      'translations',
      [
        `${quote('field')} ${text} NOT NULL`,
        `${quote('locale')} ${mysql ? 'VARCHAR(35)' : 'TEXT'} NOT NULL`,
        `${quote('value')} ${long} NOT NULL`,
        `${quote('status')} ${text} NOT NULL`,
        `${quote('outdated')} ${mysql ? 'TINYINT(1)' : 'BOOLEAN'} NOT NULL DEFAULT 0`,
      ],
      [
        {
          name: `uq_${entity.tableName}_tr`,
          columns: ['store_id', 'owner_id', 'field', 'locale'],
          unique: true,
        },
      ],
    );
  }

  if (toolkit.seo) {
    satellite(
      'seo',
      [
        `${quote('title')} ${text} NULL`,
        `${quote('description')} ${long} NULL`,
        `${quote('canonical_url')} ${mysql ? 'VARCHAR(1024)' : 'TEXT'} NULL`,
        `${quote('og_image_url')} ${mysql ? 'VARCHAR(1024)' : 'TEXT'} NULL`,
        `${quote('no_index')} ${mysql ? 'TINYINT(1)' : 'BOOLEAN'} NOT NULL DEFAULT 0`,
        `${quote('no_follow')} ${mysql ? 'TINYINT(1)' : 'BOOLEAN'} NOT NULL DEFAULT 0`,
      ],
      [{ name: `uq_${entity.tableName}_seo`, columns: ['store_id', 'owner_id'], unique: true }],
    );
  }

  if (toolkit.savedViews) {
    // Deliberately NOT built with satellite(): every other satellite hangs off a
    // record, but a saved view belongs to a *user* and applies to the whole
    // list. Reusing `owner_id` here would give the same column two meanings.
    const name = `${entity.tableName}_saved_views`;
    tables.push({
      table: name,
      createTable: `CREATE TABLE IF NOT EXISTS ${quote(name)} (\n${[
        `  ${quote('id')} ${id} NOT NULL`,
        `  ${quote('store_id')} ${id} NOT NULL`,
        `  ${quote('user_id')} ${id} NULL`,
        `  ${quote('name')} ${text} NOT NULL`,
        `  ${quote('query')} ${long} NULL`,
        `  ${quote('sort')} ${text} NULL`,
        `  ${quote('columns')} ${json} NULL`,
        `  ${quote('shared')} ${mysql ? 'TINYINT(1)' : 'BOOLEAN'} NOT NULL DEFAULT 0`,
        `  ${quote('position')} ${mysql ? 'INT' : 'INTEGER'} NOT NULL DEFAULT 0`,
        `  ${quote('created_at')} ${ts} NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`,
        `  PRIMARY KEY (${quote('id')})`,
      ].join(',\n')}\n)`,
      indexes: [
        {
          name: `idx_${entity.tableName}_sv`,
          sql: `CREATE INDEX idx_${entity.tableName}_sv ON ${quote(name)} (${quote('store_id')}, ${quote('position')})`,
        },
      ],
    });
  }

  return tables;
}
