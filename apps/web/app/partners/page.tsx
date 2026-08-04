/**
 * Web · app/partners/page.tsx
 * Choose which agency you are working inside, or start one.
 * Layer: web.
 */

import { apiFetch } from '../../lib/api';
import { PartnerPicker } from '../../components/PartnerPicker';
import type { PartnerSummaryDto } from '../../lib/types';

export default async function PartnersPage() {
  let partners: PartnerSummaryDto[] = [];
  try {
    partners = (await apiFetch<PartnerSummaryDto[]>('/partners')).data;
  } catch {
    // Signed in but the API is unreachable. An empty picker still lets somebody
    // create an account once it is back, which beats a stack trace.
    partners = [];
  }

  return <PartnerPicker partners={partners} />;
}
