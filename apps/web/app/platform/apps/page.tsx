/**
 * Web · app/platform/apps/page.tsx
 * Layer: web.
 */

import { apiFetch } from '../../../lib/api';
import { PlatformApps } from '../../../components/PlatformApps';
import type { PlatformAppDto } from '../../../lib/types';

export default async function PlatformPlatformAppsPage() {
  let data: PlatformAppDto[] = [];
  try {
    data = (await apiFetch<PlatformAppDto[]>('/platform/apps')).data;
  } catch {
    // The operator console must still open when one endpoint is down; an empty
    // list is better than a stack trace where the platform's controls should be.
    data = [];
  }

  return <PlatformApps apps={data} />;
}
