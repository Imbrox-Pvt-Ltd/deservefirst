'use server';

/**
 * Web · app/actions/segments.ts
 * Saving a segment's question. There is no action for its members, because
 * membership is never written.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type { SegmentConditionDto, SegmentDto } from '../../lib/types';

export interface SegmentResult {
  readonly ok: boolean;
  readonly data?: SegmentDto;
  readonly error?: string;
  readonly conflict?: boolean;
}

export async function saveSegment(
  handle: string,
  id: string,
  version: number,
  patch: { name?: string; match?: 'all' | 'any'; conditions?: readonly SegmentConditionDto[] },
): Promise<SegmentResult> {
  try {
    const response = await apiFetch<SegmentDto>(`/customers/segments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, ...patch }),
    });
    revalidatePath(`/store/${handle}/customers/segments`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: 'Could not save this segment' };
  }
}

export async function createSegment(
  handle: string,
  input: { name: string; conditions: readonly SegmentConditionDto[] },
): Promise<SegmentResult> {
  try {
    const response = await apiFetch<SegmentDto>('/customers/segments', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(`/store/${handle}/customers/segments`);
    return { ok: true, data: response.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.message : 'Could not create this segment',
    };
  }
}
