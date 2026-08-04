'use server';

/**
 * Web · app/actions/consent.ts
 * The merchant's answer on the consent screen, and the redirect back.
 *
 * The redirect is built here rather than returned to the client because the URL
 * carries the authorization code: handing it to the browser as data invites it
 * into a log, a history entry or an error report on the way to being used.
 * Layer: web/actions.
 */

import { redirect } from 'next/navigation';

import { apiFetch } from '../../lib/api';
import { callbackUrl, denialUrl } from '../../lib/oauth-callback';

export interface ConsentResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function approveInstall(
  handle: string,
  input: {
    grant: boolean;
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    state: string | null;
    codeChallenge: string | null;
    codeChallengeMethod: string | null;
  },
): Promise<ConsentResult> {
  let destination: string;

  if (!input.grant) {
    /**
     * Declining is a real answer, not an error page.
     *
     * The app is told in the way the specification says to tell it, on the URI
     * it registered — an app that never hears back cannot distinguish "the
     * merchant said no" from "the merchant closed the tab", and will keep
     * asking.
     */
    destination = denialUrl(input.redirectUri, input.state);
  } else {
    try {
      const response = await apiFetch<{ code: string; redirectUri: string; state: string | null }>(
        '/oauth/authorize',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: input.clientId,
            redirectUri: input.redirectUri,
            scopes: input.scopes,
            tokenType: 'offline',
            state: input.state,
            codeChallenge: input.codeChallenge,
            codeChallengeMethod: input.codeChallengeMethod,
          }),
        },
      );

      // Echoed exactly as the app sent it, so its own comparison succeeds.
      destination = callbackUrl(response.data.redirectUri, {
        code: response.data.code,
        state: response.data.state,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not complete the install',
      };
    }
  }

  // Outside the try: redirect() works by throwing, and catching it here would
  // turn every successful install into "Could not complete the install".
  redirect(destination);
}
