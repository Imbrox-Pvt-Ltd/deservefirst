/**
 * Web · app/store/[handle]/page.tsx
 * Store home — composed from whatever the enabled modules contribute (§31.2).
 *
 * It used to count products itself, which meant Home knew about catalog and
 * would have had to learn about every module after it. It now asks the platform
 * for the `home` slot and renders what comes back, so a new module's card
 * arrives with the module.
 * Layer: web.
 */

import { Dashboard } from '../../../components/Dashboard';
import { apiFetch } from '../../../lib/api';
import { ALL_PERMISSIONS, STORES, storeIdFor } from '../../../lib/stores';
import type { DashboardWidgetDto } from '../../../lib/types';

export default async function StoreHome({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const store = STORES.find((entry) => entry.handle === handle) ?? STORES[0]!;

  let widgets: DashboardWidgetDto[] = [];
  try {
    const response = await apiFetch<DashboardWidgetDto[]>('/platform/dashboard/home', {
      storeId: storeIdFor(handle),
      permissions: ALL_PERMISSIONS,
    });
    widgets = response.data;
  } catch {
    // An empty dashboard is still a usable admin; the nav is the point of this
    // screen for a merchant who is on their way somewhere else.
    widgets = [];
  }

  return <Dashboard handle={handle} storeName={store.name} widgets={widgets} />;
}
