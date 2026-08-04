/**
 * Web · app/store/[handle]/transfers/new/page.tsx
 * New Transfer. Locations are fetched here because the form cannot invent them —
 * a destination select with nothing in it is the honest state of a store that
 * has not set a location up yet, and the form says so.
 * Layer: web.
 */

import { CreateForm } from '../../../../../components/CreateForm';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch } from '../../../../../lib/api';
import { storeIdFor } from '../../../../../lib/stores';
import type { LocationDto } from '../../../../../lib/types';

export default async function NewTransferPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  try {
    const locations = await apiFetch<LocationDto[]>('/inventory/locations/active', {
      storeId: storeIdFor(handle),
      permissions: ['inventory.read', 'inventory.manage'],
    });

    return (
      <CreateForm
        kind="transfer"
        handle={handle}
        sources={{
          locations: locations.data.map((location) => ({
            label: location.name,
            value: location.id,
          })),
        }}
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="New Transfer"
        title="Could not load locations"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
