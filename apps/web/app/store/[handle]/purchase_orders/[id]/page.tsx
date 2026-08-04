/**
 * Web · app/store/[handle]/purchase_orders/[id]/page.tsx
 * One purchase order: place it, receive against it, cancel it.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../components/ErrorState';
import { ReceivingDetail } from '../../../../../components/ReceivingDetail';
import { purchaseOrderLines } from '../../../../../lib/receiving';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import { storeIdFor } from '../../../../../lib/stores';
import type { LocationDto, PurchaseOrderDto } from '../../../../../lib/types';

const PERMISSIONS = ['inventory.read', 'inventory.manage'];

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const scope = { storeId: storeIdFor(handle), permissions: PERMISSIONS };

  try {
    const [order, locations] = await Promise.all([
      apiFetch<PurchaseOrderDto>(`/inventory/purchase-orders/${id}/detail`, scope),
      apiFetch<LocationDto[]>('/inventory/locations/active', scope),
    ]);

    const destination = locations.data.find(
      (location) => location.id === order.data.destinationLocationId,
    );

    return (
      <ReceivingDetail
        kind="purchase-order"
        handle={handle}
        id={order.data.id}
        reference={order.data.reference}
        status={order.data.status}
        version={order.data.version}
        lines={purchaseOrderLines(order.data)}
        locations={locations.data}
        backPath={`/store/${handle}/purchase_orders`}
        summary={[
          { label: 'Supplier', value: order.data.supplierName },
          { label: 'Destination', value: destination?.name ?? '—' },
          {
            label: 'Expected',
            value: order.data.expectedAt
              ? new Date(order.data.expectedAt).toLocaleDateString()
              : 'Not set',
          },
        ]}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Purchase order"
        title="Could not load this purchase order"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
