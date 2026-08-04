/**
 * Web · app/store/[handle]/oauth/authorize/page.tsx
 * Where an app sends a merchant to be asked.
 *
 * Under /store/{handle} on purpose: an install is scoped to one store, and
 * putting the store in the path means the question "which store am I granting
 * access to" is answered by the URL rather than by whatever the session
 * happened to be pointing at when the link was opened.
 * Layer: web.
 */

import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api';
import { currentSession } from '../../../../../lib/stores';
import { AppConsent } from '../../../../../components/AppConsent';
import { ErrorState } from '../../../../../components/ErrorState';
import type { AppConsentDto } from '../../../../../lib/types';

export default async function AuthorizePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  const search = await searchParams;
  const one = (key: string) => {
    const value = search[key];
    return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? null) : null;
  };

  const session = await currentSession();
  if (!session) {
    // Returns them here afterwards, with the whole query intact — losing it
    // would drop the state and challenge and break the app's flow silently.
    const query = new URLSearchParams(
      Object.entries(search).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value] as [string, string]] : [],
      ),
    );
    redirect(
      `/login?returnPath=${encodeURIComponent(`/store/${handle}/oauth/authorize?${query.toString()}`)}`,
    );
  }

  const clientId = one('client_id');
  const redirectUri = one('redirect_uri');

  if (!clientId || !redirectUri) {
    return (
      <ErrorState
        pageTitle="Install app"
        title="This install link is incomplete"
        message="It is missing the app, or the address to return to."
        hint="Ask the app to send you a new install link."
        backUrl={`/store/${handle}/settings/apps`}
      />
    );
  }

  let consent: AppConsentDto;
  try {
    const scope = one('scope') ?? '';
    const response = await apiFetch<{
      app: { name: string; handle: string; appUrl: string | null };
      scopes: AppConsentDto['scopes'];
      alreadyInstalled: boolean;
      redirectUri: string;
      state: string | null;
      codeChallenge: string | null;
      codeChallengeMethod: string | null;
    }>(
      `/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scope)}` +
        `&state=${encodeURIComponent(one('state') ?? '')}` +
        `&code_challenge=${encodeURIComponent(one('code_challenge') ?? '')}` +
        `&code_challenge_method=${encodeURIComponent(one('code_challenge_method') ?? '')}`,
    );

    consent = {
      clientId,
      appName: response.data.app.name,
      appHandle: response.data.app.handle,
      appUrl: response.data.app.appUrl,
      redirectUri: response.data.redirectUri,
      scopes: response.data.scopes,
      alreadyInstalled: response.data.alreadyInstalled,
      state: response.data.state,
      codeChallenge: response.data.codeChallenge,
      codeChallengeMethod: response.data.codeChallengeMethod,
    };
  } catch (error) {
    // Shown here rather than redirected. Sending an error to a URI we have not
    // verified is the same disclosure as sending a code there.
    return (
      <ErrorState
        pageTitle="Install app"
        title="This app cannot be installed"
        message={error instanceof Error ? error.message : 'The install could not be started.'}
        backUrl={`/store/${handle}/settings/apps`}
      />
    );
  }

  return (
    <AppConsent
      handle={handle}
      consent={consent}
      canInstall={session.permissions.includes('store.apps.manage')}
    />
  );
}
