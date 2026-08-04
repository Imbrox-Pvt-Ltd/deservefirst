/**
 * Orders · api/orders.metrics.ts
 * The numbers this module puts on a dashboard.
 * Layer: api.
 */

import { countRows, type MetricProvider } from '../../../core/dashboard';
import type { QueryExecutor } from '../../../core/list-engine';
import type { SqlDialect } from '../../../core/list-engine/dialect';

export function ordersMetrics(executor: QueryExecutor, dialect: SqlDialect): MetricProvider {
  return {
    moduleId: 'orders',
    metrics: {
      // Submitted and not yet priced — the queue a merchant is actually paid to
      // work through, which is why it sorts first on the home slot.
      awaitingQuote: countRows(executor, dialect, 'requests', { where: { status: 'submitted' } }),
      quotedAwaitingAnswer: countRows(executor, dialect, 'requests', { where: { status: 'quoted' } }),
      acceptedRequests: countRows(executor, dialect, 'requests', { where: { status: 'accepted' } }),
      declinedRequests: countRows(executor, dialect, 'requests', { where: { status: 'declined' } }),
    },
  };
}
