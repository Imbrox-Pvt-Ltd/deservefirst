'use server';

/**
 * Web · app/actions/inventory.ts
 * Server actions for stock movements, purchase orders and transfers.
 *
 * Every one of these carries a `version`, because every one of them is something
 * two people can do to the same record at the same time — a delivery being
 * booked in by one person while another cancels the order is not a hypothetical.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import { storeIdFor } from '../../lib/stores';
import type { InventoryLevelDto, PurchaseOrderDto, TransferDto } from '../../lib/types';

const PERMISSIONS = ['inventory.read', 'inventory.adjust', 'inventory.manage'];

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly conflict?: boolean;
}

async function call<T>(
  handle: string,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  revalidate: readonly string[],
): Promise<ActionResult<T>> {
  try {
    const response = await apiFetch<T>(
      path,
      { storeId: storeIdFor(handle), permissions: PERMISSIONS },
      { method, body: JSON.stringify(body) },
    );
    for (const path of revalidate) revalidatePath(`/store/${handle}${path}`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      // A conflict is the client's to resolve by reloading, so it is reported
      // separately rather than as a generic failure.
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/** Moves stock by a signed delta, with the reason it moved. */
export async function adjustStock(
  handle: string,
  input: {
    locationId: string;
    productId: string;
    variantId?: string | null;
    delta: number;
    reason: string;
    reference?: string | null;
    title?: string;
  },
) {
  return call<InventoryLevelDto>(handle, '/inventory/inventory/adjust', 'POST', input, [
    '/products/inventory',
  ]);
}

/** Sets on hand to a counted figure; the API records the difference. */
export async function recountStock(
  handle: string,
  input: { locationId: string; productId: string; variantId?: string | null; onHand: number },
) {
  return call<InventoryLevelDto>(handle, '/inventory/inventory/adjust', 'POST', input, [
    '/products/inventory',
  ]);
}

// --- purchase orders ---------------------------------------------------------

export async function createPurchaseOrder(
  handle: string,
  input: {
    supplierName: string;
    destinationLocationId: string;
    expectedAt?: string | null;
    lines: readonly { productId: string; title: string; ordered: number }[];
  },
) {
  return call<PurchaseOrderDto>(handle, '/inventory/purchase-orders', 'POST', input, [
    '/purchase_orders',
  ]);
}

export async function savePurchaseOrder(
  handle: string,
  id: string,
  version: number,
  patch: { supplierName?: string; expectedAt?: string | null },
) {
  return call<PurchaseOrderDto>(handle, `/inventory/purchase-orders/${id}`, 'PATCH', {
    version,
    ...patch,
  }, ['/purchase_orders', `/purchase_orders/${id}`]);
}

export async function purchaseOrderAction(
  handle: string,
  id: string,
  action: 'place' | 'receive' | 'cancel',
  version: number,
  lines: readonly { lineId: string; received: number }[] = [],
) {
  return call<PurchaseOrderDto>(
    handle,
    `/inventory/purchase-orders/${id}/${action}`,
    'POST',
    { version, lines },
    ['/purchase_orders', `/purchase_orders/${id}`, '/products/inventory'],
  );
}

// --- transfers ---------------------------------------------------------------

export async function createTransfer(
  handle: string,
  input: {
    originLocationId: string;
    destinationLocationId: string;
    lines: readonly { productId: string; title: string; quantity: number }[];
  },
) {
  return call<TransferDto>(handle, '/inventory/transfers', 'POST', input, ['/transfers']);
}

export async function transferAction(
  handle: string,
  id: string,
  action: 'ship' | 'receive' | 'cancel',
  version: number,
  lines: readonly { lineId: string; received: number }[] = [],
) {
  return call<TransferDto>(
    handle,
    `/inventory/transfers/${id}/${action}`,
    'POST',
    { version, lines },
    ['/transfers', `/transfers/${id}`, '/products/inventory'],
  );
}
