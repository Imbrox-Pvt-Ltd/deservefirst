/**
 * Web · app/page.tsx
 * Store entry. A server component that resolves which stores the user can reach
 * and delegates rendering to the client — the design system needs React context,
 * which only a client component can provide.
 * Layer: web.
 */

import { StorePicker } from '../components/StorePicker';

/** Seeded until the identity API exposes the user's membership list. */
const STORES = [
  { handle: 'acme-us', name: 'Acme US', entity: 'Acme Inc. · United States', currency: 'USD' },
  { handle: 'acme-in', name: 'Acme India', entity: 'Acme India Pvt. Ltd. · India', currency: 'INR' },
];

export default function StoreEntry() {
  return <StorePicker stores={STORES} />;
}
