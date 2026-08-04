/**
 * Inventory · application/inventory-service.ts
 * Stock levels and the adjustments that move them.
 *
 * Every quantity change goes through `adjust`. There is no setter, because a
 * setter cannot say WHY the number changed, and "why" is the only thing that
 * makes a stock discrepancy solvable six weeks later.
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  applyAdjustment,
  available,
  type AdjustmentReason,
  type InventoryAdjustment,
  InventoryInvariantError,
} from '../domain';
import {
  type AdjustmentRepository,
  InventoryNotFoundError,
  type LevelRepository,
  type LocationRepository,
  type StoredLevel,
  type StoredLocation,
} from './ports';

export interface AdjustInput {
  readonly locationId: string;
  readonly productId: string;
  readonly variantId?: string | null;
  readonly delta: number;
  readonly reason: AdjustmentReason;
  readonly reference?: string | null;
  /** Present when the merchant typed a count rather than a delta. */
  readonly title?: string;
  readonly sku?: string | null;
}

export class InventoryService {
  constructor(
    private readonly levels: LevelRepository,
    private readonly adjustments: AdjustmentRepository,
    private readonly locations: LocationRepository,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<StoredLevel>> {
    return this.levels.list(query);
  }

  async locationsForPicker(): Promise<readonly StoredLocation[]> {
    return this.locations.active();
  }

  async get(id: string): Promise<StoredLevel> {
    const level = await this.levels.findById(id);
    if (!level) throw new InventoryNotFoundError('inventory level', id);
    return level;
  }

  async history(locationId: string, productId: string): Promise<readonly InventoryAdjustment[]> {
    return this.adjustments.history(locationId, productId);
  }

  /**
   * Records a movement and moves the level with it.
   *
   * The adjustment is appended FIRST. If the projection write then fails, the
   * log still holds the truth and the level can be rebuilt; the reverse order
   * would leave a quantity nobody can account for, which is the worse of the two
   * failures.
   */
  async adjust(input: AdjustInput): Promise<StoredLevel> {
    const location = await this.locations.findById(input.locationId);
    if (!location) throw new InventoryNotFoundError('location', input.locationId);
    if (location.archivedAt) {
      throw new InventoryInvariantError('locationId', `"${location.name}" is archived and cannot hold stock`);
    }

    const variantId = input.variantId ?? null;
    const existing = await this.levels.find(input.locationId, input.productId, variantId);

    const level: StoredLevel = existing ?? {
      id: this.toolkit.newId(),
      locationId: input.locationId,
      productId: input.productId,
      variantId,
      title: input.title ?? 'Untitled',
      sku: input.sku ?? null,
      onHand: 0,
      committed: 0,
      incoming: 0,
      version: 1,
    };

    const adjustment = await this.adjustments.append({
      locationId: input.locationId,
      productId: input.productId,
      variantId,
      delta: input.delta,
      reason: input.reason,
      reference: input.reference ?? null,
      occurredAt: this.toolkit.now(),
    });

    const moved = applyAdjustment(level, adjustment);
    const next: StoredLevel = { ...level, ...moved, version: level.version + 1 };

    const saved = existing
      ? await this.levels.update(next, level.version)
      : await this.levels.insert(next);

    await this.toolkit.emit('inventory.level.adjusted', {
      productId: saved.productId,
      variantId: saved.variantId,
      locationId: saved.locationId,
      delta: adjustment.delta,
      reason: adjustment.reason,
      onHandAfter: saved.onHand,
    });

    return saved;
  }

  /**
   * Sets on hand to a counted figure by recording the DIFFERENCE as a recount.
   * A stocktake produces a number, not a movement, and this is where the two
   * meet — the log still ends up holding a signed delta with a reason.
   */
  async recount(input: Omit<AdjustInput, 'delta' | 'reason'> & { onHand: number }): Promise<StoredLevel> {
    if (!Number.isInteger(input.onHand)) {
      throw new InventoryInvariantError('onHand', 'must be a whole number of units');
    }

    const current = await this.levels.find(
      input.locationId,
      input.productId,
      input.variantId ?? null,
    );
    const delta = input.onHand - (current?.onHand ?? 0);

    if (delta === 0) {
      // Nothing moved. Recording a zero adjustment would add a row that says
      // "the count was already right", which the domain rejects anyway.
      if (current) return current;
      throw new InventoryInvariantError('onHand', 'there is nothing to count at this location yet');
    }

    return this.adjust({ ...input, delta, reason: 'recount' });
  }

  /** What can be sold right now, for a level the caller already has. */
  availableFor(level: StoredLevel): number {
    return available(level);
  }
}
