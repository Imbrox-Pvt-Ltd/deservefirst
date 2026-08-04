/**
 * Web · app/page.tsx
 * Store entry — the stores this person is actually a member of.
 *
 * It used to be a hardcoded pair, which showed every operator the same two
 * stores regardless of membership. That is harmless while it is obviously a
 * stub and a disclosure the moment it is not.
 * Layer: web.
 */

import { redirect } from 'next/navigation';

import { StorePicker } from '../components/StorePicker';
import { currentSession } from '../lib/stores';

export default async function StoreEntry() {
  const session = await currentSession();
  if (!session) redirect('/login');

  // One store means no choice worth making.
  if (session.stores.length === 1) redirect(`/store/${session.stores[0]!.handle}`);

  return (
    <StorePicker
      stores={session.stores.map((store) => ({
        handle: store.handle,
        name: store.name,
        entity: '',
        currency: '',
      }))}
    />
  );
}
