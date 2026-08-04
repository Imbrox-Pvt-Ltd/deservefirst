/**
 * Web · app/partners/[partnerId]/apps/page.tsx
 * The agency's app registry.
 * Layer: web.
 */

import { apiFetch } from '../../../../lib/api';
import { PartnerApps } from '../../../../components/PartnerApps';
import type { AppScopeDto, PartnerAppDto } from '../../../../lib/types';

export default async function PartnerAppsPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;

  let apps: PartnerAppDto[] = [];
  let scopes: AppScopeDto[] = [];
  // Read separately: a failure fetching the scope list should not also hide the
  // apps that already exist.
  try {
    apps = (await apiFetch<PartnerAppDto[]>(`/partners/${partnerId}/apps`)).data;
  } catch {
    apps = [];
  }
  try {
    scopes = (await apiFetch<AppScopeDto[]>('/oauth/scopes')).data;
  } catch {
    scopes = [];
  }

  return <PartnerApps partnerId={partnerId} apps={apps} scopes={scopes} />;
}
