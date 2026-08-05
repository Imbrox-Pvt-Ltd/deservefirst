'use client';

/**
 * Web · components/OperatorShell.tsx
 * The platform operator's chrome.
 *
 * Same frame as the store admin and the partner dashboard, with the platform
 * itself in the place of the store. There is no switcher — an operator works on
 * one platform, and a control that only ever has one option is a control that
 * teaches somebody it might have two.
 *
 * Kept visibly distinct from a merchant's admin on purpose. Every screen behind
 * this shell acts on EVERY store at once, and a surface that looks like the one
 * where actions affect a single store is a surface where that gets forgotten.
 * Layer: web.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';

import { branding } from '@deservefirst/config';
import { AdminFrame, type NavSection } from '@deservefirst/ui';

import { signOut } from '../app/actions/auth';

export function OperatorShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const sections = useMemo(
    (): NavSection[] => [
      {
        id: 'primary',
        label: null,
        items: [
          { id: 'apps', label: 'Apps', path: '/platform/apps', permission: 'platform.apps.suspend' },
          {
            id: 'reviews',
            label: 'Scope requests',
            path: '/platform/reviews',
            permission: 'platform.apps.review',
          },
          {
            id: 'modules',
            label: 'Modules',
            path: '/platform/modules',
            permission: 'platform.modules.manage',
          },
        ],
      },
    ],
    [],
  );

  return (
    <AdminFrame
      brandName={branding.platformName}
      release={branding.release}
      sections={sections}
      settingsPath="/platform/modules"
      settingsSelected={false}
      pathname={pathname}
      // The platform stands where a store would. It is the thing being
      // administered, and naming it plainly is how an operator knows the blast
      // radius of what they are looking at.
      store={{ handle: 'platform', name: `${branding.platformName} platform` }}
      stores={[]}
      onNavigate={(path) => router.push(path)}
      onSearch={() => {}}
      onSwitchStore={() => {}}
      onSignOut={() => void signOut()}
    >
      {children}
    </AdminFrame>
  );
}
