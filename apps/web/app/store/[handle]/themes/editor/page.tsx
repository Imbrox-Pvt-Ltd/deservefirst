/**
 * Web · app/store/[handle]/themes/editor/page.tsx
 * The theme editor.
 *
 * A server component that fetches the draft and the theme's schemas, then hands
 * them to the client editor. Which theme and template are being edited live in
 * the URL (§24) — so a merchant can send a colleague a link to the exact thing
 * they are looking at, and a reload lands back in the same place.
 * Layer: web.
 */

import { ErrorState } from '../../../../../components/ErrorState';
import { ThemeEditor } from '../../../../../components/theme-editor/ThemeEditor';
import { apiFetch } from '../../../../../lib/api';

interface EditorPayload {
  readonly themeId: string;
  readonly templatePath: string;
  readonly templates: readonly string[];
  readonly sections: readonly never[];
  readonly version: number;
  readonly schemas: Readonly<Record<string, never>>;
  readonly addable: readonly { type: string; name: string }[];
  readonly previewUrl: string;
  readonly unusable?: readonly { type: string; reason: string }[];
  readonly hasUnsavedChanges: boolean;
}

export default async function ThemeEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { handle } = await params;
  const query = await searchParams;

  const search = new URLSearchParams();
  if (query.theme) search.set('theme', query.theme);
  if (query.template) search.set('template', query.template);

  try {
    const response = await apiFetch<EditorPayload>(`/storefront/editor?${search.toString()}`);
    return <ThemeEditor storeHandle={handle} {...response.data} />;
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Theme editor"
        title="The editor could not open"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Does this store have a published theme?"
      />
    );
  }
}
