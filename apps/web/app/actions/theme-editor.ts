'use server';

/**
 * Web · app/actions/theme-editor.ts
 * Editing, discarding and publishing a theme.
 *
 * These replace three `fetch('/api/storefront/…')` calls the editor made from
 * the browser. They could never have worked: this app registers no route
 * handlers and no rewrite under `/api`, so every one was a 404 against Next
 * itself — and the paths did not match the controller's routes either. The
 * editor rendered, and none of its buttons did anything.
 *
 * Server actions rather than route handlers, because that is how every other
 * write in this app reaches the API: `apiFetch` forwards the session cookie
 * server-side, and a call made from the browser would arrive anonymous even if
 * there were something to receive it.
 * Layer: web/actions.
 */

import { apiFetch } from '../../lib/api';

export interface EditorResult<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
  /**
   * The API's own error code, which the editor needs.
   *
   * A conflict means reload; a validation failure means fix the value. Losing
   * the distinction is what turns "somebody else saved first" into a generic
   * failure a merchant cannot act on.
   */
  readonly code?: string;
}

async function attempt<T>(work: () => Promise<{ data: T }>): Promise<EditorResult<T>> {
  try {
    return { ok: true, data: (await work()).data };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The request failed';
    const code = (error as { code?: string }).code;
    return { ok: false, error: detail, code };
  }
}

export interface EditedDocument {
  readonly sections: readonly unknown[];
  readonly version: number;
}

export async function applyThemeEdit(
  themeId: string,
  templatePath: string,
  action: unknown,
  expectedVersion: number,
): Promise<EditorResult<EditedDocument>> {
  return attempt(() =>
    apiFetch<EditedDocument>('/storefront/editor/edit', {
      method: 'POST',
      // The version travels with the edit: the API decides the outcome from
      // affected rows, so a colleague who saved first wins and this one is
      // told to reload rather than silently erasing their work.
      body: JSON.stringify({ themeId, templatePath, action, expectedVersion }),
    }),
  );
}

export async function discardThemeDraft(
  themeId: string,
  templatePath: string,
): Promise<EditorResult<{ discarded: boolean }>> {
  const search = new URLSearchParams({ theme: themeId, template: templatePath });
  return attempt(() =>
    apiFetch<{ discarded: boolean }>(`/storefront/editor/draft?${search.toString()}`, {
      method: 'DELETE',
    }),
  );
}

export async function publishTheme(themeId: string): Promise<EditorResult<{ published: boolean }>> {
  return attempt(() =>
    apiFetch<{ published: boolean }>('/storefront/editor/publish', {
      method: 'POST',
      body: JSON.stringify({ themeId }),
    }),
  );
}
