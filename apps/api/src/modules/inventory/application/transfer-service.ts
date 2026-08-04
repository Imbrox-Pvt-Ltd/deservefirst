/**
 * Inventory · application/transfer-service.ts
 * Moving stock between locations: draft, ship, receive, cancel.
 *
 * A transfer moves stock, it never creates it. Receiving therefore produces a
 * matched pair of adjustments — out of the origin, into the destination — whose
 * deltas net to zero across the store.
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  adjustmentsForReceipt,
  assertTransferTransition,
  assertTransferValid,
  InventoryInvariantError,
  type Transfer,
  type TransferLine,
} from '../domain';
import type { InventoryService } from './inventory-service';
import { InventoryNotFoundError, type LocationRepository, type TransferRepository } from './ports';

export interface TransferLineInput {
  readonly productId: string;
  readonly variantId?: string | null;
  readonly title: string;
  readonly quantity: number;
}

export class TransferService {
  constructor(
    private readonly repository: TransferRepository,
    private readonly locations: LocationRepository,
    private readonly inventory: InventoryService,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<Transfer>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Transfer> {
    const transfer = await this.repository.findById(id);
    if (!transfer) throw new InventoryNotFoundError('transfer', id);
    return transfer;
  }

  async create(input: {
    originLocationId: string;
    destinationLocationId: string;
    lines?: readonly TransferLineInput[];
  }): Promise<Transfer> {
    for (const id of [input.originLocationId, input.destinationLocationId]) {
      if (!(await this.locations.findById(id))) throw new InventoryNotFoundError('location', id);
    }

    const transfer: Transfer = {
      id: this.toolkit.newId(),
      reference: await this.repository.nextReference(),
      originLocationId: input.originLocationId,
      destinationLocationId: input.destinationLocationId,
      status: 'draft',
      lines: (input.lines ?? []).map((line) => this.toLine(line)),
      version: 1,
    };

    assertTransferValid(transfer);
    const saved = await this.repository.insert(transfer);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `transfer ${saved.reference} created`,
      changes: [],
    });
    return saved;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: { lines?: readonly TransferLineInput[]; destinationLocationId?: string },
  ): Promise<Transfer> {
    const current = await this.get(id);
    if (current.status !== 'draft') {
      throw new InventoryInvariantError(
        'status',
        `a ${current.status} transfer cannot be edited — stock is already moving`,
      );
    }

    const next: Transfer = {
      ...current,
      destinationLocationId: patch.destinationLocationId ?? current.destinationLocationId,
      lines: patch.lines ? patch.lines.map((line) => this.toLine(line)) : current.lines,
      version: current.version + 1,
    };

    assertTransferValid(next);
    return this.repository.update(next, expectedVersion);
  }

  /**
   * Draft → in transit. Stock leaves the origin's AVAILABLE quantity now, not on
   * receipt: it is physically gone, and continuing to sell it is how a store
   * promises what it has already put on a lorry.
   */
  async ship(id: string, expectedVersion: number): Promise<Transfer> {
    const current = await this.get(id);
    assertTransferTransition(current.status, 'in-transit');

    const next: Transfer = { ...current, status: 'in-transit', version: current.version + 1 };
    assertTransferValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    for (const line of saved.lines) {
      await this.inventory.adjust({
        locationId: saved.originLocationId,
        productId: line.productId,
        variantId: line.variantId,
        delta: -line.quantity,
        reason: 'transfer-out',
        reference: saved.reference,
        title: line.title,
      });
    }

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `transfer ${saved.reference} shipped`,
      changes: [{ field: 'status', from: current.status, to: 'in-transit' }],
    });
    await this.toolkit.emit('inventory.transfer.shipped', {
      transferId: saved.id,
      reference: saved.reference,
      originLocationId: saved.originLocationId,
      destinationLocationId: saved.destinationLocationId,
    });
    return saved;
  }

  /**
   * Records what arrived. Shipping already removed the full quantity from the
   * origin, so receipt adds what arrived to the destination and returns any
   * shortfall to the origin — a box that never turned up is still the origin's
   * problem, and writing it off silently loses it from both ends.
   */
  async receive(
    id: string,
    expectedVersion: number,
    received: readonly { lineId: string; received: number }[],
  ): Promise<Transfer> {
    const current = await this.get(id);
    assertTransferTransition(current.status, 'received');

    const byLine = new Map(received.map((entry) => [entry.lineId, entry.received]));
    for (const lineId of byLine.keys()) {
      if (!current.lines.some((line) => line.id === lineId)) {
        throw new InventoryInvariantError('lines', `no line "${lineId}" on this transfer`);
      }
    }

    const lines = current.lines.map((line) => {
      const total = byLine.get(line.id);
      return total === undefined ? line : { ...line, receivedQuantity: total };
    });

    const next: Transfer = { ...current, lines, status: 'received', version: current.version + 1 };
    assertTransferValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    // The domain states the pair; the service only carries it out.
    for (const adjustment of adjustmentsForReceipt(saved, this.toolkit.now())) {
      // Shipping already took the full quantity out of the origin, so the
      // transfer-out half of the pair would remove it a second time. What is
      // owed back to the origin is only the shortfall.
      if (adjustment.reason === 'transfer-out') continue;
      if (adjustment.delta === 0) continue;

      await this.inventory.adjust({
        locationId: adjustment.locationId,
        productId: adjustment.productId,
        variantId: adjustment.variantId,
        delta: adjustment.delta,
        reason: adjustment.reason,
        reference: saved.reference,
        // Carried through so the destination's level is named. Without it the
        // first arrival at a new location creates a row titled "Untitled", and
        // the inventory list shows a quantity against nothing recognisable.
        title: titleFor(saved, adjustment.productId, adjustment.variantId),
      });
    }

    for (const line of saved.lines) {
      const missing = line.quantity - line.receivedQuantity;
      if (missing === 0) continue;
      await this.inventory.adjust({
        locationId: saved.originLocationId,
        productId: line.productId,
        variantId: line.variantId,
        delta: missing,
        reason: 'correction',
        reference: `${saved.reference} shortfall`,
        title: line.title,
      });
    }

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `transfer ${saved.reference} received`,
      changes: [{ field: 'status', from: current.status, to: 'received' }],
    });
    return saved;
  }

  async cancel(id: string, expectedVersion: number): Promise<Transfer> {
    const current = await this.get(id);
    assertTransferTransition(current.status, 'cancelled');

    const next: Transfer = { ...current, status: 'cancelled', version: current.version + 1 };
    const saved = await this.repository.update(next, expectedVersion);

    // Cancelling a shipped transfer returns the stock to where it left, because
    // it never arrived anywhere else.
    if (current.status === 'in-transit') {
      for (const line of saved.lines) {
        await this.inventory.adjust({
          locationId: saved.originLocationId,
          productId: line.productId,
          variantId: line.variantId,
          delta: line.quantity,
          reason: 'correction',
          reference: `${saved.reference} cancelled`,
          title: line.title,
        });
      }
    }

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `transfer ${saved.reference} cancelled`,
      changes: [{ field: 'status', from: current.status, to: 'cancelled' }],
    });
    return saved;
  }

  private toLine(input: TransferLineInput): TransferLine {
    return {
      id: this.toolkit.newId(),
      productId: input.productId,
      variantId: input.variantId ?? null,
      title: input.title,
      quantity: input.quantity,
      receivedQuantity: 0,
    };
  }
}

/** The line a generated adjustment came from, for its display title. */
function titleFor(transfer: Transfer, productId: string, variantId: string | null): string | undefined {
  return transfer.lines.find(
    (line) => line.productId === productId && line.variantId === variantId,
  )?.title;
}
