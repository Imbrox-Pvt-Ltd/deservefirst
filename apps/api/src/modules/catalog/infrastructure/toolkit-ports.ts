/**
 * Catalog · infrastructure/toolkit-ports.ts
 * Wires the ToolkitPorts the ProductService declares to real implementations:
 * Core's slug service, the timeline table, and the event bus. The service stays
 * unaware of any of it — that is what lets it be tested with fakes and reused
 * from a worker.
 * Layer: infrastructure.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId, UserId } from '@deservefirst/contracts';

import type { EventBus } from '../../../core/event-bus/event-bus';
import { disambiguateHandle, redactChanges, slugifyHandle } from '../../../core/entity-toolkit';
import type { QueryExecutor } from '../../../core/list-engine';
import { type SqlDialect, postgresDialect } from '../../../core/list-engine/dialect';
import { requireStoreContext } from '../../../core/tenant-context';
import type { ToolkitPorts } from '../application';

export interface ToolkitPortsOptions {
  readonly executor: QueryExecutor;
  readonly events: EventBus;
  readonly dialect?: SqlDialect;
  readonly ownerEntity: string;
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
  const table = `${options.ownerEntity.toLowerCase()}s_timeline`;

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
