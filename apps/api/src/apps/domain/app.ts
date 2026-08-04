/**
 * Apps · domain/app.ts
 * Third-party apps, and the rules that make installing one safe.
 *
 * OAuth is easy to make work and easy to make wrong, and the wrong versions
 * pass every happy-path test. The failures that matter here are all "it worked,
 * and it also did something else":
 *
 *   - a redirect URI matched by prefix, so `https://app.test.evil.com` passes a
 *     check written for `https://app.test` and the code lands on the attacker
 *   - an authorization code that can be exchanged twice, so anyone who captures
 *     one from a log or a referrer gets a token of their own
 *   - a token issued with the scopes the APP asked for at exchange time rather
 *     than the ones the MERCHANT approved at install time
 *   - an uninstall that removes a row but leaves live tokens working
 *
 * Each of those is a one-line difference from the correct version. They are
 * written here as rules rather than left to the service, because the service is
 * where a hurried change goes.
 * Layer: domain (pure).
 */

import { createHash } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

export type AppStatus = 'draft' | 'published' | 'suspended';
export type AppDistribution = 'public' | 'custom';
export type InstallationStatus = 'installed' | 'uninstalled';

/**
 * Online tokens act as the person who authorised them and expire; offline
 * tokens act as the app and do not. An app doing background work needs offline;
 * an app rendering something for the person in front of it should use online,
 * so its reach ends when their access does.
 */
export type TokenType = 'online' | 'offline';

export class AppRuleError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'AppRuleError';
  }
}

export class OAuthError extends Error {
  readonly status = 400;
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'OAuthError';
  }
}

export interface App {
  readonly id: string;
  readonly partnerId: string;
  readonly name: string;
  readonly handle: string;
  readonly status: AppStatus;
  readonly distribution: AppDistribution;
  readonly appUrl: string | null;
  /** Exact URIs a code may be sent to. Never prefixes — see `redirectIsRegistered`. */
  readonly redirectUris: readonly string[];
  /** What the app asks every merchant for. The merchant may grant less. */
  readonly requestedScopes: readonly string[];
  readonly clientId: string;
  readonly clientSecretHash: string;
  /**
   * Where lifecycle events are sent. Optional — an app that does no background
   * work does not need one.
   */
  readonly webhookUrl: string | null;
  /**
   * Signs those deliveries. Stored recoverably, unlike the client secret,
   * because an HMAC cannot be computed from a digest — a different secret for a
   * different job rather than reusing the one that grants tokens.
   */
  readonly webhookSecret: string | null;
  /**
   * Why an operator stopped this app. Null unless suspended.
   *
   * Carried on the app rather than left in an audit log, because the people who
   * need it are the merchants who installed it — and "the app stopped working"
   * with no reason is a support ticket per merchant.
   */
  readonly suspendedReason: string | null;
  readonly version: number;
}

export interface AppInstallation {
  readonly id: string;
  readonly appId: string;
  readonly storeId: StoreId;
  readonly status: InstallationStatus;
  /**
   * What the merchant actually approved, frozen at consent.
   *
   * Stored rather than read back off the app, because the app can change what
   * it requests at any time and that must not silently widen an existing
   * install. A wider request produces a re-consent, not a bigger token.
   */
  readonly grantedScopes: readonly string[];
  readonly installedAt: Date;
  readonly uninstalledAt: Date | null;
}

export interface AuthorizationCode {
  readonly code: string;
  readonly appId: string;
  readonly storeId: StoreId;
  readonly userId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly tokenType: TokenType;
  /**
   * The app's own CSRF token, echoed back untouched on the redirect.
   *
   * Ours to carry, not to interpret. Dropping it — which this did — leaves the
   * app unable to tell its own authorization apart from one an attacker
   * started, which is the entire attack `state` exists to stop.
   */
  readonly state: string | null;
  /** PKCE: the S256 digest of a verifier only the real client holds. */
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: 'S256' | null;
  readonly expiresAt: Date;
  /** Set the moment it is exchanged. A second exchange must fail. */
  readonly usedAt: Date | null;
}

export interface AppToken {
  readonly id: string;
  readonly appId: string;
  readonly storeId: StoreId;
  readonly tokenType: TokenType;
  /** Null for offline tokens: they act as the app, not as a person. */
  readonly userId: string | null;
  readonly tokenHash: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

/** How long an authorization code lives. Long enough to redirect, no longer. */
export const CODE_TTL_SECONDS = 300;

/** Online tokens follow the person; a day is longer than any single session. */
export const ONLINE_TOKEN_TTL_SECONDS = 86_400;

// --- registering an app ------------------------------------------------------

const HANDLE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;

export function assertAppValid(app: App): void {
  if (app.name.trim().length === 0) throw new AppRuleError('name', 'is required');
  if (!HANDLE.test(app.handle)) {
    throw new AppRuleError('handle', 'must be lowercase letters, digits and hyphens');
  }

  if (app.redirectUris.length === 0) {
    throw new AppRuleError('redirectUris', 'at least one redirect URL is required');
  }
  for (const uri of app.redirectUris) assertRedirectUriValid(uri);

  if (new Set(app.redirectUris).size !== app.redirectUris.length) {
    throw new AppRuleError('redirectUris', 'the same redirect URL is listed twice');
  }
}

export function assertRedirectUriValid(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AppRuleError('redirectUris', `"${uri}" is not an absolute URL`);
  }

  if (parsed.protocol !== 'https:' && !isLoopback(parsed.hostname)) {
    throw new AppRuleError('redirectUris', `"${uri}" must use https`);
  }
  if (parsed.hash.length > 0) {
    // A fragment never reaches the server, so it cannot be part of a match, and
    // allowing it invites a registration that looks stricter than it is.
    throw new AppRuleError('redirectUris', `"${uri}" must not contain a fragment`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new AppRuleError('redirectUris', `"${uri}" must not contain credentials`);
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Whether a code may be sent here. EXACT string match, deliberately.
 *
 * Prefix matching is the classic hole: a check for `https://app.test` also
 * accepts `https://app.test.evil.com`, and one for `https://app.test/cb`
 * accepts `https://app.test/cb/../../wherever`. Comparing whole strings is
 * blunt and cannot be argued around, and the cost — an app registering each
 * callback it uses — is a form field, once.
 */
export function redirectIsRegistered(app: App, uri: string): boolean {
  return app.redirectUris.includes(uri);
}

// --- asking a merchant -------------------------------------------------------

export function assertInstallable(app: App): void {
  if (app.status === 'suspended') {
    throw new OAuthError(
      'app_suspended',
      app.suspendedReason
        ? `This app has been suspended: ${app.suspendedReason}`
        : 'This app has been suspended and cannot be installed.',
    );
  }
  if (app.status === 'draft' && app.distribution === 'public') {
    throw new OAuthError('app_not_published', 'This app is not published yet.');
  }
}

/**
 * The scopes to put in front of the merchant.
 *
 * An app may ask for fewer than it registered — a narrower install for a
 * narrower job is a good thing — but never for one it did not declare, because
 * the declared list is what the platform reviewed.
 */
export function scopesToConsent(app: App, requested: readonly string[]): readonly string[] {
  if (requested.length === 0) return [...app.requestedScopes];

  const declared = new Set(app.requestedScopes);
  const undeclared = requested.filter((scope) => !declared.has(scope));
  if (undeclared.length > 0) {
    throw new OAuthError(
      'invalid_scope',
      `This app has not registered the scope${undeclared.length === 1 ? '' : 's'}: ${undeclared.join(', ')}`,
    );
  }
  return [...requested];
}

/**
 * Whether the merchant has to be asked again.
 *
 * True when the app now wants something the existing install does not cover.
 * Checked on every authorize rather than at publish time, because the app can
 * change what it asks for without telling anybody who already installed it.
 */
export function needsReconsent(
  installation: AppInstallation,
  wanted: readonly string[],
): boolean {
  if (installation.status !== 'installed') return true;
  const granted = new Set(installation.grantedScopes);
  return wanted.some((scope) => !granted.has(scope));
}

// --- exchanging the code -----------------------------------------------------

/**
 * PKCE, S256 only.
 *
 * `plain` is in the specification and is worth nothing: the challenge and the
 * verifier are the same string, so anyone who intercepted the authorization
 * request can complete the exchange. Supporting it would let a client opt out
 * of the protection while appearing to use it, so it is not offered.
 */
export function assertChallengeValid(
  challenge: string | null,
  method: string | null,
): { challenge: string | null; method: 'S256' | null } {
  if (challenge === null || challenge.length === 0) {
    if (method) throw new OAuthError('invalid_request', 'A code challenge method needs a challenge.');
    return { challenge: null, method: null };
  }
  if (method !== null && method !== 'S256') {
    throw new OAuthError('invalid_request', 'Only the S256 code challenge method is supported.');
  }
  if (challenge.length < 43) {
    // 43 chars is base64url of 32 bytes — anything shorter is not a digest.
    throw new OAuthError('invalid_request', 'The code challenge is not a valid S256 digest.');
  }
  return { challenge, method: 'S256' };
}

/** base64url(sha256(verifier)), which is what the challenge should equal. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Checks the verifier against the challenge recorded at authorize time.
 *
 * A code issued WITH a challenge may only be exchanged WITH a verifier. Letting
 * a missing verifier pass would mean an attacker who intercepted the code just
 * omits the field and the protection evaporates — which is the most common way
 * PKCE is implemented wrongly.
 */
export function assertVerifier(code: AuthorizationCode, verifier: string | null): void {
  if (code.codeChallenge === null) {
    if (verifier) {
      throw new OAuthError('invalid_grant', 'This code was not issued with a code challenge.');
    }
    return;
  }

  if (!verifier) {
    throw new OAuthError('invalid_grant', 'This code requires a code verifier.');
  }
  if (verifier.length < 43 || verifier.length > 128) {
    throw new OAuthError('invalid_grant', 'The code verifier is the wrong length.');
  }
  if (challengeFor(verifier) !== code.codeChallenge) {
    throw new OAuthError('invalid_grant', 'The code verifier does not match the challenge.');
  }
}

/**
 * Whether this app may be published asking for what it asks for.
 *
 * A restricted scope is one that reaches personal data, and marking it without
 * enforcing it is decoration. The gate is at PUBLISH rather than at
 * registration, so a partner can build and test against their own development
 * stores before anybody reviews them.
 */
export function assertPublishable(
  app: App,
  isRestricted: (scope: string) => boolean,
  approvedScopes: readonly string[],
): void {
  const approved = new Set(approvedScopes);
  const blocked = app.requestedScopes.filter(
    (scope) => isRestricted(scope) && !approved.has(scope),
  );

  if (blocked.length > 0) {
    throw new AppRuleError(
      'requestedScopes',
      `${blocked.join(', ')} ${blocked.length === 1 ? 'needs' : 'need'} platform approval before this app can be published`,
    );
  }
}

export function assertCodeUsable(code: AuthorizationCode, now: Date): void {
  if (code.usedAt !== null) {
    // Single use. A code that works twice is a code anyone who saw it in a log,
    // a referrer header or a browser history can spend.
    throw new OAuthError('invalid_grant', 'This authorization code has already been used.');
  }
  if (code.expiresAt.getTime() <= now.getTime()) {
    throw new OAuthError('invalid_grant', 'This authorization code has expired.');
  }
}

/**
 * The scopes a token actually gets.
 *
 * The install is the authority, not the exchange request. An app that asks for
 * more at exchange time than the merchant approved gets what the merchant
 * approved — silently narrowing rather than failing, because the app is not
 * doing anything wrong by asking, and the merchant's answer is simply the
 * answer.
 */
export function tokenScopes(
  code: AuthorizationCode,
  installation: AppInstallation,
): readonly string[] {
  const granted = new Set(installation.grantedScopes);
  return code.scopes.filter((scope) => granted.has(scope));
}

export function tokenExpiry(tokenType: TokenType, at: Date): Date | null {
  // Offline tokens do not expire on a clock. They end when the install does,
  // which `tokenIsUsable` enforces — an expiry would only mean an app silently
  // stopping at 3am on a date nobody wrote down.
  return tokenType === 'online' ? new Date(at.getTime() + ONLINE_TOKEN_TTL_SECONDS * 1000) : null;
}

/**
 * Whether a token may be used right now.
 *
 * The installation is re-checked on every request, not just at issue: an
 * uninstall has to stop live tokens immediately, and a token that keeps working
 * until it expires means "uninstall" was a lie for up to a day.
 */
export function tokenIsUsable(
  token: AppToken,
  installation: AppInstallation | null,
  now: Date,
  /**
   * The app itself. Optional so existing callers keep working, checked when
   * given — a suspension has to stop the app in every store at once, and the
   * installation rows know nothing about it.
   */
  app?: Pick<App, 'status' | 'suspendedReason'> | null,
): { ok: true } | { ok: false; reason: string } {
  if (app && app.status === 'suspended') {
    return {
      ok: false,
      reason: app.suspendedReason
        ? `This app has been suspended: ${app.suspendedReason}`
        : 'This app has been suspended.',
    };
  }
  if (token.revokedAt !== null) return { ok: false, reason: 'This token was revoked.' };
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'This token has expired.' };
  }
  if (!installation || installation.status !== 'installed') {
    return { ok: false, reason: 'This app is no longer installed on this store.' };
  }

  // A token cannot outlive the consent it was issued under. If the merchant
  // narrowed the install afterwards, the token narrows with it.
  const granted = new Set(installation.grantedScopes);
  if (!token.scopes.some((scope) => granted.has(scope))) {
    return { ok: false, reason: 'The scopes this token was issued for are no longer granted.' };
  }

  return { ok: true };
}

/** The scopes still live on a token, after any narrowing of the install. */
export function effectiveScopes(
  token: AppToken,
  installation: AppInstallation,
): readonly string[] {
  const granted = new Set(installation.grantedScopes);
  return token.scopes.filter((scope) => granted.has(scope));
}

/**
 * The store permissions an app call carries.
 *
 * This is where the two vocabularies meet. Past this point nothing downstream
 * knows or cares that the caller is an app — it has permissions like anybody
 * else, and every authorisation check is the one check.
 */
export function permissionsForScopes(
  scopes: readonly string[],
  grantsFor: (scope: string) => readonly string[],
): readonly string[] {
  const permissions = new Set<string>();
  for (const scope of scopes) {
    for (const permission of grantsFor(scope)) permissions.add(permission);
  }
  return [...permissions];
}

const INSTALL_TRANSITIONS: Record<InstallationStatus, readonly InstallationStatus[]> = {
  installed: ['uninstalled'],
  // Reinstalling is allowed and is a fresh consent — the merchant is asked
  // again, so an old grant cannot come back with them.
  uninstalled: ['installed'],
};

export function assertInstallTransition(from: InstallationStatus, to: InstallationStatus): void {
  if (from === to) return;
  if (!INSTALL_TRANSITIONS[from].includes(to)) {
    throw new AppRuleError('status', `an installation cannot go from ${from} to ${to}`);
  }
}
