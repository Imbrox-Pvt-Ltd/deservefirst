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
import { currentSession } from '../../../lib/stores';
import type { DashboardWidgetDto } from '../../../lib/types';

export default async function StoreHome({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const session = await currentSession();
  const store = session?.stores.find((entry) => entry.handle === handle);

  let widgets: DashboardWidgetDto[] = [];
  try {
    const response = await apiFetch<DashboardWidgetDto[]>('/platform/dashboard/home');
    widgets = response.data;
  } catch {
    // An empty dashboard is still a usable admin; the nav is the point of this
    // screen for a merchant who is on their way somewhere else.
    widgets = [];
  }

  return <Dashboard handle={handle} storeName={store?.name ?? handle} widgets={widgets} />;
}
