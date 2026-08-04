/**
 * Web · app/partners/[partnerId]/stores/page.tsx
 * The agency's client stores.
 * Layer: web.
 */

import { apiFetch } from '../../../../lib/api';
import { PartnerStores } from '../../../../components/PartnerStores';
import type { PartnerStoreDto, PartnerSummaryDto } from '../../../../lib/types';

export default async function PartnerStoresPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;

  let stores: PartnerStoreDto[] = [];
  let role: PartnerSummaryDto['role'] = 'member';
  try {
    stores = (await apiFetch<PartnerStoreDto[]>(`/partners/${partnerId}/stores`)).data;
  } catch {
    stores = [];
  }
  try {
    const partners = (await apiFetch<PartnerSummaryDto[]>('/partners')).data;
    role = partners.find((partner) => partner.id === partnerId)?.role ?? 'member';
  } catch {
    // Falls back to the least privileged reading, so a failed lookup hides the
    // request form rather than offering an action that will be refused.
    role = 'member';
  }

  return <PartnerStores partnerId={partnerId} stores={stores} canRequest={role !== 'member'} />;
}
