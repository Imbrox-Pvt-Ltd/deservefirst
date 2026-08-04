/**
 * Web · app/store/[handle]/products/inventory/page.tsx
 * Stock by location, at the reference admin's own URL.
 *
 * This path sits inside `/products/[id]`, which catalog owns. The precedence is
 * declared in the inventory manifest (`shadows`), and the App Router resolves
 * static segments before dynamic ones — so "inventory" reaches this screen
 * rather than being read as a product id.
 * Layer: web.
 */

import { InventoryList } from '../../../../../components/InventoryList';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, withSearch } from '../../../../../lib/api';
import { listQueryFrom, storeIdFor } from '../../../../../lib/stores';
import type { InventoryLevelDto, LocationDto } from '../../../../../lib/types';

const PERMISSIONS = ['inventory.read', 'inventory.adjust', 'inventory.manage'];

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const search = await searchParams;
  const storeId = storeIdFor(handle);
  const scope = { storeId, permissions: PERMISSIONS };

  const query = listQueryFrom(search);
  const locationId = query.get('location_id');
  // The location is a screen concern, not a list filter the API knows about.
  query.delete('location_id');

  try {
    const [locations, levels] = await Promise.all([
      apiFetch<LocationDto[]>('/inventory/locations/active', scope),
      apiFetch<Omit<InventoryLevelDto, 'available'>[]>(
        withSearch('/inventory/inventory', query),
        scope,
      ),
    ]);

    // The list surface projects declared fields, and `available` is derived
    // rather than stored — a stored copy is one more thing that can disagree
    // with the numbers it comes from. It is computed here, once, on the way in.
    const withAvailable: InventoryLevelDto[] = levels.data.map((level) => ({
      ...level,
      available: Math.max(0, level.onHand - level.committed),
    }));

    return (
      <InventoryList
        handle={handle}
        locations={locations.data}
        levels={withAvailable}
        locationId={locationId}
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Inventory"
        title="Could not load inventory"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
