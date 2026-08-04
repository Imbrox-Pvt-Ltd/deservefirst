/**
 * Web · app/partners/[partnerId]/layout.tsx
 * Everything inside one partner renders in the partner shell.
 *
 * The membership check is here and not in the screens: a partner id in a URL is
 * a guess until proven otherwise, and proving it once per surface is the only
 * way it cannot be forgotten on the fifth screen somebody adds.
 * Layer: web.
 */

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { apiFetch } from '../../../lib/api';
import { PartnerShell } from '../../../components/PartnerShell';
import type { PartnerSummaryDto } from '../../../lib/types';

export default async function PartnerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;

  let partners: PartnerSummaryDto[] = [];
  try {
    partners = (await apiFetch<PartnerSummaryDto[]>('/partners')).data;
  } catch {
    partners = [];
  }

  const active = partners.find((partner) => partner.id === partnerId);
  // Not on the staff list is indistinguishable from not existing, on purpose:
  // a different answer for each would let a stranger discover real partner ids.
  if (!active) redirect('/partners');

  return (
    <PartnerShell
      partnerId={partnerId}
      partnerName={active.name}
      partners={partners.map((partner) => ({ id: partner.id, name: partner.name }))}
      role={active.role}
    >
      {children}
    </PartnerShell>
  );
}
