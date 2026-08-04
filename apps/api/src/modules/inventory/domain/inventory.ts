/**
 * Inventory · domain/inventory.ts
 * Locations, stock levels, purchase orders and transfers.
 *
 * The central idea is that on-hand is never written directly — it is derived
 * from adjustments, and every adjustment carries a reason. A settable quantity
 * field looks simpler right up to the first time two people set it at once and
 * nobody can say what happened.
 * Layer: domain (pure).
 */

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly countryCode: string;
  /** Whether stock here can be sold. A warehouse may hold stock but not fulfil. */
  readonly fulfilsOrders: boolean;
  readonly archivedAt: Date | null;
}

export type AdjustmentReason =
  | 'received'
  | 'sold'
  | 'returned'
  | 'damaged'
  | 'shrinkage'
  | 'recount'
  | 'transfer-in'
  | 'transfer-out'
  | 'correction';

export interface InventoryAdjustment {
  readonly id: string;
  readonly locationId: string;
  readonly productId: string;
  readonly variantId: string | null;
  /** Signed. Negative removes stock. */
  readonly delta: number;
  readonly reason: AdjustmentReason;
  readonly reference: string | null;
  readonly occurredAt: Date;
}

/** The derived view: what is on hand, and how much of it is spoken for. */
export interface InventoryLevel {
  readonly locationId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly onHand: number;
  /** Reserved by open requests. Not yet gone, but not sellable either. */
  readonly committed: number;
  readonly incoming: number;
}

export class InventoryInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'InventoryInvariantError';
  }
}

/** What can actually be sold right now. Never negative, even if the data is. */
export function available(level: InventoryLevel): number {
  return Math.max(0, level.onHand - level.committed);
}

export function applyAdjustment(level: InventoryLevel, adjustment: InventoryAdjustment): InventoryLevel {
  if (!Number.isInteger(adjustment.delta)) {
    throw new InventoryInvariantError('delta', 'must be a whole number of units');
  }
  if (adjustment.delta === 0) {
    throw new InventoryInvariantError('delta', 'a zero adjustment records nothing');
  }

  const onHand = level.onHand + adjustment.delta;

  // Negative on-hand is allowed and deliberately so: it is what an unrecorded
  // sale or a miscount looks like, and hiding it by clamping to zero would
  // destroy the evidence a recount needs.
  return { ...level, onHand };
}

export function assertLocationValid(location: Location): void {
  if (location.name.trim().length === 0) {
    throw new InventoryInvariantError('name', 'is required');
  }
  if (!/^[A-Z]{2}$/.test(location.countryCode)) {
    throw new InventoryInvariantError('countryCode', 'needs a two-letter ISO country code');
  }
}

// --- purchase orders --------------------------------------------------------

export type PurchaseOrderStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrderLine {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string;
  readonly ordered: number;
  readonly received: number;
}

export interface PurchaseOrder {
  readonly id: string;
  readonly reference: string;
  readonly supplierName: string;
  readonly destinationLocationId: string;
  readonly status: PurchaseOrderStatus;
  readonly expectedAt: Date | null;
  readonly lines: readonly PurchaseOrderLine[];
  readonly version: number;
}

export function assertPurchaseOrderValid(order: PurchaseOrder): void {
  if (order.supplierName.trim().length === 0) {
    throw new InventoryInvariantError('supplierName', 'is required');
  }
  if (order.status !== 'draft' && order.lines.length === 0) {
    throw new InventoryInvariantError('lines', 'an ordered purchase order needs at least one line');
  }

  for (const line of order.lines) {
    if (!Number.isInteger(line.ordered) || line.ordered < 1) {
      throw new InventoryInvariantError('lines', `"${line.title}" must order at least one unit`);
    }
    if (line.received < 0) {
      throw new InventoryInvariantError('lines', `"${line.title}" cannot have received a negative quantity`);
    }
    // Over-receiving is a real event — suppliers ship extra — but it must be
    // recorded deliberately rather than as an unnoticed off-by-N.
    if (line.received > line.ordered) {
      throw new InventoryInvariantError(
        'lines',
        `"${line.title}" received ${line.received} of ${line.ordered} ordered — record the surplus as a separate adjustment`,
      );
    }
  }
}

/** Status derived from the lines, so it cannot disagree with them. */
export function deriveStatus(order: PurchaseOrder): PurchaseOrderStatus {
  if (order.status === 'draft' || order.status === 'cancelled') return order.status;

  const total = order.lines.reduce((sum, line) => sum + line.ordered, 0);
  const received = order.lines.reduce((sum, line) => sum + line.received, 0);

  if (received === 0) return 'ordered';
  if (received >= total) return 'received';
  return 'partial';
}

// --- transfers --------------------------------------------------------------

export type TransferStatus = 'draft' | 'in-transit' | 'received' | 'cancelled';

export interface TransferLine {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string;
  readonly quantity: number;
  readonly receivedQuantity: number;
}

export interface Transfer {
  readonly id: string;
  readonly reference: string;
  readonly originLocationId: string;
  readonly destinationLocationId: string;
  readonly status: TransferStatus;
  readonly lines: readonly TransferLine[];
  readonly version: number;
}

export function assertTransferValid(transfer: Transfer): void {
  if (transfer.originLocationId === transfer.destinationLocationId) {
    throw new InventoryInvariantError('destinationLocationId', 'a transfer needs two different locations');
  }
  if (transfer.status !== 'draft' && transfer.lines.length === 0) {
    throw new InventoryInvariantError('lines', 'a transfer in transit needs at least one line');
  }

  for (const line of transfer.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new InventoryInvariantError('lines', `"${line.title}" must move at least one unit`);
    }
    if (line.receivedQuantity > line.quantity) {
      throw new InventoryInvariantError(
        'lines',
        `"${line.title}" received more than was sent — the difference is a separate adjustment, not a transfer`,
      );
    }
  }
}

/**
 * Units that have left the origin but not arrived. Stock in transit belongs to
 * neither location's available quantity, and treating it as arrived is how a
 * store oversells a shipment that is still on a lorry.
 */
export function inTransit(transfer: Transfer): number {
  if (transfer.status !== 'in-transit') return 0;
  return transfer.lines.reduce((sum, line) => sum + (line.quantity - line.receivedQuantity), 0);
}

const TRANSFER_TRANSITIONS: Readonly<Record<TransferStatus, readonly TransferStatus[]>> = {
  draft: ['in-transit', 'cancelled'],
  'in-transit': ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

export function assertTransferTransition(from: TransferStatus, to: TransferStatus): void {
  if (from === to) return;
  if (!TRANSFER_TRANSITIONS[from].includes(to)) {
    throw new InventoryInvariantError('status', `a transfer cannot move from ${from} to ${to}`);
  }
}

/** The adjustments a completed transfer produces: out of origin, into destination. */
export function adjustmentsForReceipt(
  transfer: Transfer,
  now: Date,
): Omit<InventoryAdjustment, 'id'>[] {
  return transfer.lines.flatMap((line) => [
    {
      locationId: transfer.originLocationId,
      productId: line.productId,
      variantId: line.variantId,
      delta: -line.receivedQuantity,
      reason: 'transfer-out' as const,
      reference: transfer.reference,
      occurredAt: now,
    },
    {
      locationId: transfer.destinationLocationId,
      productId: line.productId,
      variantId: line.variantId,
      delta: line.receivedQuantity,
      reason: 'transfer-in' as const,
      reference: transfer.reference,
      occurredAt: now,
    },
  ]);
}
