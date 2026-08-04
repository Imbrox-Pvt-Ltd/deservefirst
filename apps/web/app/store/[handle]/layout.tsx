/**
 * Web · app/store/[handle]/layout.tsx
 * Everything under an active store renders inside the admin shell. The store
 * handle lives in the path (§8.4); the nav is fetched from the platform registry
 * so it reflects the modules actually loaded, not a hardcoded list.
 * Layer: web.
 */

import type { ReactNode } from 'react';

import { AdminShell } from '../../../components/AdminShell';
import { apiFetch } from '../../../lib/api';
import type { NavigationDto } from '../../../lib/types';

/** Until the identity API is wired, the picker's stores are the known set. */
const STORES = [
  { id: 'seed-store-us', handle: 'acme-us', name: 'Acme US' },
  { id: 'seed-store-in', handle: 'acme-in', name: 'Acme India' },
];

const PERMISSIONS = [
  'store.read', 'store.settings.read', 'store.settings.manage', 'catalog.read',
  'catalog.write', 'orders.read', 'customers.read', 'analytics.read',
  'growth.read', 'discounts.read', 'content.read', 'markets.read',
  'finance.read', 'online-store.read',
];

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const store = STORES.find((entry) => entry.handle === handle) ?? STORES[0]!;

  let contributed: NavigationDto[] = [];
  try {
    const response = await apiFetch<NavigationDto[]>('/platform/navigation', { storeId: store.id });
    contributed = response.data;
  } catch {
    // The shell must render even when the API is down — a merchant seeing an
    // empty nav is better than a merchant seeing a stack trace.
  }

  return (
    <AdminShell
      handle={handle}
      storeName={store.name}
      stores={STORES}
      contributed={contributed}
      permissions={PERMISSIONS}
    >
      {children}
    </AdminShell>
  );
}
