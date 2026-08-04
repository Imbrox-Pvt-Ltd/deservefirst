/**
 * Web · lib/oauth-callback.ts
 * Building the URL a merchant is sent back to.
 *
 * Pure and separate from the action so it can be tested, because it is the part
 * of the consent flow where a quiet bug does real damage: dropping `state`
 * breaks the app's CSRF check while everything still appears to work, and
 * clobbering an existing query parameter breaks callbacks that carry their own.
 * Layer: web/lib.
 */

/** The redirect after the merchant says yes. */
export function callbackUrl(
  redirectUri: string,
  result: { code: string; state: string | null },
): string {
  const url = new URL(redirectUri);
  // `set`, not `append`: a retry must not accumulate a second code.
  url.searchParams.set('code', result.code);
  if (result.state !== null && result.state !== '') url.searchParams.set('state', result.state);
  return url.toString();
}

/**
 * The redirect after the merchant says no.
 *
 * A real answer, delivered the way the specification says to deliver it. An app
 * that never hears back cannot tell "the merchant declined" from "the merchant
 * closed the tab", so it asks again — and the merchant declines again.
 */
export function denialUrl(redirectUri: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', 'The merchant declined the install.');
  if (state !== null && state !== '') url.searchParams.set('state', state);
  return url.toString();
}
