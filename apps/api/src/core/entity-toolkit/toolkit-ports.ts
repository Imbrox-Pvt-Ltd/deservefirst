/**
 * Core · entity-toolkit/toolkit-ports.ts
 * Wires the ports a module's services declare to real implementations: the slug
 * service, the timeline table and the event bus.
 *
 * This lived inside the catalog module until three other modules needed it,
 * which would have meant each of them importing catalog's internals — exactly
 * the coupling §14.1 forbids. It is generic over entity, so it belongs to Core.
 * Layer: core.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId, UserId } from '@deservefirst/contracts';

import type { EventBus } from '../event-bus/event-bus';
import { disambiguateHandle, slugifyHandle } from './base-entity';
import { snakeCase } from './column-mapping';
import { redactChanges } from './timeline';
import type { QueryExecutor } from '../list-engine';
import { type SqlDialect, postgresDialect } from '../list-engine/dialect';
import { requireStoreContext } from '../tenant-context/request-context.store';

/** The ports a module service needs from the toolkit. Declared here so no module
 *  has to import another module's copy. */
export interface ToolkitPorts {
  slugify(input: string): string;
  disambiguate(base: string, taken: ReadonlySet<string>): string;
  recordTimeline(input: {
    ownerId: string;
    message: string;
    changes: readonly { field: string; from: unknown; to: unknown }[];
  }): Promise<void>;
  emit(eventType: string, payload: Record<string, unknown>): Promise<void>;
  newId(): string;
  now(): Date;
}

export interface ToolkitPortsOptions {
  readonly executor: QueryExecutor;
  readonly events: EventBus;
  readonly dialect?: SqlDialect;
  readonly ownerEntity: string;
  /**
   * The owner's physical table, when it is not the entity name pluralised.
   * Supply it whenever the manifest does — guessing and being wrong produces a
   * write to a table that does not exist, at the moment someone edits a record.
   */
  readonly ownerTable?: string;
  readonly now?: () => Date;
}

/**
 * Records timeline entries and emits events for one entity. Timeline writes are
 * store-scoped like everything else, and change payloads are redacted before
 * they land — an audit feature that quotes a secret has become a leak.
 */
export function createToolkitPorts(options: ToolkitPortsOptions): ToolkitPorts {
  const dialect = options.dialect ?? postgresDialect;
  const now = options.now ?? (() => new Date());
  // The schema builder names this `{tableName}_timeline`. Lowercasing the entity
  // name matched that only for single-word entities: "PurchaseOrder" produced
  // `purchaseorders_timeline` against a real table of `purchase_orders_timeline`,
  // so the first timeline entry on any multi-word entity would have failed.
  const ownerTable = options.ownerTable ?? `${snakeCase(options.ownerEntity)}s`;
  const table = `${ownerTable}_timeline`;

  const q = (name: string) => dialect.quoteIdentifier(name);
  const args = (count: number) =>
    Array.from({ length: count }, (_, index) => dialect.placeholder(index + 1));

  return {
    slugify: slugifyHandle,
    disambiguate: disambiguateHandle,
    newId: () => randomUUID(),
    now,

    async recordTimeline(input) {
      const context = requireStoreContext(`${options.ownerEntity}.timeline`);
      const columns = [
        'id', 'store_id', 'owner_id', 'kind', 'actor_id', 'actor_label', 'message', 'changes',
      ];

      await options.executor.query(
        `INSERT INTO ${q(table)} (${columns.map(q).join(', ')})
         VALUES (${args(columns.length).join(', ')})`,
        [
          randomUUID(),
          context.storeId satisfies StoreId,
          input.ownerId,
          input.changes.length > 0 ? 'change' : 'system',
          context.userId satisfies UserId | null,
          context.userId ?? 'System',
          input.message,
          JSON.stringify(redactChanges(input.changes)),
        ],
      );
    },

    async emit(eventType, payload) {
      await options.events.emit(eventType, payload);
    },
  };
}
