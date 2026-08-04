'use client';

/**
 * Web · components/AdminShell.tsx
 * The admin chrome (§8.2): top bar, left nav, store switcher. The nav is
 * composed from core sections plus whatever modules contributed, so enabling a
 * module makes its entry appear and disabling it makes the entry and its routes
 * vanish. One toggle, no clutter.
 * Layer: web.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';


import type { NavigationDto } from '../lib/types';
import {
  Frame,
  Navigation,
  TopBar,
  composeNavigation,
  type NavItem,
} from '@deservefirst/ui';

export interface AdminShellProps {
  readonly handle: string;
  readonly storeName: string;
  readonly stores: readonly { handle: string; name: string }[];
  readonly contributed: readonly NavigationDto[];
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}

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
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);

  const sections = useMemo(
    () =>
      composeNavigation(
        handle,
        contributed
          .filter(
            (item): item is NavigationDto & { section: 'primary' | 'sales-channels' | 'apps' } =>
              item.section !== 'settings',
          )
          .map((item) => ({
          section: item.section,
          position: item.position,
          item: {
            id: item.id,
            label: item.label,
            // Manifest paths are templates; the shell resolves the active store.
            path: item.path.replace(':handle', handle),
            permission: item.permission,
          } satisfies NavItem,
          })),
        new Set(permissions),
      ),
    [handle, contributed, permissions],
  );

  const isActive = useCallback(
    (path: string) => pathname === path || pathname.startsWith(`${path}/`),
    [pathname],
  );

  const toNavItem = (item: NavItem) => ({
    label: item.label,
    url: item.path,
    selected: isActive(item.path),
    onClick: () => router.push(item.path),
    ...(item.children && item.children.length > 0
      ? {
          subNavigationItems: item.children.map((child) => ({
            label: child.label,
            url: child.path,
            // A child is only "selected" on an exact match; otherwise every
            // sub-item lights up whenever the parent section is open.
            selected: pathname === child.path,
            onClick: () => router.push(child.path),
          })),
        }
      : {}),
  });

  return (
    <Frame
      topBar={
        <TopBar
          showNavigationToggle
          userMenu={
            <TopBar.UserMenu
              name={storeName}
              detail="Store"
              initials={storeName.slice(0, 2).toUpperCase()}
              open={storeMenuOpen}
              onToggle={() => setStoreMenuOpen((open) => !open)}
              actions={[
                {
                  items: stores.map((store) => ({
                    content: store.name,
                    // Switching store keeps the current section where possible,
                    // so a merchant comparing two shops stays on the same screen.
                    onAction: () =>
                      router.push(pathname.replace(`/store/${handle}`, `/store/${store.handle}`)),
                  })),
                },
                { items: [{ content: 'All stores', onAction: () => router.push('/') }] },
              ]}
            />
          }
        />
      }
      navigation={
        <Navigation location={pathname}>
          {sections.map((section) => (
            <Navigation.Section
              key={section.id}
              title={section.label ?? undefined}
              items={section.items.map(toNavItem)}
            />
          ))}
          <Navigation.Section
            title="Settings"
            items={[
              {
                label: 'Settings',
                url: `/store/${handle}/settings/general`,
                selected: pathname.includes('/settings'),
                onClick: () => router.push(`/store/${handle}/settings/general`),
              },
            ]}
          />
        </Navigation>
      }
    >
      {children}
    </Frame>
  );
}
