/**
 * Web · app/partners/[partnerId]/page.tsx
 * The agency's overview.
 * Layer: web.
 */

import { apiFetch } from '../../../lib/api';
import { PartnerOverview } from '../../../components/PartnerOverview';
import type { PartnerStoreDto } from '../../../lib/types';

export default async function PartnerOverviewPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;

  let stores: PartnerStoreDto[] = [];
  try {
    stores = (await apiFetch<PartnerStoreDto[]>(`/partners/${partnerId}/stores`)).data;
  } catch {
    stores = [];
  }

  return <PartnerOverview stores={stores} />;
}
