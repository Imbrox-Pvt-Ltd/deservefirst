/**
 * Catalog · api/catalog.metrics.ts
 * The numbers this module puts on a dashboard.
 *
 * Owned here rather than queried by Core: what "active" means for a product is
 * catalog's business, and a dashboard that reached into these tables directly
 * would be the one place the module boundary is crossed for convenience.
 * Layer: api.
 */

import { countRows, type MetricProvider } from '../../../core/dashboard';
import type { QueryExecutor } from '../../../core/list-engine';
import type { SqlDialect } from '../../../core/list-engine/dialect';

export function catalogMetrics(executor: QueryExecutor, dialect: SqlDialect): MetricProvider {
  return {
    moduleId: 'catalog',
    metrics: {
      activeProducts: countRows(executor, dialect, 'products', { where: { status: 'active' } }),
      draftProducts: countRows(executor, dialect, 'products', { where: { status: 'draft' } }),
      // Archived products are excluded: they are not part of the catalogue any
      // more, and counting them makes the number grow as things are retired.
      totalProducts: countRows(executor, dialect, 'products', {
        predicate: "`status` <> 'archived'",
      }),
      totalCollections: countRows(executor, dialect, 'collections'),
    },
  };
}
