'use server';

/**
 * Web · app/actions/products.ts
 * Server actions for product writes. They run on the server, so the API is
 * reached without exposing it to the browser and without a CORS surface — and
 * the store scope is decided here rather than trusted from the client.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { ProductDto } from '../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  /** Set when the write lost a race; the screen offers to reload rather than retry. */
  readonly conflict?: boolean;
}

function storeFor(handle: string): string {
  const storeId = STORE_IDS[handle];
  if (!storeId) throw new Error(`Unknown store "${handle}"`);
  return storeId;
}

/** Maps API failures onto something a screen can act on. */
function toResult<T>(error: unknown): ActionResult<T> {
  if (error instanceof ApiError) {
    return {
      ok: false,
      error: error.message,
      conflict: error.code === 'conflict',
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
}

export async function saveProduct(
  handle: string,
  input: {
    id: string;
    version: number;
    title: string;
    description: string;
    handle: string;
    status: ProductDto['status'];
    vendor: string | null;
    productType: string | null;
    price: { amount: string; currency: string };
  },
): Promise<ActionResult<ProductDto>> {
  try {
    const response = await apiFetch<ProductDto>(
      `/catalog/products/${input.id}`,
      { storeId: storeFor(handle), permissions: ['catalog.read', 'catalog.write'] },
      {
        method: 'PATCH',
        body: JSON.stringify({
          // The version we read is sent back; the server refuses the write if
          // someone else moved it on in the meantime.
          version: input.version,
          title: input.title,
          description: input.description,
          handle: input.handle,
          status: input.status,
          vendor: input.vendor,
          productType: input.productType,
          price: input.price,
        }),
      },
    );

    revalidatePath(`/store/${handle}/products`);
    revalidatePath(`/store/${handle}/products/${input.id}`);
    return { ok: true, data: response.data };
  } catch (error) {
    return toResult<ProductDto>(error);
  }
}

export async function createProduct(
  handle: string,
  input: {
    title: string;
    description?: string;
    price: { amount: string; currency: string };
  },
): Promise<ActionResult<ProductDto>> {
  try {
    const response = await apiFetch<ProductDto>(
      '/catalog/products',
      { storeId: storeFor(handle), permissions: ['catalog.read', 'catalog.write'] },
      { method: 'POST', body: JSON.stringify(input) },
    );
    revalidatePath(`/store/${handle}/products`);
    return { ok: true, data: response.data };
  } catch (error) {
    return toResult<ProductDto>(error);
  }
}

export async function publishProduct(
  handle: string,
  id: string,
  version: number,
): Promise<ActionResult<ProductDto>> {
  try {
    const response = await apiFetch<ProductDto>(
      `/catalog/products/${id}/publish`,
      {
        storeId: storeFor(handle),
        permissions: ['catalog.read', 'catalog.write', 'catalog.publish'],
      },
      { method: 'POST', body: JSON.stringify({ version, channels: ['online-store'] }) },
    );
    revalidatePath(`/store/${handle}/products/${id}`);
    return { ok: true, data: response.data };
  } catch (error) {
    return toResult<ProductDto>(error);
  }
}

export async function archiveProduct(
  handle: string,
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await apiFetch<{ id: string }>(
      `/catalog/products/${id}`,
      { storeId: storeFor(handle), permissions: ['catalog.read', 'catalog.write'] },
      { method: 'DELETE' },
    );
    revalidatePath(`/store/${handle}/products`);
    return { ok: true, data: { id } };
  } catch (error) {
    return toResult<{ id: string }>(error);
  }
}

/** Sends a write to the catalog's product surface and revalidates the screens. */
async function write(
  handle: string,
  path: string,
  method: 'PUT' | 'PATCH',
  body: Record<string, unknown>,
): Promise<ActionResult<ProductDto>> {
  try {
    const response = await apiFetch<ProductDto>(
      `/catalog/products${path}`,
      { storeId: storeFor(handle), permissions: ['catalog.read', 'catalog.write'] },
      { method, body: JSON.stringify(body) },
    );
    revalidatePath(`/store/${handle}/products`);
    return { ok: true, data: response.data };
  } catch (error) {
    return toResult<ProductDto>(error);
  }
}

/** Replaces the option sets, regenerating the variant matrix server-side. */
export async function setProductOptions(
  handle: string,
  id: string,
  version: number,
  options: readonly { name: string; values: readonly string[] }[],
) {
  return write(handle, `/${id}/options`, 'PUT', { version, options });
}

/** Per-variant price, SKU and stock. Which variants exist is not editable here. */
export async function saveVariants(
  handle: string,
  id: string,
  version: number,
  variants: readonly {
    id: string;
    sku: string | null;
    price: { amount: string; currency: string };
    inventoryQuantity: number;
  }[],
) {
  return write(handle, `/${id}/variants`, 'PATCH', { version, variants });
}
