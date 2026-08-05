/**
 * Web · app/platform/modules/page.tsx
 * Layer: web.
 */

import { apiFetch } from '../../../lib/api';
import { PlatformModules } from '../../../components/PlatformModules';
import type { PlatformModuleStateDto } from '../../../lib/types';

export default async function PlatformPlatformModulesPage() {
  let data: PlatformModuleStateDto[] = [];
  try {
    data = (await apiFetch<PlatformModuleStateDto[]>('/platform/module-states')).data;
  } catch {
    // The operator console must still open when one endpoint is down; an empty
    // list is better than a stack trace where the platform's controls should be.
    data = [];
  }

  return <PlatformModules modules={data} />;
}
