/**
 * Web · app/platform/reviews/page.tsx
 * Layer: web.
 */

import { apiFetch } from '../../../lib/api';
import { ScopeReviewQueue } from '../../../components/ScopeReviewQueue';
import type { ScopeReviewDto } from '../../../lib/types';

export default async function PlatformScopeReviewQueuePage() {
  let data: ScopeReviewDto[] = [];
  try {
    data = (await apiFetch<ScopeReviewDto[]>('/platform/app-reviews')).data;
  } catch {
    // The operator console must still open when one endpoint is down; an empty
    // list is better than a stack trace where the platform's controls should be.
    data = [];
  }

  return <ScopeReviewQueue queue={data} />;
}
