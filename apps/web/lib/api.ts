/**
 * Web · lib/api.ts
 * The typed client for the platform API. One place that knows the base URL, the
 * dated version and how the response envelope unwraps — so no screen parses a
 * response by hand.
 * Layer: web/lib.
 */

import { cookies } from 'next/headers';

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

/**
 * Calls the API as the signed-in person.
 *
 * The session cookie is forwarded from the incoming request, because this runs
 * on the server: a server component has no ambient cookie jar, so without this
 * every call would arrive anonymous. Nothing about identity is sent as a header
 * — the API stopped accepting that, and the fitness suite keeps it that way.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta: ApiResponse<T>['meta'] }> {
  const response = await fetch(`${BASE_URL}/${API_VERSION}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(await sessionHeader()),
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

/**
 * Whether a failure was a missing resource. Screens previously pattern-matched
 * the message, which is fragile and was already wrong: the API's detail string
 * says "No request with id …", containing neither "404" nor "not_found". The
 * typed code was there the whole time.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'forbidden' || error.code === 'not_entitled');
}

/**
 * Forwards the browser's session cookie to the API.
 *
 * Returns nothing outside a request — during a build there is no signed-in
 * person, and a page that renders anonymously at build time is correct rather
 * than broken.
 */
async function sessionHeader(): Promise<Record<string, string>> {
  try {
    const jar = await cookies();
    const session = jar.get('df_session');
    return session ? { cookie: `df_session=${session.value}` } : {};
  } catch {
    return {};
  }
}

/** Whether a failure was "you are not signed in". */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated';
}
