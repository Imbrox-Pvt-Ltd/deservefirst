/**
 * Core · list-engine/query-compiler.ts
 * Compiles a ListQuery (the URL state) into parameterised, tenant-scoped SQL
 * (§12.6). Implemented once here and inherited by every entity that declares its
 * filterable and sortable fields — which is how "the same filters and search
 * everywhere" happens without rebuilding it per module.
 *
 * Two rules are non-negotiable and enforced structurally rather than by review:
 * every statement carries a store predicate, and every value travels as a bound
 * parameter. There is no code path that concatenates a value into SQL.
 * Layer: core.
 */

import {
  type FilterToken,
  type ListQuery,
  MAX_PAGE_SIZE,
  type ResourceDefinition,
  type SortSpec,
  type StoreId,
} from '@deservefirst/contracts';

import { decodeCursor } from './cursor';

export interface CompiledQuery {
  readonly sql: string;
  readonly parameters: readonly unknown[];
  /** One more than the page size, so the caller can detect a next page. */
  readonly limit: number;
  readonly sort: SortSpec;
  readonly selectedColumns: readonly string[];
}

export class UnknownFilterFieldError extends Error {
  constructor(
    readonly field: string,
    readonly entity: string,
  ) {
    super(
      `"${field}" is not a filterable field on ${entity}. Declare it filterable in the resource definition ` +
        'rather than filtering on an undeclared column.',
    );
    this.name = 'UnknownFilterFieldError';
  }
}

export class UnknownSortFieldError extends Error {
  constructor(
    readonly field: string,
    readonly entity: string,
  ) {
    super(`"${field}" is not a sortable field on ${entity}.`);
    this.name = 'UnknownSortFieldError';
  }
}

const OPERATOR_SQL: Record<FilterToken['operator'], string> = {
  ':': '=',
  ':>': '>',
  ':<': '<',
  ':>=': '>=',
  ':<=': '<=',
  ':!': '<>',
};

/**
 * Identifiers come from the resource definition, never from user input, but we
 * still validate their shape — defence in depth costs one regex.
 */
function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Refusing to build SQL with unsafe identifier "${name}"`);
  }
  return `"${name}"`;
}

function columnFor(resource: ResourceDefinition, fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export interface CompileOptions {
  readonly resource: ResourceDefinition;
  readonly tableName: string;
  readonly storeId: StoreId;
  readonly query: ListQuery;
  /** Excluded unless asked for — soft-deleted rows are invisible by default. */
  readonly includeDeleted?: boolean;
}

export function compileListQuery(options: CompileOptions): CompiledQuery {
  const { resource, tableName, storeId, query } = options;
  const parameters: unknown[] = [];
  const conditions: string[] = [];

  const bind = (value: unknown): string => {
    parameters.push(value);
    return `$${parameters.length}`;
  };

  // 1. Tenant scope. First predicate, always present, never conditional.
  conditions.push(`${quoteIdentifier('store_id')} = ${bind(storeId)}`);

  // 2. Soft delete.
  if (!options.includeDeleted) {
    conditions.push(`${quoteIdentifier('deleted_at')} IS NULL`);
  }

  // 3. Filter tokens, validated against the declared filterable fields.
  const filterable = new Map(
    resource.fields.filter((field) => field.filterable).map((field) => [field.name, field]),
  );
  for (const filter of query.filters) {
    const field = filterable.get(filter.field);
    if (!field) throw new UnknownFilterFieldError(filter.field, resource.entity);

    const column = quoteIdentifier(columnFor(resource, field.name));
    if (field.type === 'string' || field.type === 'text' || field.type === 'handle') {
      // Equality on text filters is case-insensitive; users do not think in case.
      conditions.push(
        filter.operator === ':'
          ? `lower(${column}) = lower(${bind(filter.value)})`
          : `${column} ${OPERATOR_SQL[filter.operator]} ${bind(filter.value)}`,
      );
    } else {
      conditions.push(`${column} ${OPERATOR_SQL[filter.operator]} ${bind(coerce(field.type, filter.value))}`);
    }
  }

  // 4. Free-text search across the declared searchable fields.
  const searchable = resource.fields.filter((field) => field.searchable);
  if (query.text && searchable.length > 0) {
    const pattern = bind(`%${query.text}%`);
    const clauses = searchable.map(
      (field) => `${quoteIdentifier(columnFor(resource, field.name))} ILIKE ${pattern}`,
    );
    conditions.push(`(${clauses.join(' OR ')})`);
  }

  // 5. Sort — always total: the requested field plus id as the tiebreaker, so
  //    cursor pagination cannot loop or skip when values collide.
  const sortable = new Set(resource.fields.filter((field) => field.sortable).map((field) => field.name));
  const sort: SortSpec = query.sort ?? { field: 'createdAt', direction: 'desc' };
  if (sort.field !== 'createdAt' && !sortable.has(sort.field)) {
    throw new UnknownSortFieldError(sort.field, resource.entity);
  }
  const sortColumn = quoteIdentifier(columnFor(resource, sort.field));
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';

  // 6. Cursor. Row-value comparison gives correct keyset pagination over the
  //    composite (sort, id) ordering in one predicate.
  const cursorValue = query.cursor ?? query.before;
  if (cursorValue) {
    const position = decodeCursor(cursorValue);
    if (position) {
      const goingForward = Boolean(query.cursor);
      const comparator = goingForward === (direction === 'ASC') ? '>' : '<';
      conditions.push(
        `(${sortColumn}, ${quoteIdentifier('id')}) ${comparator} (${bind(position.sortValue)}, ${bind(position.id)})`,
      );
    }
  }

  // 7. Columns. The URL's selectedColumns is a *view* concern; we always select
  //    id and the sort column so cursors can be built regardless of what the
  //    user chose to display.
  const declared = new Set(resource.fields.map((field) => field.name));
  const requested = query.columns.filter((name) => declared.has(name));
  const projected = requested.length > 0 ? requested : resource.fields.map((field) => field.name);
  const columns = new Set(['id', columnFor(resource, sort.field), ...projected.map((name) => columnFor(resource, name))]);

  const limit = Math.min(query.limit, MAX_PAGE_SIZE) + 1;

  const sql = [
    `SELECT ${[...columns].map(quoteIdentifier).join(', ')}`,
    `FROM ${quoteIdentifier(tableName)}`,
    `WHERE ${conditions.join(' AND ')}`,
    `ORDER BY ${sortColumn} ${direction}, ${quoteIdentifier('id')} ${direction}`,
    `LIMIT ${limit}`,
  ].join('\n');

  return { sql, parameters, limit, sort, selectedColumns: [...columns] };
}

/**
 * Counting is a separate, optional query: it is materially more expensive than
 * the page itself on large tables, so callers opt in rather than pay by default.
 */
export function compileCountQuery(options: CompileOptions): { sql: string; parameters: readonly unknown[] } {
  const compiled = compileListQuery(options);
  const whereStart = compiled.sql.indexOf('WHERE');
  const orderStart = compiled.sql.indexOf('ORDER BY');
  const where = compiled.sql.slice(whereStart, orderStart).trim();

  return {
    sql: `SELECT COUNT(*)::int AS total\nFROM ${quoteIdentifier(options.tableName)}\n${where}`,
    parameters: compiled.parameters,
  };
}

function coerce(type: string, value: string): unknown {
  switch (type) {
    case 'integer':
      return Number.parseInt(value, 10);
    case 'decimal':
      return Number.parseFloat(value);
    case 'boolean':
      return value === 'true' || value === '1';
    case 'date':
    case 'datetime':
      return new Date(value);
    default:
      return value;
  }
}
