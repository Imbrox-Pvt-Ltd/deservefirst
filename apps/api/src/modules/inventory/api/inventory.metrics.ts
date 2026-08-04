/**
 * Inventory · api/inventory.metrics.ts
 * The numbers this module puts on a dashboard.
 * Layer: api.
 */

import { countRows, type MetricProvider } from '../../../core/dashboard';
import type { QueryExecutor } from '../../../core/list-engine';
import type { SqlDialect } from '../../../core/list-engine/dialect';

export function inventoryMetrics(executor: QueryExecutor, dialect: SqlDialect): MetricProvider {
  return {
    moduleId: 'inventory',
    metrics: {
      // At or BELOW zero. A negative on-hand is evidence of an unrecorded
      // movement, and counting only exact zeroes would hide the rows most worth
      // looking at.
      outOfStock: countRows(executor, dialect, 'inventory_levels', { predicate: '`on_hand` <= 0' }),
      stockedPositions: countRows(executor, dialect, 'inventory_levels'),
      openPurchaseOrders: countRows(executor, dialect, 'purchase_orders', {
        predicate: "`status` IN ('ordered', 'partial')",
      }),
    },
  };
}
