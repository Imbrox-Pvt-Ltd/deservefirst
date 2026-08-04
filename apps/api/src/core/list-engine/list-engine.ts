/**
 * Core · list-engine/list-engine.ts
 * Turns a compiled query into a Relay-style connection. The one place that knows
 * how a page becomes a cursor, so every ListScreen on the platform paginates
 * identically (§12.6, §13.6).
 * Layer: core.
 */

import type { Connection, ListQuery, ResourceDefinition, StoreId } from '@deservefirst/contracts';

import { requireStoreContext } from '../tenant-context/request-context.store';
import { cursorFor } from './cursor';
import { type SqlDialect, postgresDialect } from './dialect';
import { compileCountQuery, compileListQuery } from './query-compiler';

export interface QueryExecutor {
  query<T = Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<T[]>;
}

export interface ListRequest {
  readonly resource: ResourceDefinition;
  readonly tableName: string;
  readonly query: ListQuery;
  readonly includeDeleted?: boolean;
  /** Counting is opt-in: on a large table it can cost more than the page. */
  readonly withTotalCount?: boolean;
  /** Defaults to Postgres, the platform's target database (ADR 0001 D7). */
  readonly dialect?: SqlDialect;
}

export class ListEngine {
  constructor(private readonly executor: QueryExecutor) {}

  async list<T extends Record<string, unknown>>(request: ListRequest): Promise<Connection<T>> {
    // The store comes from the ambient context, never from the caller — an
    // argument can be forged by a controller bug; the context cannot.
    const context = requireStoreContext(`list:${request.resource.entity}`);
    return this.listForStore(context.storeId, request);
  }

  /** Explicit-store variant for workers, which run outside a request. */
  async listForStore<T extends Record<string, unknown>>(
    storeId: StoreId,
    request: ListRequest,
  ): Promise<Connection<T>> {
    const options = {
      resource: request.resource,
      tableName: request.tableName,
      storeId,
      query: request.query,
      includeDeleted: request.includeDeleted ?? false,
      dialect: request.dialect ?? postgresDialect,
    };

    const compiled = compileListQuery(options);
    const rows = await this.executor.query<T>(compiled.sql, compiled.parameters);

    // We asked for one more row than the page size; its presence is how we know
    // there is a next page without a second round trip.
    const hasExtra = rows.length === compiled.limit;
    const nodes = hasExtra ? rows.slice(0, -1) : rows;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const sortField = compiled.sort.field;

    const totalCount = request.withTotalCount
      ? await this.count(options)
      : undefined;

    return {
      nodes,
      pageInfo: {
        // The extra row we fetched is the only evidence a next page exists.
        hasNextPage: hasExtra,
        // Being past the first page — in either direction — means one exists behind us.
        hasPreviousPage: Boolean(request.query.cursor) || Boolean(request.query.before),
        startCursor: first ? cursorFor(first, sortField) : null,
        endCursor: last ? cursorFor(last, sortField) : null,
      },
      ...(totalCount === undefined ? {} : { totalCount }),
    };
  }

  private async count(options: Parameters<typeof compileCountQuery>[0]): Promise<number> {
    const counted = compileCountQuery(options);
    const rows = await this.executor.query<{ total: number }>(counted.sql, counted.parameters);
    return rows[0]?.total ?? 0;
  }
}
