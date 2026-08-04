/**
 * Web · lib/receiving.ts
 * Normalises purchase orders and transfers into the one shape their shared
 * screen renders.
 *
 * These are plain functions and they live OUTSIDE the component file on purpose.
 * Exporting them from a `'use client'` module made them client references: the
 * build succeeded, and every request to the detail page failed at render with
 * "attempted to call purchaseOrderLines() from the server". A pure mapper has no
 * reason to be part of a client boundary.
 * Layer: web/lib.
 */

import type { PurchaseOrderDto, TransferDto } from './types';

/** A line as the receiving screen sees it, whatever it came from. */
export interface ReceivingLine {
  readonly id: string;
  readonly title: string;
  /** Ordered, or being sent. */
  readonly expected: number;
  readonly received: number;
}

export function purchaseOrderLines(order: PurchaseOrderDto): ReceivingLine[] {
  return order.lines.map((line) => ({
    id: line.id,
    title: line.title,
    expected: line.ordered,
    received: line.received,
  }));
}

export function transferLines(transfer: TransferDto): ReceivingLine[] {
  return transfer.lines.map((line) => ({
    id: line.id,
    title: line.title,
    expected: line.quantity,
    received: line.receivedQuantity,
  }));
}
