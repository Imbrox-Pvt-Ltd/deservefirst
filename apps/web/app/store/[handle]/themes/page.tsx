/**
 * Web · app/store/[handle]/themes/page.tsx
 * The themes a store has.
 *
 * This path was reachable from the navigation and fell through to the "not
 * installed yet" placeholder, which is what the catch-all is for and was the
 * wrong answer here — the module IS installed, and until now there was simply
 * nowhere to see its themes or add one.
 * Layer: web.
 */

import { ErrorState } from '../../../../components/ErrorState';
import { ThemeLibrary, type ThemeDto } from '../../../../components/ThemeLibrary';
import { apiFetch } from '../../../../lib/api';

export default async function ThemesPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  try {
    const response = await apiFetch<{ themes: ThemeDto[] }>('/storefront/editor/themes');
    return <ThemeLibrary handle={handle} themes={response.data.themes} />;
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Themes"
        title="Could not load themes"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
