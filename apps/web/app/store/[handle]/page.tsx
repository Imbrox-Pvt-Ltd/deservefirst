/**
 * Web · app/store/[handle]/page.tsx
 * Store home. Fetches on the server, renders on the client.
 * Layer: web.
 */

import { StoreHomeView } from '../../../components/StoreHomeView';
import { apiFetch } from '../../../lib/api';
import type { ProductDto } from '../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export default async function StoreHome({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  let products: ProductDto[] = [];
  try {
    const response = await apiFetch<ProductDto[]>('/catalog/products?limit=250', { storeId });
    products = response.data;
  } catch {
    // A dashboard that cannot count is still a dashboard; it must not 500.
    products = [];
  }

  return (
    <StoreHomeView
      total={products.length}
      active={products.filter((product) => product.status === 'active').length}
      draft={products.filter((product) => product.status === 'draft').length}
    />
  );
}
