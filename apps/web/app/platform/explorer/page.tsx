/**
 * Web · app/platform/explorer/page.tsx
 * The API explorer, on the operator surface.
 * Layer: web.
 */

import { ApiExplorer, type ApiOperation } from '../../../components/ApiExplorer';
import { apiFetch } from '../../../lib/api';

interface OpenApiDocument {
  readonly paths: Record<string, Record<string, {
    summary?: string;
    tags?: string[];
    security?: { permission?: string[] }[];
  }>>;
}

export default async function ApiExplorerPage() {
  let operations: ApiOperation[] = [];

  try {
    // The generated document, served by the API rather than re-derived here —
    // an explorer describing a different API from the reference would be worse
    // than no explorer.
    const response = await apiFetch<OpenApiDocument>('/platform/api-reference');

    operations = Object.entries(response.data.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? '',
        permission: operation.security?.[0]?.permission?.[0] ?? null,
        tag: operation.tags?.[0] ?? 'platform',
      })),
    );
  } catch {
    operations = [];
  }

  return <ApiExplorer operations={operations} />;
}
