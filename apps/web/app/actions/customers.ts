'use server';

/**
 * Web · app/actions/customers.ts
 * Server actions for customer edits. Consent is its own action, mirroring the
 * service — a generic save must not be able to change it.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { CustomerDto } from '../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

const PERMISSIONS = ['customers.read', 'customers.manage'];

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly conflict?: boolean;
}

async function call(
  handle: string,
  path: string,
  method: 'PATCH' | 'POST',
  body: Record<string, unknown>,
): Promise<ActionResult<CustomerDto>> {
  const storeId = STORE_IDS[handle];
  if (!storeId) return { ok: false, error: `Unknown store "${handle}"` };

  try {
    const response = await apiFetch<CustomerDto>(
      `/customers/customers${path}`,
      { storeId, permissions: PERMISSIONS },
      { method, body: JSON.stringify(body) },
    );
    revalidatePath(`/store/${handle}/customers`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function saveCustomer(
  handle: string,
  input: {
    id: string;
    version: number;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    taxExempt: boolean;
  },
) {
  return call(handle, `/${input.id}`, 'PATCH', {
    version: input.version,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    taxExempt: input.taxExempt,
  });
}

export async function changeConsent(
  handle: string,
  id: string,
  channel: 'email' | 'sms',
  to: string,
  version: number,
) {
  return call(handle, `/${id}/consent`, 'POST', { channel, to, version });
}
