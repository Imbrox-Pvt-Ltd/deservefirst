'use client';

/**
 * Web · components/PartnerShell.tsx
 * The partner dashboard's chrome.
 *
 * The same frame the store admin uses, with the partner in the place of the
 * store. That is not a shortcut — it is the correct analogy: the switcher in
 * the top-left picks which account you are working inside, and a person who
 * works at two agencies needs exactly what a person with two stores needs.
 *
 * The navigation is written here rather than composed from manifests, because
 * modules contribute to a STORE's admin and a partner is not in a store. A
 * module has nothing to say about an agency's payouts.
 * Layer: web.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';

import { branding } from '@deservefirst/config';
import { AdminFrame, type NavSection } from '@deservefirst/ui';

import { signOut } from '../app/actions/auth';

export interface PartnerShellProps {
  readonly partnerId: string;
  readonly partnerName: string;
  readonly partners: readonly { id: string; name: string }[];
  /** What this person's seat at the partner allows; hides what they cannot open. */
  readonly role: 'owner' | 'admin' | 'member';
  readonly children: ReactNode;
}

export function PartnerShell({
  partnerId,
  partnerName,
  partners,
  role,
  children,
}: PartnerShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const base = `/partners/${partnerId}`;

  const sections = useMemo((): NavSection[] => {
    // The permission each entry names is the PARTNER's own, not a store's. The
    // frame carries it; the gate that matters is the service, which checks the
    // acting user's seat on every call.
    const items = [
      { id: 'overview', label: 'Overview', path: base, permission: 'partner.read' },
      { id: 'stores', label: 'Client stores', path: `${base}/stores`, permission: 'partner.read' },
    ];

    // Only an owner can change who works here, so only an owner is shown the
    // door. A member clicking through to a 403 learns the same thing later and
    // worse.
    if (role === 'owner') {
      items.push({
        id: 'team',
        label: 'Team',
        path: `${base}/team`,
        permission: 'partner.staff.manage',
      });
    }

    return [{ id: 'primary', label: null, items }];
  }, [base, role]);

  return (
    <AdminFrame
      brandName={branding.platformName}
      release={branding.release}
      sections={sections}
      // A partner has no settings screen yet; pointing the gear at the overview
      // is honest, whereas pointing it at a route that 404s is not.
      settingsPath={base}
      settingsSelected={false}
      pathname={pathname}
      store={{ handle: partnerId, name: partnerName }}
      stores={partners.map((partner) => ({ handle: partner.id, name: partner.name }))}
      onNavigate={(path) => router.push(path)}
      onSearch={() => {}}
      onSwitchStore={(handle) => router.push(`/partners/${handle}`)}
      onSignOut={() => void signOut()}
    >
      {children}
    </AdminFrame>
  );
}
