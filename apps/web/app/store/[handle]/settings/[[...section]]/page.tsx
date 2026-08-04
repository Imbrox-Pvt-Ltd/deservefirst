/**
 * Web · app/store/[handle]/settings/[[...section]]/page.tsx
 * The settings overlay, deep-linkable per section (§8.5). An optional catch-all
 * so `/settings` and `/settings/general` both resolve, and every one of the 19
 * sections has its own shareable URL.
 * Layer: web.
 */

import { apiFetch } from '../../../../../lib/api';
import { StoreSettings } from '../../../../../components/StoreSettings';
import type { SettingDto } from '../../../../../lib/types';

const STORES: Record<string, { id: string; name: string }> = {
  'acme-us': { id: 'seed-store-us', name: 'Acme US' },
  'acme-in': { id: 'seed-store-in', name: 'Acme India' },
};

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ handle: string; section?: string[] }>;
}) {
  const { handle, section } = await params;
  const store = STORES[handle] ?? STORES['acme-us']!;
  const active = section?.[0] ?? 'general';

  let contributed: SettingDto[] = [];
  try {
    // Settings are read from the registry, so a module's declared schema shows
    // up here without this screen knowing the module exists.
    const response = await apiFetch<SettingDto[]>('/platform/settings', { storeId: store.id });
    contributed = response.data;
  } catch {
    contributed = [];
  }

  return (
    <StoreSettings
      handle={handle}
      storeName={store.name}
      organizationName="Acme Group"
      storeCount={Object.keys(STORES).length}
      section={active}
      contributed={contributed}
    />
  );
}
