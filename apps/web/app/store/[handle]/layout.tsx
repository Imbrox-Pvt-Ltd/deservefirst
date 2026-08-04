/**
 * Web · app/store/[handle]/layout.tsx
 * Everything under an active store renders inside the admin shell.
 *
 * This is also the gate: no session, no admin. It redirects to sign in with the
 * path being opened, so signing in returns you to where you were going rather
 * than to a home page you did not ask for.
 * Layer: web.
 */

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '../../../components/AdminShell';
import { apiFetch } from '../../../lib/api';
import { currentSession } from '../../../lib/stores';
import type { NavigationDto } from '../../../lib/types';

export default async function StoreLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const session = await currentSession();

  if (!session) {
    redirect(`/login?returnPath=${encodeURIComponent(`/store/${handle}`)}`);
  }

  const store = session.stores.find((entry) => entry.handle === handle);
  if (!store) {
    // A store this person is not a member of is not "forbidden" here — it is
    // simply not one of theirs, and the sign-in screen is where they choose.
    redirect('/');
  }

  let contributed: NavigationDto[] = [];
  try {
    const response = await apiFetch<NavigationDto[]>('/platform/navigation');
    contributed = response.data;
  } catch {
    // The shell must render even when the API is down — a merchant seeing an
    // empty nav is better than a merchant seeing a stack trace.
  }

  return (
    <AdminShell
      handle={handle}
      storeName={store.name}
      stores={session.stores}
      contributed={contributed}
      // The grants the session actually carries, so a nav entry the person
      // cannot open is not shown to them at all.
      permissions={session.permissions}
    >
      {children}
    </AdminShell>
  );
}
