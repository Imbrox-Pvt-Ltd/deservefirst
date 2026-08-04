/**
 * Web · app/store/[handle]/analytics/page.tsx
 * Analytics — the `analytics` dashboard slot.
 *
 * Same composition as Home: this file declares no numbers of its own, and a
 * module contributing a `analytics` widget appears here without it changing.
 * Layer: web.
 */

import { Dashboard } from '../../../../components/Dashboard';
import { apiFetch } from '../../../../lib/api';
import type { DashboardWidgetDto } from '../../../../lib/types';

export default async function AnalyticsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  let widgets: DashboardWidgetDto[] = [];
  try {
    const response = await apiFetch<DashboardWidgetDto[]>('/platform/dashboard/analytics');
    widgets = response.data;
  } catch {
    widgets = [];
  }

  return <Dashboard handle={handle} storeName="What has happened" widgets={widgets} heading="Analytics" />;
}
