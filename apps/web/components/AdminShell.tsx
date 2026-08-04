'use client';

/**
 * Web · components/AdminShell.tsx
 * Binds the admin chrome (§8.2) to this app: it supplies the composed navigation
 * and the router, the frame draws it. Enabling a module makes its entry appear
 * and disabling it makes the entry and its routes vanish — one toggle, no
 * clutter.
 *
 * The chrome itself lives in @deservefirst/ui so every screen shares one shell
 * rather than each rebuilding a header.
 * Layer: web.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, type ReactNode } from 'react';

import { branding } from '@deservefirst/config';
import { settingsPaths, storePaths } from '@deservefirst/contracts';
import { AdminFrame, composeNavigation, type ContributedNavItem } from '@deservefirst/ui';

import type { NavigationDto } from '../lib/types';

export interface AdminShellProps {
  readonly handle: string;
  readonly storeName: string;
  readonly stores: readonly { handle: string; name: string }[];
  readonly contributed: readonly NavigationDto[];
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}

/** Sections whose list screens read `query` from the URL (§24.3). */
const SEARCHABLE = /\/(products|collections|customers|requests|pages|purchase_orders|transfers)(\/|$)/;

export function AdminShell({
  handle,
  storeName,
  stores,
  contributed,
  permissions,
  children,
}: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sections = useMemo(
    () =>
      composeNavigation(
        handle,
        contributed
          .filter(
            (item): item is NavigationDto & { section: 'primary' | 'sales-channels' | 'apps' } =>
              item.section !== 'settings',
          )
          .map(
            (item): ContributedNavItem => ({
              section: item.section,
              position: item.position,
              parentId: item.parentId,
              item: {
                id: item.id,
                label: item.label,
                // Manifest paths are templates; the shell resolves the active store.
                path: item.path.replace(':handle', handle),
                permission: item.permission,
                icon: item.icon,
              },
            }),
          ),
        new Set(permissions),
      ),
    [handle, contributed, permissions],
  );

  /**
   * Top-bar search sets `query` on the current list, because every list screen
   * already reads its state from the URL. Off a list screen there is nothing to
   * filter, so it goes to Products — the largest catalogue surface and the one
   * the reference admin searches by default. A cross-entity search endpoint
   * would let this stop guessing; until then, guessing quietly beats a control
   * that silently does nothing.
   */
  const onSearch = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      const base = SEARCHABLE.test(pathname) ? pathname : storePaths.products(handle);
      const next = new URLSearchParams(base === pathname ? searchParams.toString() : '');
      if (trimmed) next.set('query', trimmed);
      else next.delete('query');
      // A new search starts at the first page; keeping a cursor from the
      // previous result set would page through the wrong list.
      next.delete('after');
      next.delete('before');
      const query = next.toString();
      router.push(query ? `${base}?${query}` : base);
    },
    [handle, pathname, router, searchParams],
  );

  return (
    <AdminFrame
      brandName={branding.platformName}
      release={branding.release}
      sections={sections}
      settingsPath={settingsPaths.general(handle)}
      settingsSelected={pathname.startsWith(settingsPaths.root(handle))}
      pathname={pathname}
      store={{ handle, name: storeName }}
      stores={stores}
      searchTerm={searchParams.get('query') ?? ''}
      onNavigate={(path) => router.push(path)}
      onSearch={onSearch}
      // Switching store keeps the current section where possible, so a merchant
      // comparing two shops stays on the same screen.
      onSwitchStore={(next) => router.push(pathname.replace(`/store/${handle}`, `/store/${next}`))}
    >
      {children}
    </AdminFrame>
  );
}
