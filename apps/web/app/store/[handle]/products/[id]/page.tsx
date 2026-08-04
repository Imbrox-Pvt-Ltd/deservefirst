/**
 * Web · app/store/[handle]/products/[id]/page.tsx
 * Product detail, built from the DetailScreen template plus the toolkit panels
 * the entity earned by declaration — tags, metafields, SEO, translations and
 * timeline all arrive without this screen implementing any of them (§12.1).
 * Layer: web.
 */

import { ErrorState } from '../../../../../components/ErrorState';
import { ProductDetail } from '../../../../../components/ProductDetail';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { ProductDto } from '../../../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  try {
    const response = await apiFetch<ProductDto>(`/catalog/products/${id}`, { storeId });
    return <ProductDetail handle={handle} product={response.data} />;
  } catch (error) {
    const notFound = isNotFound(error);
    return (
      <ErrorState
        pageTitle="Product"
        backUrl={`/store/${handle}/products`}
        tone={notFound ? 'warning' : 'critical'}
        title={notFound ? 'Product not found' : 'Could not load product'}
        message={
          notFound
            ? 'This product does not exist in this store. It may belong to another store in the organization.'
            : error instanceof Error
              ? error.message
              : 'Unknown error'
        }
      />
    );
  }
}
