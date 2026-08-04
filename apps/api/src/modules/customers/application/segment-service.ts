/**
 * Customers · application/segment-service.ts
 * Segments: stored questions, answered on demand.
 *
 * Membership is never stored. Asking for a segment's customers runs its
 * conditions through the SAME list engine a hand-typed filter uses, so the two
 * can never disagree — and a segment is never stale, because there is nothing
 * to go stale.
 * Layer: application.
 */

import { type Connection, type ListQuery, parseListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  assertSegmentValid,
  CustomerInvariantError,
  segmentQueries,
  type Customer,
  type Segment,
  type SegmentCondition,
} from '../domain';
import type { CustomerRepository } from './customer-service';

export interface SegmentRepository {
  findById(id: string): Promise<Segment | null>;
  list(query: ListQuery): Promise<Connection<Segment>>;
  insert(segment: Segment): Promise<Segment>;
  update(segment: Segment, expectedVersion: number): Promise<Segment>;
  softDelete(id: string): Promise<void>;
}

export class SegmentNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No segment with id "${id}" in this store.`);
    this.name = 'SegmentNotFoundError';
  }
}

export class SegmentService {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly customers: CustomerRepository,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<Segment>> {
    return this.segments.list(query);
  }

  async get(id: string): Promise<Segment> {
    const segment = await this.segments.findById(id);
    if (!segment) throw new SegmentNotFoundError(id);
    return segment;
  }

  async create(input: {
    name: string;
    match?: Segment['match'];
    conditions: readonly SegmentCondition[];
  }): Promise<Segment> {
    const segment: Segment = {
      id: this.toolkit.newId(),
      name: input.name,
      match: input.match ?? 'all',
      conditions: input.conditions,
      version: 1,
    };

    assertSegmentValid(segment);
    return this.segments.insert(segment);
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: { name?: string; match?: Segment['match']; conditions?: readonly SegmentCondition[] },
  ): Promise<Segment> {
    const current = await this.get(id);
    const next: Segment = {
      ...current,
      name: patch.name ?? current.name,
      match: patch.match ?? current.match,
      conditions: patch.conditions ?? current.conditions,
      version: current.version + 1,
    };

    assertSegmentValid(next);
    return this.segments.update(next, expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.segments.softDelete(id);
  }

  /**
   * The customers in a segment, right now.
   *
   * `all` is one query, because the list engine ANDs its tokens. `any` is one
   * query per condition, merged here by id — the engine has no OR, and faking
   * one by concatenating tokens would quietly return the INTERSECTION, which is
   * the wrong people delivered confidently.
   */
  async members(
    segment: Pick<Segment, 'match' | 'conditions'>,
    limit = 50,
  ): Promise<readonly Customer[]> {
    const queries = segmentQueries(segment);
    const found = new Map<string, Customer>();

    for (const query of queries) {
      const connection = await this.customers.list(
        parseListQuery(new URLSearchParams({ query, limit: String(limit) })),
      );
      for (const customer of connection.nodes) {
        if (!found.has(customer.id)) found.set(customer.id, customer);
      }
      // A union cannot be cut short at the limit until every branch has run, so
      // the cap is applied after merging rather than per query.
      if (queries.length === 1) break;
    }

    return [...found.values()].slice(0, limit);
  }

  /**
   * How many customers a segment currently matches.
   *
   * Deliberately counted from the members rather than a COUNT query: a union
   * cannot be counted without materialising it, and a number that disagreed
   * with the list beneath it would be worse than a slower one. The cap is
   * reported so a large answer is visibly a floor rather than a fact.
   */
  async size(
    segment: Pick<Segment, 'match' | 'conditions'>,
    cap = 500,
  ): Promise<{ count: number; capped: boolean }> {
    const members = await this.members(segment, cap);
    return { count: members.length, capped: members.length >= cap };
  }

  /** Validates a draft before it is saved, so the builder can preview it. */
  assertDraftValid(match: Segment['match'], conditions: readonly SegmentCondition[]): void {
    if (conditions.length === 0) {
      throw new CustomerInvariantError('segment', 'needs at least one condition');
    }
    assertSegmentValid({ id: 'draft', name: 'draft', match, conditions, version: 1 });
  }
}
