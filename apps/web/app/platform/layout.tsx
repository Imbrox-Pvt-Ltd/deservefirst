/**
 * Web · app/platform/layout.tsx
 * The gate for the operator surface.
 *
 * Two checks, and the second is the point: being signed in is not being an
 * operator. A merchant who guesses this URL is sent to their own admin rather
 * than shown an empty operator console, because a console that renders and then
 * refuses every action is worse than one that is not there.
 * Layer: web.
 */

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { OperatorShell } from '../../components/OperatorShell';
import { currentSession } from '../../lib/stores';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect(`/login?returnPath=${encodeURIComponent('/platform/apps')}`);

  // Holding any platform permission IS being an operator — the API derives
  // `accessType` the same way, from holding a platform-category role.
  const isOperator = session.permissions.some((permission) => permission.startsWith('platform.'));
  if (!isOperator) redirect('/');

  return <OperatorShell>{children}</OperatorShell>;
}
