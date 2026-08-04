/**
 * Web · app/store/[handle]/transfers/[id]/page.tsx
 * One transfer: ship it, receive it, cancel it.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { ErrorState } from '../../../../../components/ErrorState';
import { ReceivingDetail } from '../../../../../components/ReceivingDetail';
import { transferLines } from '../../../../../lib/receiving';
import { apiFetch, isNotFound, withSearch } from '../../../../../lib/api';
import { storeIdFor } from '../../../../../lib/stores';
import type { LocationDto, TransferDto } from '../../../../../lib/types';

const PERMISSIONS = ['inventory.read', 'inventory.manage'];

export default async function TransferPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const scope = { storeId: storeIdFor(handle), permissions: PERMISSIONS };

  try {
    const [transfer, locations, products] = await Promise.all([
      apiFetch<TransferDto>(`/inventory/transfers/${id}/detail`, scope),
      apiFetch<LocationDto[]>('/inventory/locations/active', scope),
      // Selectable products for the draft line editor. Capped deliberately: a
      // select is the wrong control past a few hundred, and pretending
      // otherwise would ship a screen that degrades silently as a catalogue
      // grows.
      apiFetch<{ id: string; title: string }[]>(
        withSearch('/catalog/products', new URLSearchParams({ limit: '250' })),
        { ...scope, permissions: [...PERMISSIONS, 'catalog.read'] },
      ),
    ]);

    const nameOf = (locationId: string) =>
      locations.data.find((location) => location.id === locationId)?.name ?? '—';

    return (
      <ReceivingDetail
        kind="transfer"
        handle={handle}
        id={transfer.data.id}
        reference={transfer.data.reference}
        status={transfer.data.status}
        version={transfer.data.version}
        lines={transferLines(transfer.data)}
        locations={locations.data}
        products={products.data}
        backPath={`/store/${handle}/transfers`}
        summary={[
          { label: 'From', value: nameOf(transfer.data.originLocationId) },
          { label: 'To', value: nameOf(transfer.data.destinationLocationId) },
          // Stock that has left one location and not reached the other belongs
          // to neither, and saying so is the point of showing it.
          { label: 'In transit', value: String(transfer.data.inTransit) },
        ]}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Transfer"
        title="Could not load this transfer"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
