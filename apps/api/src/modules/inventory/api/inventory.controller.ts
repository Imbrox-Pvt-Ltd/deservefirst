/**
 * Inventory · api/inventory.controller.ts
 * Stock levels, purchase orders and transfers.
 *
 * Levels are READ through the generic surface like any other resource; what is
 * here is everything that MOVES stock, which is where the invariants live.
 * Layer: api.
 */

import { controller, type ModuleController, type RouteRequest } from '../../../core/http/controller';
import type {
  InventoryService,
  PurchaseOrderService,
  StoredLevel,
  StoredLocation,
  TransferService,
} from '../application';
import { inTransit, type InventoryAdjustment, type PurchaseOrder, type Transfer } from '../domain';

export interface InventoryServices {
  readonly inventory: InventoryService;
  readonly purchaseOrders: PurchaseOrderService;
  readonly transfers: TransferService;
}

const toLocationDto = (location: StoredLocation) => ({
  id: location.id,
  name: location.name,
  address: location.address,
  countryCode: location.countryCode,
  fulfilsOrders: location.fulfilsOrders,
  archivedAt: location.archivedAt?.toISOString() ?? null,
  version: location.version,
});

const toAdjustmentDto = (adjustment: InventoryAdjustment) => ({
  id: adjustment.id,
  locationId: adjustment.locationId,
  productId: adjustment.productId,
  variantId: adjustment.variantId,
  delta: adjustment.delta,
  reason: adjustment.reason,
  reference: adjustment.reference,
  occurredAt: adjustment.occurredAt.toISOString(),
});

const toPurchaseOrderDto = (order: PurchaseOrder) => ({
  id: order.id,
  reference: order.reference,
  supplierName: order.supplierName,
  destinationLocationId: order.destinationLocationId,
  status: order.status,
  expectedAt: order.expectedAt?.toISOString() ?? null,
  lines: order.lines,
  version: order.version,
});

const toTransferDto = (transfer: Transfer) => ({
  id: transfer.id,
  reference: transfer.reference,
  originLocationId: transfer.originLocationId,
  destinationLocationId: transfer.destinationLocationId,
  status: transfer.status,
  lines: transfer.lines,
  inTransit: inTransit(transfer),
  version: transfer.version,
});

const expectedVersion = (request: RouteRequest): number => Number(request.body.version ?? -1);

export function inventoryController(services: InventoryServices): ModuleController {
  const { inventory, purchaseOrders, transfers } = services;

  /** Derived, never stored: a stored copy can disagree with what it comes from. */
  const toLevelDto = (level: StoredLevel) => ({
    id: level.id,
    locationId: level.locationId,
    productId: level.productId,
    variantId: level.variantId,
    title: level.title,
    sku: level.sku,
    onHand: level.onHand,
    committed: level.committed,
    incoming: level.incoming,
    available: inventory.availableFor(level),
    version: level.version,
  });

  return controller('inventory', [
    {
      method: 'GET',
      path: '/locations/active',
      permission: 'inventory.read',
      handle: async () => (await inventory.locationsForPicker()).map(toLocationDto),
    },
    {
      method: 'POST',
      path: '/inventory/adjust',
      permission: 'inventory.adjust',
      handle: async (request) => {
        const { body } = request;
        // Two ways to say the same thing: a signed movement, or a counted total.
        // The service turns a count into a movement, so the log only ever holds
        // deltas with reasons.
        const level =
          body.onHand === undefined
            ? await inventory.adjust({
                locationId: String(body.locationId ?? ''),
                productId: String(body.productId ?? ''),
                variantId: (body.variantId ?? null) as string | null,
                delta: Number(body.delta ?? 0),
                reason: (body.reason ?? 'correction') as never,
                reference: (body.reference ?? null) as string | null,
                title: body.title === undefined ? undefined : String(body.title),
                sku: (body.sku ?? null) as string | null,
              })
            : await inventory.recount({
                locationId: String(body.locationId ?? ''),
                productId: String(body.productId ?? ''),
                variantId: (body.variantId ?? null) as string | null,
                onHand: Number(body.onHand),
                title: body.title === undefined ? undefined : String(body.title),
                sku: (body.sku ?? null) as string | null,
              });

        return toLevelDto(level);
      },
    },
    {
      method: 'GET',
      path: '/inventory/:id/history',
      permission: 'inventory.read',
      handle: async (request) => {
        const level = await inventory.get(request.params.id!);
        const history = await inventory.history(level.locationId, level.productId);
        return { level: toLevelDto(level), history: history.map(toAdjustmentDto) };
      },
    },

    // --- purchase orders ------------------------------------------------------
    {
      method: 'GET',
      path: '/purchase-orders/:id/detail',
      permission: 'inventory.read',
      handle: async (request) => toPurchaseOrderDto(await purchaseOrders.get(request.params.id!)),
    },
    {
      method: 'POST',
      path: '/purchase-orders',
      permission: 'inventory.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toPurchaseOrderDto(
          await purchaseOrders.create({
            supplierName: String(body.supplierName ?? ''),
            destinationLocationId: String(body.destinationLocationId ?? ''),
            expectedAt: (body.expectedAt ?? null) as string | null,
            lines: (body.lines ?? []) as never,
          }),
        );
      },
    },
    {
      method: 'PATCH',
      path: '/purchase-orders/:id',
      permission: 'inventory.manage',
      handle: async (request) => {
        const { body } = request;
        return toPurchaseOrderDto(
          await purchaseOrders.update(request.params.id!, expectedVersion(request), {
            supplierName: body.supplierName === undefined ? undefined : String(body.supplierName),
            expectedAt: body.expectedAt as string | null | undefined,
            lines: body.lines as never,
          }),
        );
      },
    },
    ...(['place', 'receive', 'cancel'] as const).map((action) => ({
      method: 'POST' as const,
      path: `/purchase-orders/:id/${action}`,
      permission: 'inventory.manage',
      handle: async (request: RouteRequest) => {
        const id = request.params.id!;
        const version = expectedVersion(request);
        const order =
          action === 'place'
            ? await purchaseOrders.place(id, version)
            : action === 'receive'
              ? await purchaseOrders.receive(id, version, (request.body.lines ?? []) as never)
              : await purchaseOrders.cancel(id, version);
        return toPurchaseOrderDto(order);
      },
    })),

    // --- transfers -------------------------------------------------------------
    {
      method: 'GET',
      path: '/transfers/:id/detail',
      permission: 'inventory.read',
      handle: async (request) => toTransferDto(await transfers.get(request.params.id!)),
    },
    {
      method: 'POST',
      path: '/transfers',
      permission: 'inventory.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toTransferDto(
          await transfers.create({
            originLocationId: String(body.originLocationId ?? ''),
            destinationLocationId: String(body.destinationLocationId ?? ''),
            lines: (body.lines ?? []) as never,
          }),
        );
      },
    },
    {
      method: 'PATCH',
      path: '/transfers/:id',
      permission: 'inventory.manage',
      handle: async (request) => {
        const { body } = request;
        return toTransferDto(
          await transfers.update(request.params.id!, expectedVersion(request), {
            destinationLocationId:
              body.destinationLocationId === undefined
                ? undefined
                : String(body.destinationLocationId),
            lines: body.lines as never,
          }),
        );
      },
    },
    ...(['ship', 'receive', 'cancel'] as const).map((action) => ({
      method: 'POST' as const,
      path: `/transfers/:id/${action}`,
      permission: 'inventory.manage',
      handle: async (request: RouteRequest) => {
        const id = request.params.id!;
        const version = expectedVersion(request);
        const transfer =
          action === 'ship'
            ? await transfers.ship(id, version)
            : action === 'receive'
              ? await transfers.receive(id, version, (request.body.lines ?? []) as never)
              : await transfers.cancel(id, version);
        return toTransferDto(transfer);
      },
    })),
  ]);
}
