'use server';

/**
 * Web · app/actions/explorer.ts
 * Sending a request from the explorer, as the person using it.
 *
 * The session cookie is forwarded, so a request from here is authorised exactly
 * as the same request from anywhere else. That is the point: an explorer that
 * bypassed authorisation would teach people an API that does not exist, and one
 * that used a privileged key would show them responses they could never get.
 * Layer: web/actions.
 */

import { apiFetch } from '../../lib/api';

export interface ExplorerResponse {
  readonly status: number;
  readonly body: string;
}

/** Methods the explorer will send. Anything else is a typo, not a request. */
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

export async function sendApiRequest(input: {
  method: string;
  path: string;
  body: string | null;
}): Promise<ExplorerResponse> {
  if (!METHODS.has(input.method)) {
    return { status: 0, body: `${input.method} is not a method the explorer sends.` };
  }

  /**
   * The path must stay inside the API.
   *
   * `apiFetch` prepends the API base, so a path starting `//` or containing a
   * scheme would send the operator's session somewhere else entirely. Checked
   * rather than trusted, because the field is free text by design.
   */
  const path = input.path.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    return { status: 0, body: 'The path must be a path on this API, starting with /' };
  }

  try {
    const response = await apiFetch<unknown>(path.replace(/^\/2026-01/, ''), {
      method: input.method,
      ...(input.body ? { body: input.body } : {}),
    });
    return { status: 200, body: JSON.stringify(response, null, 2) };
  } catch (error) {
    // The refusals are the interesting half — an explorer that hid them would
    // be showing a happier API than the one that exists.
    return {
      status: 400,
      body: error instanceof Error ? error.message : 'The request failed',
    };
  }
}
