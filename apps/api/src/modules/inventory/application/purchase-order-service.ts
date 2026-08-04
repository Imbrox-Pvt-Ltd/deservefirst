/**
 * Inventory · application/purchase-order-service.ts
 * Use-cases for purchase orders: draft, order, receive, cancel.
 *
 * Receiving is the only operation that touches stock, and it does so through the
 * inventory service rather than writing levels directly — so a received purchase
 * order leaves the same audit trail as any other movement.
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  assertPurchaseOrderValid,
  deriveStatus,
  InventoryInvariantError,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from '../domain';
import type { InventoryService } from './inventory-service';
import { InventoryNotFoundError, type LocationRepository, type PurchaseOrderRepository } from './ports';

export interface PurchaseOrderLineInput {
  readonly productId: string;
  readonly variantId?: string | null;
  readonly title: string;
  readonly ordered: number;
}

export class PurchaseOrderService {
  constructor(
    private readonly repository: PurchaseOrderRepository,
    private readonly locations: LocationRepository,
    private readonly inventory: InventoryService,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<PurchaseOrder>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<PurchaseOrder> {
    const order = await this.repository.findById(id);
    if (!order) throw new InventoryNotFoundError('purchase order', id);
    return order;
  }

  async create(input: {
    supplierName: string;
    destinationLocationId: string;
    expectedAt?: string | null;
    lines?: readonly PurchaseOrderLineInput[];
  }): Promise<PurchaseOrder> {
    const location = await this.locations.findById(input.destinationLocationId);
    if (!location) throw new InventoryNotFoundError('location', input.destinationLocationId);

    const order: PurchaseOrder = {
      id: this.toolkit.newId(),
      reference: await this.repository.nextReference(),
      supplierName: input.supplierName,
      destinationLocationId: input.destinationLocationId,
      status: 'draft',
      expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
      lines: (input.lines ?? []).map((line) => this.toLine(line)),
      version: 1,
    };

    assertPurchaseOrderValid(order);
    const saved = await this.repository.insert(order);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `purchase order ${saved.reference} created for ${saved.supplierName}`,
      changes: [],
    });
    return saved;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: {
      supplierName?: string;
      expectedAt?: string | null;
      lines?: readonly PurchaseOrderLineInput[];
    },
  ): Promise<PurchaseOrder> {
    const current = await this.get(id);

    if (current.status === 'received' || current.status === 'cancelled') {
      throw new InventoryInvariantError('status', `a ${current.status} purchase order cannot be edited`);
    }

    // Lines are replaced wholesale and get fresh ids, which would silently reset
    // every `received` count to zero — stock that physically arrived would still
    // be on the shelf but no longer on the order. Once anything has been
    // ordered, the line set is fixed and only receiving changes it.
    if (patch.lines && current.status !== 'draft') {
      throw new InventoryInvariantError(
        'lines',
        `lines cannot be changed once a purchase order is ${current.status} — cancel it and raise another`,
      );
    }

    const next: PurchaseOrder = {
      ...current,
      supplierName: patch.supplierName ?? current.supplierName,
      expectedAt:
        patch.expectedAt === undefined
          ? current.expectedAt
          : patch.expectedAt === null
            ? null
            : new Date(patch.expectedAt),
      lines: patch.lines ? patch.lines.map((line) => this.toLine(line)) : current.lines,
      version: current.version + 1,
    };

    assertPurchaseOrderValid(next);
    return this.repository.update(next, expectedVersion);
  }

  /** Draft → ordered. The point at which the supplier has actually been told. */
  async place(id: string, expectedVersion: number): Promise<PurchaseOrder> {
    const current = await this.get(id);
    if (current.status !== 'draft') {
      throw new InventoryInvariantError('status', `only a draft can be ordered, not a ${current.status} one`);
    }

    const next: PurchaseOrder = { ...current, status: 'ordered', version: current.version + 1 };
    assertPurchaseOrderValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `purchase order ${saved.reference} placed with ${saved.supplierName}`,
      changes: [{ field: 'status', from: 'draft', to: 'ordered' }],
    });
    await this.toolkit.emit('inventory.purchase-order.placed', {
      purchaseOrderId: saved.id,
      reference: saved.reference,
      supplierName: saved.supplierName,
    });
    return saved;
  }

  /**
   * Records what physically arrived, line by line, and adds it to stock.
   *
   * Quantities are cumulative totals received, not increments, because that is
   * what the receiving screen shows and what a second person re-checking the
   * delivery would type. Sending increments would double-count every time
   * someone submitted the form twice.
   */
  async receive(
    id: string,
    expectedVersion: number,
    received: readonly { lineId: string; received: number }[],
  ): Promise<PurchaseOrder> {
    const current = await this.get(id);
    if (current.status !== 'ordered' && current.status !== 'partial') {
      throw new InventoryInvariantError(
        'status',
        `a ${current.status} purchase order cannot receive stock`,
      );
    }

    const byLine = new Map(received.map((entry) => [entry.lineId, entry.received]));
    for (const lineId of byLine.keys()) {
      if (!current.lines.some((line) => line.id === lineId)) {
        throw new InventoryInvariantError('lines', `no line "${lineId}" on this purchase order`);
      }
    }

    const lines = current.lines.map((line) => {
      const total = byLine.get(line.id);
      return total === undefined ? line : { ...line, received: total };
    });

    const withLines: PurchaseOrder = { ...current, lines, version: current.version + 1 };
    // Validated BEFORE any stock moves: an over-receipt must not leave half the
    // delivery in the level table and the order refusing to save.
    assertPurchaseOrderValid(withLines);

    const next: PurchaseOrder = { ...withLines, status: deriveStatus(withLines) };
    const saved = await this.repository.update(next, expectedVersion);

    for (const line of lines) {
      const before = current.lines.find((entry) => entry.id === line.id);
      const delta = line.received - (before?.received ?? 0);
      if (delta === 0) continue;

      await this.inventory.adjust({
        locationId: saved.destinationLocationId,
        productId: line.productId,
        variantId: line.variantId,
        delta,
        reason: 'received',
        reference: saved.reference,
        title: line.title,
      });
    }

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `stock received against ${saved.reference}`,
      changes: [{ field: 'status', from: current.status, to: saved.status }],
    });
    return saved;
  }

  async cancel(id: string, expectedVersion: number): Promise<PurchaseOrder> {
    const current = await this.get(id);
    if (current.status === 'received') {
      throw new InventoryInvariantError(
        'status',
        'a received purchase order cannot be cancelled — return the stock instead',
      );
    }

    const next: PurchaseOrder = { ...current, status: 'cancelled', version: current.version + 1 };
    const saved = await this.repository.update(next, expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `purchase order ${saved.reference} cancelled`,
      changes: [{ field: 'status', from: current.status, to: 'cancelled' }],
    });
    return saved;
  }

  private toLine(input: PurchaseOrderLineInput): PurchaseOrderLine {
    return {
      id: this.toolkit.newId(),
      productId: input.productId,
      variantId: input.variantId ?? null,
      title: input.title,
      ordered: input.ordered,
      received: 0,
    };
  }
}
