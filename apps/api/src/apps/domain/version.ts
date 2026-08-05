/**
 * Apps · domain/version.ts
 * A released version of an app, and why scopes belong to one.
 *
 * Until now an app's scopes lived on the app, which meant editing them changed
 * what every merchant had agreed to — retroactively, and without anybody being
 * asked. The install froze the granted list, so nothing actually widened, but
 * the app's own record of what it asks for drifted away from what its installs
 * were running under, and there was no way to answer "what did this merchant
 * consent to" except by reading their installation row.
 *
 * A version is the answer. It is an immutable snapshot — scopes, URLs, the
 * webhook API version — and an installation names the one it consented to. That
 * makes two questions decidable that were not: what is this merchant running,
 * and does the version I just released need them asked again.
 * Layer: domain (pure).
 */

import { AppRuleError } from './app';

export type VersionStatus = 'draft' | 'released';

export interface AppVersion {
  readonly id: string;
  readonly appId: string;
  /** The author's name for it — "1.4.0", "adds order webhooks". Free text. */
  readonly name: string;
  /** Shown to merchants on re-consent, so it should say what changed. */
  readonly message: string | null;
  readonly status: VersionStatus;
  readonly scopes: readonly string[];
  readonly redirectUris: readonly string[];
  readonly appUrl: string | null;
  /**
   * The dated version of the webhook payloads this release expects.
   *
   * Pinned per version rather than per app, which is the whole point: an app
   * can move to a newer payload shape in a new release without every installed
   * merchant's deliveries changing shape underneath the running code.
   */
  readonly webhookApiVersion: string;
  readonly createdAt: Date;
  readonly releasedAt: Date | null;
}

/**
 * A released version never changes.
 *
 * Merchants consented to a specific list of scopes. If a released version could
 * be edited, that consent would mean nothing — an app could be approved asking
 * for products and then quietly become one asking for customer contact details,
 * with every existing install still pointing at the same version id.
 */
export function assertEditable(version: AppVersion): void {
  if (version.status === 'released') {
    throw new AppRuleError(
      'status',
      'a released version cannot be changed — create a new one instead',
    );
  }
}

export function assertReleasable(version: AppVersion, declaredScopes: readonly string[]): void {
  if (version.status === 'released') {
    throw new AppRuleError('status', 'this version has already been released');
  }
  if (version.name.trim().length === 0) {
    throw new AppRuleError('name', 'a release needs a name');
  }
  if (version.redirectUris.length === 0) {
    throw new AppRuleError('redirectUris', 'a release needs at least one redirect URL');
  }

  // The version cannot ask for something the app itself has not registered.
  // The app's list is what the platform reviewed; a version reaching past it
  // would route around review by way of a release.
  const registered = new Set(declaredScopes);
  const beyond = version.scopes.filter((scope) => !registered.has(scope));
  if (beyond.length > 0) {
    throw new AppRuleError(
      'scopes',
      `this version asks for ${beyond.join(', ')}, which the app has not registered`,
    );
  }
}

/**
 * Whether moving an install from one version to another needs the merchant.
 *
 * Only widening does. A release that drops a scope, or changes nothing but a
 * URL, applies to existing installs silently — asking a merchant to re-approve
 * strictly less access is a prompt that teaches them to click through prompts.
 */
export function requiresReconsent(from: AppVersion | null, to: AppVersion): boolean {
  if (!from) return true;
  const had = new Set(from.scopes);
  return to.scopes.some((scope) => !had.has(scope));
}

/** Scopes in `to` that `from` did not have — what the merchant is being asked for. */
export function addedScopes(from: AppVersion | null, to: AppVersion): readonly string[] {
  const had = new Set(from?.scopes ?? []);
  return to.scopes.filter((scope) => !had.has(scope));
}

/**
 * The version a merchant installs: the newest released one.
 *
 * Drafts are invisible to merchants by construction rather than by a filter
 * somebody has to remember — an unreleased version is the author's working
 * copy, and installing one would mean consenting to something still being
 * edited.
 */
export function currentVersion(versions: readonly AppVersion[]): AppVersion | null {
  const released = versions
    .filter((version) => version.status === 'released' && version.releasedAt !== null)
    .sort((a, b) => (b.releasedAt as Date).getTime() - (a.releasedAt as Date).getTime());
  return released[0] ?? null;
}
