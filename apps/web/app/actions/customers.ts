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

  try {
    const response = await apiFetch<CustomerDto>(
      `/customers/customers${path}`,
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

/**
 * Creates a customer. Consent is deliberately not a field here — a staff-created
 * record has not opted in to anything, and the API refuses to take it on create.
 */
export async function createCustomer(
  handle: string,
  input: { email: string | null; firstName: string | null; lastName: string | null; phone: string | null },
) {
  return call(handle, '', 'POST', input);
}
