'use server';

/**
 * Web · app/actions/content-editing.ts
 * Saving menus and blog posts.
 *
 * Both send the version they were loaded at. The API decides the outcome from
 * affected rows, so a second editor who saved first wins and this one is told to
 * reload — rather than the last write silently erasing the first.
 * Layer: web/actions.
 */

import { revalidatePath } from 'next/cache';

import { apiFetch } from '../../lib/api';
import type { MenuItemDto } from '../../lib/types';

export interface EditResult {
  readonly ok: boolean;
  readonly error?: string;
}

function failed(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : 'The request failed' };
}

export async function saveMenu(
  handle: string,
  id: string,
  version: number,
  patch: { title: string; items: readonly MenuItemDto[] },
): Promise<EditResult> {
  try {
    await apiFetch(`/content/menus/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, ...patch }),
    });
    revalidatePath(`/store/${handle}/navigation`);
    revalidatePath(`/store/${handle}/navigation/${id}`);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function saveBlogPost(
  handle: string,
  id: string,
  version: number,
  patch: {
    title?: string;
    body?: string;
    status?: 'draft' | 'published';
    /** ISO string, or null to clear. Absent means "leave it alone". */
    publishedAt?: string | null;
  },
): Promise<EditResult> {
  try {
    await apiFetch(`/content/blog_posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, ...patch }),
    });
    revalidatePath(`/store/${handle}/blogs`);
    revalidatePath(`/store/${handle}/blogs/${id}`);
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}
