'use server';

/**
 * Web · app/actions/content.ts
 * Server actions for pages, content types and their entries.
 *
 * Publishing is its own action rather than a field on the save, mirroring the
 * service: making a page live has an effect beyond the record, and a generic
 * form save must not be able to trigger it by accident.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from '../../lib/api';
import type {
  MetaobjectDefinitionDto,
  MetaobjectEntryDto,
  MetaobjectFieldDto,
  PageDto,
} from '../../lib/types';

export interface ActionResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly conflict?: boolean;
}

async function call<T>(
  handle: string,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  revalidate: readonly string[],
): Promise<ActionResult<T>> {
  try {
    const response = await apiFetch<T>(
      path,
      { method, body: JSON.stringify(body) },
    );
    for (const entry of revalidate) revalidatePath(`/store/${handle}${entry}`);
    return { ok: true, data: response.data };
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, error: error.message, conflict: error.code === 'conflict' };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// --- pages -------------------------------------------------------------------

export async function createPage(handle: string, input: { title: string; body?: string }) {
  return call<PageDto>(handle, '/content/pages', 'POST', input, ['/pages']);
}

export async function savePage(
  handle: string,
  id: string,
  version: number,
  patch: { title?: string; body?: string; handle?: string },
) {
  return call<PageDto>(handle, `/content/pages/${id}`, 'PATCH', { version, ...patch }, [
    '/pages',
    `/pages/${id}`,
  ]);
}

export async function setPageStatus(
  handle: string,
  id: string,
  version: number,
  status: 'draft' | 'published',
) {
  return call<PageDto>(handle, `/content/pages/${id}/status`, 'POST', { version, status }, [
    '/pages',
    `/pages/${id}`,
  ]);
}

// --- content types -------------------------------------------------------------

export async function createDefinition(
  handle: string,
  input: {
    type: string;
    name: string;
    description?: string | null;
    fields: readonly MetaobjectFieldDto[];
    displayNameKey?: string | null;
  },
) {
  return call<MetaobjectDefinitionDto>(handle, '/content/metaobject-definitions', 'POST', input, [
    '/content/metaobjects',
  ]);
}

export async function saveDefinition(
  handle: string,
  id: string,
  version: number,
  patch: {
    name?: string;
    description?: string | null;
    fields?: readonly MetaobjectFieldDto[];
    displayNameKey?: string | null;
  },
) {
  return call<MetaobjectDefinitionDto>(
    handle,
    `/content/metaobject-definitions/${id}`,
    'PATCH',
    { version, ...patch },
    ['/content/metaobjects', `/content/metaobjects/${id}`],
  );
}

// --- entries -------------------------------------------------------------------

export async function createEntry(
  handle: string,
  definitionId: string,
  values: Record<string, unknown>,
) {
  return call<MetaobjectEntryDto>(handle, '/content/metaobjects', 'POST', { definitionId, values }, [
    `/content/metaobjects/${definitionId}`,
  ]);
}

export async function saveEntry(
  handle: string,
  definitionId: string,
  id: string,
  version: number,
  patch: { values?: Record<string, unknown>; status?: 'draft' | 'published' },
) {
  return call<MetaobjectEntryDto>(
    handle,
    `/content/metaobjects/${id}`,
    'PATCH',
    { version, ...patch },
    [`/content/metaobjects/${definitionId}`, `/content/metaobjects/${definitionId}/entries/${id}`],
  );
}

export async function createMenu(
  storeHandle: string,
  input: { title: string; handle: string },
) {
  // An empty menu, not a menu with a default item. A merchant adding "Main
  // menu" has not asked for a Home link, and guessing one they then delete is
  // worse than an empty list.
  return call<{ id: string }>(storeHandle, '/content/menus', 'POST', { ...input, items: [] }, [
    '/navigation',
  ]);
}

export async function createBlogPost(
  storeHandle: string,
  input: { blogId: string; title: string; body: string },
) {
  // A draft with no date. Publishing is a separate decision, and a post that
  // went live the moment it was created is the wrong default in every case.
  return call<{ id: string }>(
    storeHandle,
    '/content/blog_posts',
    'POST',
    { ...input, status: 'draft', publishedAt: null },
    ['/blogs'],
  );
}
