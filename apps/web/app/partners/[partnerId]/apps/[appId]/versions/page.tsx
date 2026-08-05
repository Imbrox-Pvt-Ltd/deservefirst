/**
 * Web · app/partners/[partnerId]/apps/[appId]/versions/page.tsx
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { AppVersions } from '../../../../../../components/AppVersions';
import { ErrorState } from '../../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../../lib/api';
import type { AppScopeDto, AppVersionDto, PartnerAppDto } from '../../../../../../lib/types';

export default async function AppVersionsPage({
  params,
}: {
  params: Promise<{ partnerId: string; appId: string }>;
}) {
  const { partnerId, appId } = await params;

  try {
    const [versions, apps, scopes] = await Promise.all([
      apiFetch<AppVersionDto[]>(`/partners/${partnerId}/apps/${appId}/versions`),
      apiFetch<PartnerAppDto[]>(`/partners/${partnerId}/apps`),
      apiFetch<AppScopeDto[]>('/oauth/scopes'),
    ]);

    const app = apps.data.find((entry) => entry.id === appId);
    if (!app) notFound();

    return (
      <AppVersions
        partnerId={partnerId}
        appId={appId}
        appName={app.name}
        versions={versions.data}
        // Only what this app registered: a version cannot ask for more, so
        // offering the full catalogue here would be offering a refusal.
        scopes={scopes.data.filter((scope) => app.requestedScopes.includes(scope.key))}
      />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Versions"
        title="Could not load versions"
        message={error instanceof Error ? error.message : 'Unknown error'}
        backUrl={`/partners/${partnerId}/apps`}
      />
    );
  }
}
