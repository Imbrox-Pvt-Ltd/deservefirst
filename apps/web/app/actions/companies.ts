'use server';

/**
 * Web · app/actions/companies.ts
 * Editing a company. Locations and contacts are replaced as whole sets, matching
 * the API: the invariants span them, so a per-item save could leave the company
 * in a state that satisfies none of them.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { CompanyContactDto, CompanyDto, CompanyLocationDto } from '../../lib/types';

export interface CompanyResult {
  readonly ok: boolean;
  readonly data?: CompanyDto;
  readonly error?: string;
  readonly conflict?: boolean;
}

async function call(
  handle: string,
  id: string,
  path: string,
  method: 'PUT' | 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<CompanyResult> {
  try {
    const response = await apiFetch<CompanyDto>(`/customers/companies/${id}${path}`, {
      method,
      body: JSON.stringify(body),
    });
    revalidatePath(`/store/${handle}/companies`);
    revalidatePath(`/store/${handle}/companies/${id}`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: 'Could not save this company' };
  }
}

export async function saveCompanyLocations(
  handle: string,
  id: string,
  version: number,
  locations: readonly CompanyLocationDto[],
) {
  return call(handle, id, '/locations', 'PUT', {
    version,
    // Ids the API generated are kept; a placeholder from a newly added row is
    // dropped so the server mints a real one. Reusing "new-1" would collide the
    // moment two are added in one edit.
    locations: locations.map((location) => ({
      ...(location.id.startsWith('new-') ? {} : { id: location.id }),
      name: location.name,
      addressLine1: location.addressLine1,
      city: location.city,
      countryCode: location.countryCode,
      paymentTerms: location.paymentTerms,
      creditLimitMinor: location.creditLimitMinor,
      isDefault: location.isDefault,
    })),
  });
}

export async function saveCompanyContacts(
  handle: string,
  id: string,
  version: number,
  contacts: readonly CompanyContactDto[],
) {
  return call(handle, id, '/contacts', 'PUT', {
    version,
    contacts: contacts.map((contact) => ({
      ...(contact.id.startsWith('new-') ? {} : { id: contact.id }),
      customerId: contact.customerId,
      role: contact.role,
      locationIds: contact.locationIds,
      isPrimary: contact.isPrimary,
    })),
  });
}

export async function setCompanyStatus(
  handle: string,
  id: string,
  version: number,
  status: 'active' | 'on-hold' | 'closed',
) {
  return call(handle, id, '/status', 'POST', { version, status });
}

export async function createCompany(
  handle: string,
  input: {
    name: string;
    externalId?: string | null;
    location: { name: string; countryCode: string };
  },
): Promise<CompanyResult> {
  try {
    const response = await apiFetch<CompanyDto>('/customers/companies', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/store/${handle}/companies`);
    return { ok: true, data: response.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.message : 'Could not create this company',
    };
  }
}
