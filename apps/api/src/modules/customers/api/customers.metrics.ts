/**
 * Customers · api/customers.metrics.ts
 * The numbers this module puts on a dashboard.
 * Layer: api.
 */

import { countRows, type MetricProvider } from '../../../core/dashboard';
import type { QueryExecutor } from '../../../core/list-engine';
import type { SqlDialect } from '../../../core/list-engine/dialect';

export function customersMetrics(executor: QueryExecutor, dialect: SqlDialect): MetricProvider {
  return {
    moduleId: 'customers',
    metrics: {
      totalCustomers: countRows(executor, dialect, 'customers'),
    },
  };
}
