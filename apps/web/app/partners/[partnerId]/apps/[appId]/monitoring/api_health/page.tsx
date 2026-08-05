/**
 * Web · app/partners/[partnerId]/apps/[appId]/monitoring/api_health/page.tsx
 * The reference product's own URL, kept exactly — it is what an app author
 * bookmarks and what a support reply links to.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { AppHealth } from '../../../../../../../components/AppHealth';
import { ErrorState } from '../../../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../../../lib/api';
import type { AppHealthDto, PartnerAppDto } from '../../../../../../../lib/types';

export default async function AppHealthPage({
  params,
}: {
  params: Promise<{ partnerId: string; appId: string }>;
}) {
  const { partnerId, appId } = await params;

  try {
    const [health, apps] = await Promise.all([
      apiFetch<AppHealthDto>(`/partners/${partnerId}/apps/${appId}/health`),
      apiFetch<PartnerAppDto[]>(`/partners/${partnerId}/apps`),
    ]);

    const app = apps.data.find((entry) => entry.id === appId);
    if (!app) notFound();

    return <AppHealth partnerId={partnerId} appName={app.name} health={health.data} />;
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="API health"
        title="Could not load this app's health"
        message={error instanceof Error ? error.message : 'Unknown error'}
        backUrl={`/partners/${partnerId}/apps`}
      />
    );
  }
}
