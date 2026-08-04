/**
 * Web · app/store/[handle]/growth/page.tsx
 * Growth — the `growth` dashboard slot.
 *
 * Same composition as Home: this file declares no numbers of its own, and a
 * module contributing a `growth` widget appears here without it changing.
 * Layer: web.
 */

import { Dashboard } from '../../../../components/Dashboard';
import { apiFetch } from '../../../../lib/api';
import type { DashboardWidgetDto } from '../../../../lib/types';

export default async function GrowthPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  let widgets: DashboardWidgetDto[] = [];
  try {
    const response = await apiFetch<DashboardWidgetDto[]>('/platform/dashboard/growth');
    widgets = response.data;
  } catch {
    widgets = [];
  }

  return <Dashboard handle={handle} storeName="What needs attention" widgets={widgets} heading="Growth" />;
}
