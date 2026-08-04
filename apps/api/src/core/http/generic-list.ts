/**
 * Core · http/generic-list.ts
 * The generic read surface. Every resource that declares `rest: true` gets a
 * list and a get endpoint from its declaration alone — the list engine already
 * works from a ResourceDefinition and a table name, so no per-entity repository
 * is needed to read.
 *
 * Writes are deliberately NOT generic: they go through a module's own service,
 * because that is where invariants, state transitions and events live. A generic
 * writer would be a way to bypass the domain (§13.1).
 * Layer: core/http.
 */

import {
  type Connection,
  type ListQuery,
  type ResourceDefinition,
  type StoreId,
} from '@deservefirst/contracts';

import { requireStoreContext } from '../tenant-context/request-context.store';
import { type SqlDialect } from '../list-engine/dialect';
import { ListEngine, type QueryExecutor } from '../list-engine';
import { comparableColumnFor, physicalColumnsFor, snakeCase } from '../entity-toolkit/column-mapping';
import type { ModuleRegistry } from '../module-registry/registry';

export interface ResourceBinding {
  readonly moduleId: string;
  readonly resource: ResourceDefinition;
  readonly tableName: string;
}

/**
 * Maps every REST-exposed resource to its table, from the manifests. An entity
 * with no matching table is skipped rather than guessed at.
 */
export function bindResources(registry: ModuleRegistry): Map<string, ResourceBinding> {
  const bindings = new Map<string, ResourceBinding>();

  for (const entry of registry.enabled()) {
    const tables = new Map(
      (entry.manifest.entities ?? []).map((entity) => [entity.name, entity.tableName]),
    );

    for (const resource of entry.manifest.resources ?? []) {
      if (!resource.api.rest) continue;
      const tableName = tables.get(resource.entity);
      if (!tableName) continue;

      bindings.set(`${entry.manifest.id}:${resource.urlSegment}`, {
        moduleId: entry.manifest.id,
        resource,
        tableName,
      });
    }
  }

  return bindings;
}

export class GenericReader {
  private readonly listEngine: ListEngine;

  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {
    this.listEngine = new ListEngine(executor);
  }

  async list(binding: ResourceBinding, query: ListQuery): Promise<Connection<Record<string, unknown>>> {
    return this.listEngine.list({
      resource: binding.resource,
      tableName: binding.tableName,
      query,
      dialect: this.dialect,
    });
  }

  async get(binding: ResourceBinding, id: string): Promise<Record<string, unknown> | null> {
    const storeId: StoreId = requireStoreContext(`${binding.resource.name}.get`).storeId;
    const q = (name: string) => this.dialect.quoteIdentifier(name);
    const [p1, p2] = [this.dialect.placeholder(1), this.dialect.placeholder(2)];

    // Project only the declared fields: a `SELECT *` would leak any column added
    // to the table but not to the resource, including internal ones.
    const columns = new Set([
      'id',
      'version',
      'handle',
      ...binding.resource.fields.flatMap(physicalColumnsFor),
    ]);

    const rows = await this.executor.query<Record<string, unknown>>(
      `SELECT ${[...columns].map(q).join(', ')}
         FROM ${q(binding.tableName)}
        WHERE ${q('store_id')} = ${p1} AND ${q('id')} = ${p2} AND ${q('deleted_at')} IS NULL
        LIMIT 1`,
      [storeId, id],
    );

    return rows[0] ?? null;
  }
}

/**
 * Serialises a row for the wire using the resource's declared visibility.
 * Private and internal fields never leave the server (§26.4), and money is
 * emitted as an exact decimal string rather than a float.
 */
export function serializeRow(
  resource: ResourceDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> {
  // Base-entity fields are part of every resource's contract whether or not the
  // author listed them. `version` especially: a client that cannot read it
  // cannot send it back, and optimistic concurrency stops working silently.
  const output: Record<string, unknown> = { id: row.id };
  if (row.version !== undefined) output.version = Number(row.version);
  if (row.handle !== undefined && row.handle !== null) output.handle = row.handle;

  for (const field of resource.fields) {
    if (field.name === 'id') continue;
    // The public surface is what a client may see; anything else is omitted.
    if (field.visibility === 'private' || field.visibility === 'internal') continue;

    if (field.type === 'money') {
      const amount = row[`${snakeCase(field.name)}_amount_minor`];
      const currency = row[`${snakeCase(field.name)}_currency`];
      output[field.name] =
        amount === null || amount === undefined
          ? null
          : { amount: toDecimal(String(amount), String(currency ?? 'USD')), currency: currency ?? 'USD' };
      continue;
    }

    const value = row[comparableColumnFor(field)];
    output[field.name] =
      field.type === 'boolean' && value !== null && value !== undefined
        ? Boolean(Number(value))
        : (value ?? null);
  }

  return output;
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Minor units to a decimal string, without ever creating a float. */
function toDecimal(amountMinor: string, currency: string): string {
  const exponent = ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
  if (exponent === 0) return amountMinor;

  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
