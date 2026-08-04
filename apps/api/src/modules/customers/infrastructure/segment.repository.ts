/**
 * Customers · infrastructure/segment.repository.ts
 * Persistence for segments — the stored question, never its answer.
 *
 * There is deliberately no membership table. Adding one is the obvious
 * optimisation and the reason segments elsewhere go stale: the moment membership
 * is stored, something has to keep it true, and nothing ever does for long.
 * Layer: infrastructure.
 */

import { type ResourceDefinition } from '@deservefirst/contracts';

import { SqlAggregateRepository, parseJsonArray } from '../../../core/database';
import { segmentResource } from '../contracts';
import type { Segment, SegmentCondition } from '../domain';
import type { SegmentRepository } from '../application';

interface SegmentRow extends Record<string, unknown> {
  id: string;
  name: string;
  match: string;
  conditions: unknown;
  version: number;
}

export class SqlSegmentRepository
  extends SqlAggregateRepository<Segment, SegmentRow>
  implements SegmentRepository
{
  protected readonly tableName = 'customer_segments';
  protected readonly resource: ResourceDefinition = segmentResource;
  protected readonly operation = 'customers.segments';

  protected toDomain(row: SegmentRow): Segment {
    return {
      id: row.id,
      name: row.name,
      match: (row.match as Segment['match']) ?? 'all',
      conditions: parseJsonArray<SegmentCondition>(row.conditions),
      version: Number(row.version),
    };
  }

  protected toColumns(entity: Segment): Record<string, unknown> {
    return {
      handle: entity.id,
      name: entity.name,
      match: entity.match,
      conditions: JSON.stringify(entity.conditions),
    };
  }
}
