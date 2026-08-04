'use server';

/**
 * Web · app/actions/collections.ts
 * Server actions for collection edits. Rules are saved as a whole set, matching
 * the API — a per-condition call would let the collection sit in a state the
 * rule engine cannot evaluate between two requests.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { CollectionDto, ConditionDto } from '../../lib/types';

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly conflict?: boolean;
}

async function call(
  handle: string,
  path: string,
  method: 'PATCH' | 'PUT' | 'POST',
  body: Record<string, unknown>,
): Promise<ActionResult<CollectionDto>> {

  try {
    const response = await apiFetch<CollectionDto>(
      `/catalog/collections${path}`,
      { method, body: JSON.stringify(body) },
    );
    revalidatePath(`/store/${handle}/collections`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function saveCollectionDetails(
  handle: string,
  input: { id: string; version: number; title: string; description: string },
) {
  return call(handle, `/${input.id}`, 'PATCH', {
    version: input.version,
    title: input.title,
    description: input.description,
  });
}

export async function saveCollectionRules(
  handle: string,
  input: {
    id: string;
    version: number;
    match: 'all' | 'any';
    conditions: readonly ConditionDto[];
    exclusions: readonly ConditionDto[];
  },
) {
  return call(handle, `/${input.id}/rules`, 'PUT', {
    version: input.version,
    match: input.match,
    conditions: input.conditions,
    exclusions: input.exclusions,
  });
}

/** Creates a collection. It starts manual; the first condition makes it automated. */
export async function createCollection(
  handle: string,
  input: { title: string; description?: string; type: 'manual' | 'automated' },
) {
  return call(handle, '', 'POST', input);
}
