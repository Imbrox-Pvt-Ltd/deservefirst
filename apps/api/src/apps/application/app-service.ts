/**
 * Apps · application/app-service.ts
 * Registering an app, installing it, and turning its token back into a caller.
 *
 * The OAuth half of this is short because the rules live in the domain. What is
 * left here is ordering, and the ordering is the part that has teeth: the code
 * is CLAIMED before a token is minted, the install is re-read on every request
 * rather than trusted from issue time, and an uninstall revokes before it
 * returns.
 * Layer: application.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import {
  App,
  AppRuleError,
  CODE_TTL_SECONDS,
  OAuthError,
  assertAppValid,
  assertChallengeValid,
  assertRedirectUriValid,
  assertInstallTransition,
  assertInstallable,
  assertPublishable,
  assertVerifier,
  effectiveScopes,
  needsReconsent,
  permissionsForScopes,
  redirectIsRegistered,
  scopesToConsent,
  tokenExpiry,
  tokenIsUsable,
  tokenScopes,
  type AppInstallation,
  type AppToken,
  type TokenType,
} from '../domain/app';
import { digestOf, type SqlAppRepository } from '../infrastructure/app.repository';

export interface ScopeCatalogEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly family: string;
  readonly feature: string;
  readonly access: 'read' | 'write';
  readonly grants: readonly string[];
  readonly restricted: boolean;
}

export interface AppServicePorts {
  readonly apps: SqlAppRepository;
  /** Every scope the installed modules declare, keyed for lookup. */
  readonly scopeCatalog: () => readonly ScopeCatalogEntry[];
  readonly publish: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
  /**
   * Restricted scopes the platform has approved for one app.
   *
   * A port rather than a table read, because the approval workflow does not
   * exist yet and this is the seam it will arrive at. Returning nothing today
   * is the safe default: no restricted scope is approved, so no app asking for
   * one can be published.
   */
  readonly approvedScopesFor: (appId: string) => Promise<readonly string[]>;
  /**
   * Makes sure the app's own endpoint is registered on this store.
   *
   * Done at install rather than left to the app to subscribe, because the one
   * event an app cannot afford to miss is its own uninstall — and an app that
   * forgot to subscribe is exactly the app that will keep calling with a dead
   * token until somebody investigates the 401s.
   */
  readonly ensureAppSubscription: (input: {
    appId: string;
    storeId: StoreId;
    url: string;
    secret: string;
    eventTypes: readonly string[];
  }) => Promise<void>;
  readonly now?: () => Date;
}

/** The events an app is told about, whether or not it asked. */
export const APP_LIFECYCLE_EVENTS = ['apps.app.uninstalled', 'apps.scopes.updated'] as const;

/** 256 bits, url-safe. Long enough that guessing is not a strategy. */
function secret(): string {
  return randomBytes(32).toString('base64url');
}

export class AppService {
  constructor(private readonly ports: AppServicePorts) {}

  private now(): Date {
    return this.ports.now?.() ?? new Date();
  }

  private scope(key: string): ScopeCatalogEntry | undefined {
    return this.ports.scopeCatalog().find((entry) => entry.key === key);
  }

  /** The consent screen's content: what each requested scope actually opens. */
  describeScopes(keys: readonly string[]): readonly ScopeCatalogEntry[] {
    return keys
      .map((key) => this.scope(key))
      .filter((entry): entry is ScopeCatalogEntry => entry !== undefined);
  }

  // --- the partner's side ----------------------------------------------------

  async register(input: {
    partnerId: string;
    name: string;
    handle: string;
    appUrl?: string | null;
    redirectUris: readonly string[];
    requestedScopes: readonly string[];
    distribution?: 'public' | 'custom';
    webhookUrl?: string | null;
  }): Promise<{ app: App; clientSecret: string; webhookSecret: string | null }> {
    const known = new Set(this.ports.scopeCatalog().map((entry) => entry.key));
    const unknown = input.requestedScopes.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      // Caught at registration rather than at install, where it would surface
      // to a merchant as an app asking for something nobody can explain.
      throw new AppRuleError('requestedScopes', `unknown scope: ${unknown.join(', ')}`);
    }

    const clientSecret = secret();
    // A separate secret for a separate job. Reusing the client secret to sign
    // webhooks would mean an app cannot rotate one without breaking the other.
    const webhookSecret = input.webhookUrl ? secret() : null;

    const app: App = {
      id: randomUUID(),
      partnerId: input.partnerId,
      name: input.name.trim(),
      handle: input.handle.trim().toLowerCase(),
      status: 'draft',
      distribution: input.distribution ?? 'public',
      appUrl: input.appUrl ?? null,
      redirectUris: [...input.redirectUris],
      requestedScopes: [...input.requestedScopes],
      clientId: randomUUID(),
      clientSecretHash: digestOf(clientSecret),
      webhookUrl: input.webhookUrl ?? null,
      webhookSecret,
      version: 1,
    };
    assertAppValid(app);
    if (app.webhookUrl) assertRedirectUriValid(app.webhookUrl);

    await this.ports.apps.insertApp(app);
    // Both returned exactly once. There is no endpoint that shows either again.
    return { app, clientSecret, webhookSecret };
  }

  async appsForPartner(partnerId: string): Promise<readonly App[]> {
    return this.ports.apps.appsForPartner(partnerId);
  }

  async updateApp(
    appId: string,
    partnerId: string,
    changes: {
      name?: string;
      status?: App['status'];
      appUrl?: string | null;
      webhookUrl?: string | null;
      redirectUris?: readonly string[];
      requestedScopes?: readonly string[];
      version: number;
    },
  ): Promise<App> {
    const current = await this.ports.apps.findApp(appId);
    // Same answer for "not yours" and "does not exist", so a partner cannot
    // enumerate other people's app ids.
    if (!current || current.partnerId !== partnerId) {
      throw new AppRuleError('appId', 'is not an app you own');
    }

    const next: App = {
      ...current,
      name: changes.name?.trim() ?? current.name,
      status: changes.status ?? current.status,
      appUrl: changes.appUrl === undefined ? current.appUrl : changes.appUrl,
      webhookUrl: changes.webhookUrl === undefined ? current.webhookUrl : changes.webhookUrl,
      redirectUris: changes.redirectUris ? [...changes.redirectUris] : current.redirectUris,
      requestedScopes: changes.requestedScopes
        ? [...changes.requestedScopes]
        : current.requestedScopes,
      version: changes.version,
    };
    assertAppValid(next);

    if (next.status === 'published' && current.status !== 'published') {
      // The restricted mark was decoration until this: an app could ask every
      // merchant for their customer contact details with nobody having looked
      // at it. Gated at publish rather than registration, so a partner can
      // build and test against their own development stores first.
      assertPublishable(
        next,
        (scope) => this.scope(scope)?.restricted === true,
        await this.ports.approvedScopesFor(next.id),
      );
    }

    if (!(await this.ports.apps.updateApp(next))) {
      throw new AppRuleError('version', 'this app changed since you loaded it — reload and retry');
    }
    return { ...next, version: next.version + 1 };
  }

  // --- installing ------------------------------------------------------------

  /**
   * What to show the merchant before anything is granted.
   *
   * Returns the app and the scopes it wants, resolved to descriptions. It does
   * NOT create anything: reaching this endpoint is not consent, and an install
   * that happened because somebody opened a link would be an install nobody
   * agreed to.
   */
  async beginAuthorization(input: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    storeId: StoreId;
  }): Promise<{ app: App; scopes: readonly ScopeCatalogEntry[]; alreadyInstalled: boolean }> {
    const app = await this.ports.apps.findAppByClientId(input.clientId);
    if (!app) throw new OAuthError('invalid_client', 'No app is registered with that client id.');

    assertInstallable(app);

    if (!redirectIsRegistered(app, input.redirectUri)) {
      // Never redirected back with this error — sending an error to an
      // unverified URI is the same disclosure as sending a code there.
      throw new OAuthError(
        'invalid_redirect_uri',
        'That redirect URL is not registered for this app.',
      );
    }

    const wanted = scopesToConsent(app, input.scopes);
    const installation = await this.ports.apps.findInstallation(app.id, input.storeId);

    return {
      app,
      scopes: this.describeScopes(wanted),
      alreadyInstalled: installation !== null && !needsReconsent(installation, wanted),
    };
  }

  /**
   * The merchant said yes. Records the grant and issues a code.
   *
   * The install is written here, at consent, and not at token exchange: the
   * merchant's decision is the event worth recording, and an app that never
   * comes back for its token should still show up in the merchant's list as
   * something they approved.
   */
  async grantAuthorization(input: {
    clientId: string;
    redirectUri: string;
    scopes: readonly string[];
    storeId: StoreId;
    userId: string;
    tokenType: TokenType;
    state?: string | null;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
  }): Promise<{ code: string; redirectUri: string; state: string | null }> {
    const app = await this.ports.apps.findAppByClientId(input.clientId);
    if (!app) throw new OAuthError('invalid_client', 'No app is registered with that client id.');

    assertInstallable(app);
    if (!redirectIsRegistered(app, input.redirectUri)) {
      throw new OAuthError('invalid_redirect_uri', 'That redirect URL is not registered for this app.');
    }

    const granted = scopesToConsent(app, input.scopes);
    const at = this.now();

    const existing = await this.ports.apps.findInstallation(app.id, input.storeId);
    if (existing) {
      assertInstallTransition(existing.status, 'installed');
      await this.ports.apps.saveInstallation({
        ...existing,
        status: 'installed',
        grantedScopes: granted,
        installedAt: existing.status === 'installed' ? existing.installedAt : at,
        uninstalledAt: null,
      });
      await this.ports.publish({
        type: existing.status === 'installed' ? 'apps.scopes.updated' : 'apps.app.installed',
        payload: { appId: app.id, storeId: input.storeId, scopes: granted },
      });
    } else {
      await this.ports.apps.insertInstallation({
        id: randomUUID(),
        appId: app.id,
        storeId: input.storeId,
        status: 'installed',
        grantedScopes: granted,
        installedAt: at,
        uninstalledAt: null,
      });
      await this.ports.publish({
        type: 'apps.app.installed',
        payload: { appId: app.id, storeId: input.storeId, scopes: granted },
      });
    }

    if (app.webhookUrl && app.webhookSecret) {
      await this.ports.ensureAppSubscription({
        appId: app.id,
        storeId: input.storeId,
        url: app.webhookUrl,
        secret: app.webhookSecret,
        eventTypes: [...APP_LIFECYCLE_EVENTS],
      });
    }

    const pkce = assertChallengeValid(
      input.codeChallenge ?? null,
      input.codeChallengeMethod ?? null,
    );

    const code = secret();
    await this.ports.apps.insertCode({
      code,
      appId: app.id,
      storeId: input.storeId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: granted,
      tokenType: input.tokenType,
      state: input.state ?? null,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method,
      expiresAt: new Date(at.getTime() + CODE_TTL_SECONDS * 1000),
      usedAt: null,
    });

    // The state goes back exactly as it arrived. Normalising it — trimming,
    // re-encoding — would break the app's own comparison against what it sent.
    return { code, redirectUri: input.redirectUri, state: input.state ?? null };
  }

  /**
   * Exchanges a code for a token.
   *
   * The claim comes BEFORE the token is minted, and it is what makes the code
   * single-use: two exchanges arriving together would both pass a read-then-
   * write check, and exactly one can win the conditional UPDATE.
   */
  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<{ accessToken: string; scopes: readonly string[]; expiresAt: Date | null }> {
    const app = await this.ports.apps.findAppByClientId(input.clientId);
    if (!app) throw new OAuthError('invalid_client', 'No app is registered with that client id.');

    const provided = Buffer.from(digestOf(input.clientSecret));
    const expected = Buffer.from(app.clientSecretHash);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new OAuthError('invalid_client', 'The client secret is wrong.');
    }

    const stored = await this.ports.apps.findCode(input.code);
    if (!stored) throw new OAuthError('invalid_grant', 'That authorization code is not valid.');

    // Bound to the app that got it AND to the URI it was issued for. Without
    // the second check, a code leaked from one app's callback could be spent by
    // another app that happens to know its own secret.
    if (stored.appId !== app.id) {
      throw new OAuthError('invalid_grant', 'That authorization code was issued to another app.');
    }
    if (stored.redirectUri !== input.redirectUri) {
      throw new OAuthError('invalid_grant', 'The redirect URL does not match the one used to authorize.');
    }
    if (stored.expiresAt.getTime() <= this.now().getTime()) {
      throw new OAuthError('invalid_grant', 'This authorization code has expired.');
    }

    // Checked BEFORE the code is claimed. A wrong verifier must leave the code
    // spendable by the real client — burning it would turn a failed attack into
    // a denial of service against the app it was aimed at.
    assertVerifier(stored, input.codeVerifier ?? null);

    if (!(await this.ports.apps.claimCode(stored.code, this.now()))) {
      throw new OAuthError('invalid_grant', 'This authorization code has already been used.');
    }

    const installation = await this.ports.apps.findInstallation(app.id, stored.storeId);
    if (!installation || installation.status !== 'installed') {
      throw new OAuthError('invalid_grant', 'This app is not installed on that store.');
    }

    const at = this.now();
    const accessToken = secret();
    const scopes = tokenScopes(stored, installation);

    await this.ports.apps.insertToken({
      id: randomUUID(),
      appId: app.id,
      storeId: stored.storeId,
      tokenType: stored.tokenType,
      userId: stored.tokenType === 'online' ? stored.userId : null,
      tokenHash: digestOf(accessToken),
      scopes,
      expiresAt: tokenExpiry(stored.tokenType, at),
      revokedAt: null,
    });

    return { accessToken, scopes, expiresAt: tokenExpiry(stored.tokenType, at) };
  }

  // --- the merchant's side ---------------------------------------------------

  async installedOn(storeId: StoreId) {
    return this.ports.apps.installationsForStore(storeId);
  }

  /**
   * Removes an app. Revokes its tokens in the same call.
   *
   * Not left to a background job or to token expiry: "uninstall" has to mean
   * the app stops working now, and anything slower makes it a lie for as long
   * as the gap lasts.
   */
  async uninstall(appId: string, storeId: StoreId): Promise<void> {
    const installation = await this.ports.apps.findInstallation(appId, storeId);
    if (!installation) throw new AppRuleError('appId', 'is not installed on this store');

    assertInstallTransition(installation.status, 'uninstalled');
    const at = this.now();

    await this.ports.apps.saveInstallation({
      ...installation,
      status: 'uninstalled',
      uninstalledAt: at,
    });
    await this.ports.apps.revokeTokensFor(appId, storeId, at);

    /**
     * Emitted AFTER the revoke and after the row is saved.
     *
     * The subscription is deliberately left active: `attempt()` re-reads it and
     * refuses to send to one that is paused, so pausing here would guarantee
     * the uninstall notice is the one delivery that never arrives.
     */
    await this.ports.publish({
      type: 'apps.app.uninstalled',
      payload: { appId, storeId },
    });
  }

  // --- turning a token back into a caller ------------------------------------

  /**
   * Who is calling, for a bearer token.
   *
   * The installation is re-read on every request rather than trusted from issue
   * time, which is what lets an uninstall or a narrowed grant take effect on the
   * next call rather than whenever the token happened to expire.
   */
  async resolveToken(bearer: string): Promise<{
    appId: string;
    storeId: StoreId;
    userId: string | null;
    scopes: readonly string[];
    permissions: readonly string[];
  } | null> {
    const token: AppToken | null = await this.ports.apps.findTokenByHash(digestOf(bearer));
    if (!token) return null;

    const installation: AppInstallation | null = await this.ports.apps.findInstallation(
      token.appId,
      token.storeId,
    );

    const usable = tokenIsUsable(token, installation, this.now());
    if (!usable.ok || !installation) return null;

    const scopes = effectiveScopes(token, installation);
    return {
      appId: token.appId,
      storeId: token.storeId,
      userId: token.userId,
      scopes,
      permissions: permissionsForScopes(scopes, (key) => this.scope(key)?.grants ?? []),
    };
  }
}
