/**
 * Web · app/store/[handle]/settings/[[...section]]/page.tsx
 * The settings overlay, deep-linkable per section (§8.5). An optional catch-all
 * so `/settings` and `/settings/general` both resolve, and every one of the 19
 * sections has its own shareable URL.
 * Layer: web.
 */

import { apiFetch } from '../../../../../lib/api';
import { StoreSettings } from '../../../../../components/StoreSettings';
import type { ResolvedSettingDto, SettingDto } from '../../../../../lib/types';

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
  let effective: ResolvedSettingDto[] = [];
  try {
    // Two reads with different jobs: the registry says what a setting IS —
    // label, kind, options — and the resolver says what its value is here and
    // which level supplied it. Neither can answer the other's question.
    const [declared, resolved] = await Promise.all([
      apiFetch<SettingDto[]>('/platform/settings'),
      apiFetch<ResolvedSettingDto[]>('/platform/effective-settings'),
    ]);
    contributed = declared.data;
    effective = resolved.data;
  } catch {
    // The settings screen must still open when the API is down; an empty form
    // is better than a stack trace where the settings should be.
    contributed = [];
    effective = [];
  }

  return (
    <StoreSettings
      handle={handle}
      storeName={store.name}
      organizationName="Acme Group"
      storeCount={Object.keys(STORES).length}
      section={active}
      contributed={contributed}
      effective={effective}
    />
  );
}
