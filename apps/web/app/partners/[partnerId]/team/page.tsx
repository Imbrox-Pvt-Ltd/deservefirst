/**
 * Web · app/partners/[partnerId]/team/page.tsx
 * Who works at the agency.
 * Layer: web.
 */

import { apiFetch } from '../../../../lib/api';
import { PartnerTeam } from '../../../../components/PartnerTeam';
import type { PartnerStaffDto } from '../../../../lib/types';

export default async function PartnerTeamPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;

  let staff: PartnerStaffDto[] = [];
  try {
    staff = (await apiFetch<PartnerStaffDto[]>(`/partners/${partnerId}/staff`)).data;
  } catch {
    staff = [];
  }

  return <PartnerTeam partnerId={partnerId} staff={staff} />;
}
