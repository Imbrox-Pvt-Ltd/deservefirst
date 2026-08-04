/**
 * Web · app/partners/layout.tsx
 * The gate for everything on the partner surface.
 *
 * Sign-in is checked here rather than in each screen, and it redirects with the
 * path being opened so signing in returns you where you were going. Which
 * PARTNER you may open is a separate question, answered one level down — being
 * signed in does not make you staff anywhere.
 * Layer: web.
 */

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { currentSession } from '../../lib/stores';

export default async function PartnersLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect(`/login?returnPath=${encodeURIComponent('/partners')}`);
  return <>{children}</>;
}
