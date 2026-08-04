/**
 * Web · lib/api.ts
 * The typed client for the platform API. One place that knows the base URL, the
 * dated version and how the response envelope unwraps — so no screen parses a
 * response by hand.
 * Layer: web/lib.
 */

import type { ApiResponse } from './types';

const API_VERSION = '2026-01';
const BASE_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

export interface RequestScope {
  readonly storeId: string;
  readonly permissions?: readonly string[];
  readonly requestId?: string;
}

/**
 * Calls the API with the active store's context. Until the login UI exists the
 * scope travels in headers; when auth is wired this becomes the session cookie
 * and the headers stop being trusted (see main.ts).
 */
export async function apiFetch<T>(
  path: string,
  scope: RequestScope,
  init: RequestInit = {},
): Promise<{ data: T; meta: ApiResponse<T>['meta'] }> {
  const response = await fetch(`${BASE_URL}/${API_VERSION}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-store-id': scope.storeId,
      'x-permissions': (scope.permissions ?? ['catalog.read', 'catalog.write', 'store.read']).join(','),
      ...(scope.requestId ? { 'x-request-id': scope.requestId } : {}),
      ...(init.headers ?? {}),
    },
    // The admin must always reflect current data; a cached product list is a
    // support ticket waiting to happen.
    cache: 'no-store',
  });

  const body = (await response.json()) as ApiResponse<T>;

  if (!response.ok || body.errors.length > 0) {
    const error = body.errors[0];
    throw new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.detail ?? `Request to ${path} failed with ${response.status}`,
    );
  }

  return { data: body.data as T, meta: body.meta };
}

/** Passes the caller's URL search params straight through — list state is the URL. */
export function withSearch(path: string, search: URLSearchParams | string): string {
  const query = typeof search === 'string' ? search : search.toString();
  return query ? `${path}?${query}` : path;
}
