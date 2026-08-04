/**
 * Catalog · application/collection-service.ts
 * Use-cases for the Collection aggregate. Rule changes are validated before they
 * are stored, so an automated collection can never hold a rule the engine would
 * refuse to evaluate.
 * Layer: application.
 */

import { type Connection, type ListQuery, type StoreId } from '@deservefirst/contracts';

import {
  assertCollectionValid,
  type Collection,
  CollectionInvariantError,
  type Condition,
  type ConditionMatch,
} from '../domain';
import type { ToolkitPorts } from './product-service';

export interface CollectionRepository {
  findById(id: string): Promise<Collection | null>;
  takenHandles(prefix: string): Promise<ReadonlySet<string>>;
  list(query: ListQuery): Promise<Connection<Collection>>;
  insert(collection: Collection): Promise<Collection>;
  update(collection: Collection, expectedVersion: number): Promise<Collection>;
  softDelete(id: string): Promise<void>;
}

export class CollectionNotFoundError extends Error {
  readonly status = 404;
  constructor(readonly id: string) {
    super(`No collection with id "${id}" in this store.`);
    this.name = 'CollectionNotFoundError';
  }
}

export class CollectionService {
  constructor(
    private readonly repository: CollectionRepository,
    private readonly toolkit: ToolkitPorts,
    private readonly storeId: StoreId,
  ) {}

  async list(query: ListQuery): Promise<Connection<Collection>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Collection> {
    const collection = await this.repository.findById(id);
    if (!collection) throw new CollectionNotFoundError(id);
    return collection;
  }

  async create(input: {
    title: string;
    description?: string;
    handle?: string;
    type: Collection['type'];
  }): Promise<Collection> {
    const base = this.toolkit.slugify(input.handle ?? input.title);
    const taken = await this.repository.takenHandles(base);

    const collection: Collection = {
      id: this.toolkit.newId(),
      handle: this.toolkit.disambiguate(base, taken),
      title: input.title,
      description: input.description ?? '',
      type: input.type,
      match: 'all',
      // An automated collection needs a rule to be valid, so a new one starts
      // manual and becomes automated when its first condition is added.
      conditions: [],
      exclusions: [],
      productIds: [],
      sortOrder: 'manual',
      version: 1,
    };

    const seeded: Collection =
      input.type === 'automated'
        ? { ...collection, type: 'manual' }
        : collection;

    assertCollectionValid(seeded);
    const saved = await this.repository.insert(seeded);
    await this.toolkit.recordTimeline({ ownerId: saved.id, message: 'created this collection', changes: [] });
    return saved;
  }

  async updateDetails(input: {
    id: string;
    expectedVersion: number;
    title?: string;
    description?: string;
    sortOrder?: Collection['sortOrder'];
  }): Promise<Collection> {
    const existing = await this.get(input.id);
    const next: Collection = {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      version: existing.version + 1,
    };
    assertCollectionValid(next);
    return this.repository.update(next, input.expectedVersion);
  }

  /**
   * Replaces the rule set wholesale. Rules are edited as a group in the UI, and
   * a per-condition API would let a screen leave the collection in a state the
   * engine cannot evaluate between two calls.
   */
  async setRules(input: {
    id: string;
    expectedVersion: number;
    match: ConditionMatch;
    conditions: readonly Condition[];
    exclusions: readonly Condition[];
  }): Promise<Collection> {
    const existing = await this.get(input.id);

    if (existing.type === 'manual' && input.conditions.length > 0 && existing.productIds.length > 0) {
      throw new CollectionInvariantError(
        'conditions',
        'this collection has manual members — remove them before making it automated',
      );
    }

    const next: Collection = {
      ...existing,
      // Adding the first condition is what makes a collection automated; the
      // merchant does not choose a type separately from choosing rules.
      type: input.conditions.length > 0 ? 'automated' : 'manual',
      match: input.match,
      conditions: input.conditions,
      exclusions: input.conditions.length > 0 ? input.exclusions : [],
      version: existing.version + 1,
    };

    assertCollectionValid(next);
    const saved = await this.repository.update(next, input.expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message:
        input.conditions.length === 0
          ? 'removed all conditions — this collection is now manual'
          : `set ${input.conditions.length} condition(s) and ${input.exclusions.length} exclusion(s)`,
      changes: [],
    });
    return saved;
  }

  /** Manual membership. Refused on an automated collection: two sources of truth. */
  async setProducts(input: {
    id: string;
    expectedVersion: number;
    productIds: readonly string[];
  }): Promise<Collection> {
    const existing = await this.get(input.id);
    if (existing.type === 'automated') {
      throw new CollectionInvariantError(
        'productIds',
        'this collection is automated — its members come from its conditions',
      );
    }

    const next: Collection = {
      ...existing,
      productIds: [...new Set(input.productIds)],
      version: existing.version + 1,
    };
    assertCollectionValid(next);
    return this.repository.update(next, input.expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.repository.softDelete(id);
  }

  get scope(): StoreId {
    return this.storeId;
  }
}
