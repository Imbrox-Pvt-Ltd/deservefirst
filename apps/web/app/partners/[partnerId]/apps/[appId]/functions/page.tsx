/**
 * Web · app/partners/[partnerId]/apps/[appId]/functions/page.tsx
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { AppFunctions } from '../../../../../../components/AppFunctions';
import { ErrorState } from '../../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../../lib/api';
import type {
  FunctionDeploymentDto,
  FunctionPointDto,
  PartnerAppDto,
} from '../../../../../../lib/types';

export default async function AppFunctionsPage({
  params,
}: {
  params: Promise<{ partnerId: string; appId: string }>;
}) {
  const { partnerId, appId } = await params;

  try {
    const [deployments, points, apps] = await Promise.all([
      apiFetch<FunctionDeploymentDto[]>(`/partners/${partnerId}/apps/${appId}/functions`),
      apiFetch<FunctionPointDto[]>('/functions/points'),
      apiFetch<PartnerAppDto[]>(`/partners/${partnerId}/apps`),
    ]);

    const app = apps.data.find((entry) => entry.id === appId);
    if (!app) notFound();

    return (
      <AppFunctions
        partnerId={partnerId}
        appId={appId}
        appName={app.name}
        deployments={deployments.data}
        points={points.data}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Functions"
        title="Could not load functions"
        message={error instanceof Error ? error.message : 'Unknown error'}
        backUrl={`/partners/${partnerId}/apps`}
      />
    );
  }
}
