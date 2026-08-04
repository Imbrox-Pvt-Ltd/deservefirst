/**
 * main.ts
 * The HTTP entry point. Fastify, kept deliberately thin (ADR 0003): parse,
 * establish context, authorize, serialize, call a use-case. No business logic
 * lives here, which is what keeps the same services usable from GraphQL, a
 * worker or the CLI (§13.1).
 * Layer: transport.
 */

import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

import {
  apiError,
  bindResources,
  failure,
  GenericReader,
  paginated,
  serializeRow,
  success,
  withRequestContext,
} from './core';
import { AccessDeniedError } from './auth/application';
import type { ErrorCode } from './core/http/response-envelope';
import { ProductInvariantError } from './modules/catalog/domain';
// Aliased: `Request` would collide with the transport's own Request type.
import { RequestInvariantError, subtotal, type Request as QuoteRequest } from './modules/orders/domain';
import { CollectionInvariantError, type Collection, type Condition } from './modules/catalog/domain';
import { CustomerInvariantError, displayName, type Customer, type MarketingConsent } from './modules/customers/domain';
import {
  InventoryInvariantError,
  inTransit,
  type InventoryAdjustment,
  type PurchaseOrder,
  type Transfer,
} from './modules/inventory/domain';
import type { StoredLevel, StoredLocation } from './modules/inventory/application';
import {
  ContentInvariantError,
  entryDisplayName,
  type MetaobjectDefinition,
  type MetaobjectEntry,
  type Page,
} from './modules/content/domain';
import { bootstrap, newRequestId } from './composition-root';
import { generateOpenApi } from './describe';
import { openSessionCookie } from './auth/infrastructure';
import { AuthController, deviceLabelFor } from './auth/api';
import { toProductDto } from './modules/catalog/api/product.controller';
import {
  moneyFromDecimalString,
  parseListQuery,
  toDecimalString,
  type OrganizationId,
  type PartnerId,
  type RequestContext,
  type StoreId,
  type UserId,
} from '@deservefirst/contracts';

/**
 * A bearer token that did not resolve.
 *
 * Its message says what to do rather than which of expired / revoked /
 * uninstalled it was: distinguishing them for an unauthenticated caller tells
 * somebody holding a stolen token exactly how stale it is.
 */
class InvalidTokenError extends Error {
  readonly status = 401;
  /**
   * Says why when there is something true to say.
   *
   * A suspended app's author needs "suspended, and here is the reason", not a
   * list of four things it might be. When the token is simply unknown there is
   * nothing true to say, and the vague message is the honest one — inventing a
   * reason would tell a stranger which tokens exist.
   */
  constructor(reason?: string | null) {
    super(
      reason ??
        'This access token is not valid. It may have expired, been revoked, or the app may have been uninstalled.',
    );
    this.name = 'InvalidTokenError';
  }
}

/** Dated API version (§13.6). */
const API_VERSION = '2026-01';

/** What the reference tells an integrator to call. */
const PUBLIC_API_URL = process.env.PUBLIC_API_URL ?? 'https://api.deservefirst.example';

const SESSION_COOKIE = 'df_session';

/**
 * Signs the session cookie.
 *
 * A generated fallback means a restart invalidates every session, which is the
 * right failure: the alternative is a hardcoded default secret that works, and
 * therefore ships.
 */
const sessionSecret = process.env.SESSION_SECRET ?? randomUUID();

/** Reads one cookie out of the header, without a parser dependency. */
function cookieFrom(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function start(): Promise<void> {
  const platform = await bootstrap();
  const app = Fastify({ logger: false });

  /**
   * A DELETE with no body is normal, and clients routinely send a default
   * `Content-Type: application/json` on every request. Fastify's stock parser
   * rejects that combination with a 400, which reads as "your delete was
   * malformed" when nothing was wrong.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = typeof body === 'string' ? body.trim() : '';
      if (text.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(text));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  /**
   * Establishes the request context (§5.6) from the SESSION, and only from the
   * session.
   *
   * This used to read `x-permissions`, `x-store-id` and `x-user-id` from
   * headers, which meant every caller declared its own authority: anyone with
   * curl could send `x-permissions: platform.modules.manage` and disable a
   * module for every store. Every access check in the platform was correct
   * logic applied to an untrusted input — a lock on a door with no frame.
   *
   * The headers are GONE rather than kept behind a flag. A development bypass
   * for authentication is the one nobody remembers to remove, and the fitness
   * suite now fails the build if one returns.
   *
   * Permissions are looked up per request rather than carried in the cookie.
   * A cookie holding claims would keep a revoked session working until it
   * expired, and "sign out everywhere" has to mean it.
   */
  const contextFor = async (request: {
    headers: Record<string, unknown>;
    id: string;
  }): Promise<RequestContext> => {
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === 'string' && value.length > 0 ? value : null;
    };

    const base = {
      requestId: header('x-request-id') ?? request.id ?? newRequestId(),
      correlationId: header('x-correlation-id') ?? request.id ?? newRequestId(),
      actorType: 'user' as const,
      businessEntityId: null,
      partnerId: null,
      appId: null,
      accessType: 'member' as const,
      supportSessionId: null,
      entitlementsHash: null,
      locale: header('accept-language') ?? 'en-US',
      timeZone: 'UTC',
      shardKey: null,
    };

    const anonymous: RequestContext = {
      ...base,
      userId: null,
      organizationId: null,
      storeId: null,
      roleKeys: [],
      permissions: [],
    };

    /**
     * A bearer token means an app is calling.
     *
     * Checked BEFORE the session cookie, because an app's request may carry
     * both — a browser embedding an app sends its cookies too, and resolving
     * the cookie first would silently run the app's request as the person
     * looking at it, with THEIR permissions rather than the app's scopes.
     *
     * Past this point nothing downstream knows the difference. The app arrives
     * as a caller with permissions, so every authorisation check further in is
     * the same check it always was.
     */
    const bearer = /^Bearer\s+(.+)$/i.exec(header('authorization') ?? '')?.[1]?.trim();
    if (bearer) {
      const caller = await platform.apps.resolveToken(bearer);
      // Not a fall-through to anonymous. A token that does not resolve is
      // expired, revoked, suspended, or for an app that was uninstalled — and
      // every one of those is a thing the app's author needs told plainly.
      // Falling through reported "no store selected", which sends them to debug
      // the wrong end entirely.
      if (!caller.ok) throw new InvalidTokenError(caller.reason);

      return {
        ...base,
        actorType: 'app',
        appId: caller.appId,
        // The store comes from the TOKEN, never from a header. A token issued
        // for one store cannot be pointed at another by changing a request.
        storeId: caller.storeId,
        userId: caller.userId as UserId | null,
        organizationId: null,
        roleKeys: [],
        permissions: [...caller.permissions],
      };
    }

    const sessionId = openSessionCookie(sessionSecret, cookieFrom(header('cookie')));
    if (!sessionId) return anonymous;

    const identity = await platform.resolveSession(sessionId);
    if (!identity) return anonymous;

    return {
      ...base,
      userId: identity.userId,
      organizationId: identity.organizationId as OrganizationId | null,
      storeId: identity.storeId,
      roleKeys: [...identity.roleKeys],
      permissions: [...identity.permissions],
      // Carried from the session rather than assumed: `base` defaults to
      // `member`, and an operator that silently stayed a member would be
      // refused by its own guard.
      accessType: identity.accessType,
    };
  };

  app.addHook('onSend', async (_request, reply) => {
    // Correlation ids propagate end to end so a log line can be traced to a
    // request and an event (§14.7).
    reply.header('x-api-version', API_VERSION);
  });

  // --- authentication --------------------------------------------------------
  // The only endpoints that run without a session, which is why they are here
  // rather than in a module controller — that contract guarantees an authorised
  // store scope, and here there is not one yet.

  const auth = new AuthController(platform.auth);

  const setSessionCookie = (reply: FastifyReply, sealed: string, expiresAt: Date) => {
    reply.header(
      'set-cookie',
      [
        `${SESSION_COOKIE}=${encodeURIComponent(sealed)}`,
        'Path=/',
        // httpOnly: script must never be able to read it, so an XSS bug is not
        // automatically a session theft.
        'HttpOnly',
        'SameSite=Lax',
        ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
        `Expires=${expiresAt.toUTCString()}`,
      ].join('; '),
    );
  };

  app.post(`/${API_VERSION}/auth/login`, async (request, reply) => {
    const context = await contextFor(request as never);
    const outcome = await auth.login({
      body: (request.body ?? {}) as Record<string, unknown>,
      cookie: null,
      ip: request.ip ?? null,
      userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
    });

    if (outcome.session) {
      setSessionCookie(
        reply,
        platform.sealSession(outcome.session.id),
        outcome.session.expiresAt,
      );
    }

    return success(
      {
        step: outcome.step,
        rid: outcome.rid,
        returnPath: outcome.returnPath ?? null,
        // The session id is never returned in the body — it lives in an
        // httpOnly cookie precisely so no script can read it.
        signedIn: Boolean(outcome.session),
        // Sent when a store still has to be chosen, so the client does not have
        // to make a second call to find out what the options are.
        stores:
          outcome.session && !outcome.session.storeId
            ? await platform.storesFor(outcome.session.userId)
            : undefined,
      },
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/auth/logout`, async (request, reply) => {
    const context = await contextFor(request as never);
    const sessionId = openSessionCookie(sessionSecret, cookieFrom(
      (request.headers.cookie as string | undefined) ?? null,
    ));

    if (sessionId) await auth.signOut(sessionId);
    setSessionCookie(reply, '', new Date(0));
    return success({ signedOut: true }, { requestId: context.requestId });
  });

  /** Who am I, and which stores may I open. */
  app.get(`/${API_VERSION}/auth/session`, async (request) => {
    const context = await contextFor(request as never);
    if (context.userId === null) {
      return success(null, { requestId: context.requestId });
    }

    return success(
      {
        userId: context.userId,
        storeId: context.storeId,
        organizationId: context.organizationId,
        permissions: context.permissions,
        roleKeys: context.roleKeys,
        stores: await platform.storesFor(context.userId),
      },
      { requestId: context.requestId },
    );
  });

  /**
   * Switching store rescopes the SESSION rather than issuing a new one — the
   * person has not changed, only which of their stores they are looking at.
   */
  app.post(`/${API_VERSION}/auth/switch-store`, async (request, reply) => {
    const context = await contextFor(request as never);
    const sessionId = openSessionCookie(sessionSecret, cookieFrom(
      (request.headers.cookie as string | undefined) ?? null,
    ));

    if (!sessionId || context.userId === null) {
      return reply.status(401).send(
        failure([apiError('unauthenticated', 'Not signed in', 'Sign in first.')], {
          requestId: context.requestId,
        }),
      );
    }

    const body = request.body as Record<string, unknown>;
    await auth.switchStore(sessionId, String(body.storeId ?? '') as StoreId);
    return success({ storeId: body.storeId }, { requestId: context.requestId });
  });

  // --- the partner surface --------------------------------------------------
  //
  // These belong to no store, so they cannot go through the store-scoped
  // controller loop: a partner listing its clients is precisely a question that
  // spans stores, and answering it inside one store's context would be
  // answering the wrong question. Authorisation here is the partner seat, which
  // the service checks against the acting user on every call.

  /** A signed-in person's partner accounts, for the dashboard's picker. */
  /**
   * A signed-in PERSON, acting as themselves.
   *
   * The actor check is not redundant with the user check, and assuming it was
   * is a real hole this had: an ONLINE app token carries the user id of whoever
   * authorised it, so `userId !== null` was true for an app, and an app holding
   * nothing but `read_products` could list that person's partner accounts and
   * create new ones as them.
   *
   * Scope mapping happened to block the worst of it — no scope grants
   * `store.apps.manage`, so an app could not consent on its own behalf — but
   * that is luck rather than design, and it would evaporate the first time
   * somebody wrote a scope that granted it. These routes are the human surface:
   * the partner dashboard, the app registry, the consent decision. An app is
   * never the person, however it got its token.
   */
  const requireUser = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<RequestContext | null> => {
    const context = await contextFor(request as never);

    if (context.actorType === 'app') {
      reply.status(403).send(
        failure(
          [
            apiError(
              'forbidden',
              'Not available to apps',
              'This endpoint acts on behalf of a person. An app token cannot use it, ' +
                'whichever person authorised the app.',
            ),
          ],
          { requestId: context.requestId },
        ),
      );
      return null;
    }

    if (context.userId === null) {
      reply.status(401).send(
        failure([apiError('unauthenticated', 'Not signed in', 'Sign in first.')], {
          requestId: context.requestId,
        }),
      );
      return null;
    }
    return context;
  };

  app.get(`/${API_VERSION}/partners`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const entries = await platform.partners.partnersFor(context.userId as UserId);
    return success(
      entries.map(({ partner, member }) => ({
        id: partner.id,
        name: partner.name,
        status: partner.status,
        role: member.role,
      })),
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/partners`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const body = request.body as Record<string, unknown>;
    const partner = await platform.partners.create({
      ownerUserId: context.userId as UserId,
      name: String(body.name ?? ''),
      payoutCurrency: typeof body.payoutCurrency === 'string' ? body.payoutCurrency : null,
      websiteUrl: typeof body.websiteUrl === 'string' ? body.websiteUrl : null,
    });

    return reply.status(201).send(
      success(
        { id: partner.id, name: partner.name, status: partner.status, version: partner.version },
        { requestId: context.requestId },
      ),
    );
  });

  app.get(`/${API_VERSION}/partners/:partnerId`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const partner = await platform.partners.get(partnerId as PartnerId, context.userId as UserId);
    return success(
      {
        id: partner.id,
        name: partner.name,
        status: partner.status,
        payoutCurrency: partner.payoutCurrency,
        websiteUrl: partner.websiteUrl,
        version: partner.version,
      },
      { requestId: context.requestId },
    );
  });

  app.patch(`/${API_VERSION}/partners/:partnerId`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const body = request.body as Record<string, unknown>;
    const partner = await platform.partners.update(
      partnerId as PartnerId,
      context.userId as UserId,
      {
        name: typeof body.name === 'string' ? body.name : undefined,
        payoutCurrency:
          body.payoutCurrency === undefined ? undefined : (body.payoutCurrency as string | null),
        websiteUrl: body.websiteUrl === undefined ? undefined : (body.websiteUrl as string | null),
        version: Number(body.version ?? 0),
      },
    );
    return success({ id: partner.id, version: partner.version }, { requestId: context.requestId });
  });

  app.get(`/${API_VERSION}/partners/:partnerId/staff`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const staff = await platform.partners.staff(partnerId as PartnerId, context.userId as UserId);
    return success(staff, { requestId: context.requestId });
  });

  app.post(`/${API_VERSION}/partners/:partnerId/staff`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const body = request.body as Record<string, unknown>;
    const member = await platform.partners.inviteStaff(
      partnerId as PartnerId,
      context.userId as UserId,
      { userId: String(body.userId ?? '') as UserId, role: body.role as 'admin' | 'member' },
    );
    return reply.status(201).send(success(member, { requestId: context.requestId }));
  });

  app.delete(`/${API_VERSION}/partners/:partnerId/staff/:staffId`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId, staffId } = request.params as { partnerId: string; staffId: string };
    await platform.partners.removeStaff(partnerId as PartnerId, context.userId as UserId, staffId);
    return success({ id: staffId, removed: true }, { requestId: context.requestId });
  });

  app.get(`/${API_VERSION}/partners/:partnerId/stores`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const links = await platform.partners.stores(partnerId as PartnerId, context.userId as UserId);
    return success(
      links.map(({ link, storeName, storeHandle }) => ({
        id: link.id,
        storeId: link.storeId,
        storeName,
        storeHandle,
        status: link.status,
        accessLevel: link.accessLevel,
        permissions: link.permissions,
        createdByPartner: link.createdByPartner,
        requestedAt: link.requestedAt.toISOString(),
        decidedAt: link.decidedAt?.toISOString() ?? null,
        revokedReason: link.revokedReason,
      })),
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/partners/:partnerId/stores`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    const body = request.body as Record<string, unknown>;
    const link = await platform.partners.requestStoreAccess(
      partnerId as PartnerId,
      context.userId as UserId,
      {
        storeId: String(body.storeId ?? '') as StoreId,
        accessLevel: (body.accessLevel as 'full' | 'limited') ?? 'limited',
        permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : [],
      },
    );
    return reply.status(201).send(
      success({ id: link.id, status: link.status }, { requestId: context.requestId }),
    );
  });

  app.post(`/${API_VERSION}/partners/:partnerId/stores/:storeId/transfer`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId, storeId } = request.params as { partnerId: string; storeId: string };
    const link = await platform.partners.transferStore(
      partnerId as PartnerId,
      context.userId as UserId,
      storeId as StoreId,
    );
    return success({ id: link.id, status: link.status }, { requestId: context.requestId });
  });

  // --- OAuth, and the partner's app registry ---------------------------------
  //
  // The token endpoint is the only route on the platform that is authenticated
  // by a client secret rather than a session, because the caller is a server
  // somewhere else with no browser and no cookie. It is deliberately the ONLY
  // one: every other app request arrives as a bearer token, which `contextFor`
  // turns back into an ordinary caller with permissions.

  app.get(`/${API_VERSION}/oauth/authorize`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;
    if (context.storeId === null) {
      return reply.status(400).send(
        failure(
          [apiError('validation_failed', 'No store selected', 'Choose a store before installing an app.')],
          { requestId: context.requestId },
        ),
      );
    }

    const query = new URL(request.url, 'http://internal').searchParams;
    const preview = await platform.apps.beginAuthorization({
      clientId: query.get('client_id') ?? '',
      redirectUri: query.get('redirect_uri') ?? '',
      scopes: (query.get('scope') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      storeId: context.storeId,
    });

    // Describes the consent, and grants nothing. Opening a link is not consent.
    return success(
      {
        app: {
          id: preview.app.id,
          name: preview.app.name,
          handle: preview.app.handle,
          appUrl: preview.app.appUrl,
        },
        scopes: preview.scopes,
        alreadyInstalled: preview.alreadyInstalled,
        // Echoed straight back so the consent screen can hand them to the POST
        // without having to parse the query string a second time.
        redirectUri: query.get('redirect_uri') ?? '',
        state: query.get('state'),
        codeChallenge: query.get('code_challenge'),
        codeChallengeMethod: query.get('code_challenge_method'),
      },
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/oauth/authorize`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;
    if (context.storeId === null) {
      return reply.status(400).send(
        failure(
          [apiError('validation_failed', 'No store selected', 'Choose a store before installing an app.')],
          { requestId: context.requestId },
        ),
      );
    }

    // The merchant's own permission. Installing software that can read the
    // customer list is not something every staff account should be able to do.
    await platform.access.assert({
      context,
      permission: 'store.apps.manage',
      moduleId: 'apps',
    });

    const body = request.body as Record<string, unknown>;

    /**
     * Runs INSIDE the request context, unlike the read above.
     *
     * Granting consent writes store-scoped rows — the installation, and the
     * app's own webhook endpoint — and every one of those asks the ambient
     * context which store it is in. Resolving the context without entering it
     * left them with none, and the install failed with a tenant-guard error
     * that named neither the route nor the reason.
     */
    const granted = await withRequestContext(context, () =>
      platform.apps.grantAuthorization({
        clientId: String(body.clientId ?? ''),
        redirectUri: String(body.redirectUri ?? ''),
        scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : [],
        storeId: context.storeId as StoreId,
        userId: context.userId as string,
        tokenType: body.tokenType === 'online' ? 'online' : 'offline',
        state: typeof body.state === 'string' ? body.state : null,
        codeChallenge: typeof body.codeChallenge === 'string' ? body.codeChallenge : null,
        codeChallengeMethod:
          typeof body.codeChallengeMethod === 'string' ? body.codeChallengeMethod : null,
      }),
    );

    return success(granted, { requestId: context.requestId });
  });

  /**
   * The token exchange. No session — the caller is the app's own server.
   *
   * Errors here are returned, never redirected: sending an error to a URI we
   * have not verified is the same disclosure as sending a code there.
   */
  app.post(`/${API_VERSION}/oauth/token`, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    /**
     * Limited per client id, and per source address when there is none.
     *
     * The token endpoint is the one place a client SECRET is presented, so it
     * is the one place guessing one is possible. Unlimited, an attacker with a
     * client id has an offline problem made online. Keyed on the client id so
     * one noisy integrator cannot lock out everybody else's exchanges.
     */
    const limitKey = String(body.client_id ?? body.clientId ?? request.ip ?? 'unknown');
    await platform.rateLimiter.enforce(`oauth:token:${limitKey}`, {
      refillPerSecond: 1,
      capacity: 10,
    });

    const issued = await platform.apps.exchangeCode({
      clientId: String(body.client_id ?? body.clientId ?? ''),
      clientSecret: String(body.client_secret ?? body.clientSecret ?? ''),
      code: String(body.code ?? ''),
      redirectUri: String(body.redirect_uri ?? body.redirectUri ?? ''),
      codeVerifier:
        typeof (body.code_verifier ?? body.codeVerifier) === 'string'
          ? String(body.code_verifier ?? body.codeVerifier)
          : null,
    });

    return reply.send({
      access_token: issued.accessToken,
      token_type: 'Bearer',
      scope: issued.scopes.join(','),
      expires_at: issued.expiresAt?.toISOString() ?? null,
    });
  });

  /** Every scope any installed module exposes, for the app registration form. */
  app.get(`/${API_VERSION}/oauth/scopes`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;
    return success(platform.scopeCatalog(), { requestId: context.requestId });
  });

  app.get(`/${API_VERSION}/partners/:partnerId/apps`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    // Proves the caller works at this partner before anything is returned.
    await platform.partners.get(partnerId as PartnerId, context.userId as UserId);

    const registered = await platform.apps.appsForPartner(partnerId);
    return success(
      registered.map((entry) => ({
        id: entry.id,
        name: entry.name,
        handle: entry.handle,
        status: entry.status,
        distribution: entry.distribution,
        appUrl: entry.appUrl,
        webhookUrl: entry.webhookUrl,
        redirectUris: entry.redirectUris,
        requestedScopes: entry.requestedScopes,
        clientId: entry.clientId,
        // The secret is not here, and there is no endpoint that returns it.
        version: entry.version,
      })),
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/partners/:partnerId/apps`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId } = request.params as { partnerId: string };
    await platform.partners.get(partnerId as PartnerId, context.userId as UserId);

    const body = request.body as Record<string, unknown>;
    const { app: registered, clientSecret, webhookSecret } = await platform.apps.register({
      partnerId,
      name: String(body.name ?? ''),
      handle: String(body.handle ?? ''),
      appUrl: typeof body.appUrl === 'string' ? body.appUrl : null,
      redirectUris: Array.isArray(body.redirectUris) ? (body.redirectUris as string[]) : [],
      requestedScopes: Array.isArray(body.requestedScopes) ? (body.requestedScopes as string[]) : [],
      distribution: body.distribution === 'custom' ? 'custom' : 'public',
      webhookUrl: typeof body.webhookUrl === 'string' && body.webhookUrl ? body.webhookUrl : null,
    });

    return reply.status(201).send(
      success(
        {
          id: registered.id,
          name: registered.name,
          handle: registered.handle,
          clientId: registered.clientId,
          // Both shown once, here, and never again.
          clientSecret,
          webhookSecret,
          version: registered.version,
        },
        { requestId: context.requestId },
      ),
    );
  });

  app.patch(`/${API_VERSION}/partners/:partnerId/apps/:appId`, async (request, reply) => {
    const context = await requireUser(request, reply);
    if (!context) return reply;

    const { partnerId, appId } = request.params as { partnerId: string; appId: string };
    await platform.partners.get(partnerId as PartnerId, context.userId as UserId);

    const body = request.body as Record<string, unknown>;
    const updated = await platform.apps.updateApp(appId, partnerId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      status: body.status as 'draft' | 'published' | 'suspended' | undefined,
      appUrl: body.appUrl === undefined ? undefined : (body.appUrl as string | null),
      redirectUris: Array.isArray(body.redirectUris) ? (body.redirectUris as string[]) : undefined,
      requestedScopes: Array.isArray(body.requestedScopes)
        ? (body.requestedScopes as string[])
        : undefined,
      version: Number(body.version ?? 0),
    });

    return success({ id: updated.id, version: updated.version }, { requestId: context.requestId });
  });

  // --- platform reflection (§36.1) -----------------------------------------

  app.get('/health', async () => ({ status: 'ok', version: API_VERSION }));

  app.get(`/${API_VERSION}/platform/modules`, async (request) => {
    const meta = { requestId: (await contextFor(request as never)).requestId };
    return success(
      platform.registry.all().map((entry) => ({
        id: entry.manifest.id,
        version: entry.manifest.version,
        label: entry.manifest.label,
        enabled: entry.enabled,
        degradedReason: entry.degradedReason,
        capabilities: entry.manifest.capabilities,
      })),
      meta,
    );
  });

  /** The queryable route registry (§24.2) — every route, and who owns it. */
  app.get(`/${API_VERSION}/platform/routes`, async (request) =>
    success(platform.routes, { requestId: (await contextFor(request as never)).requestId }),
  );

  app.get(`/${API_VERSION}/platform/navigation`, async (request) =>
    success(
      platform.registry.navigation().map((entry) => ({ moduleId: entry.moduleId, ...entry.item })),
      { requestId: (await contextFor(request as never)).requestId },
    ),
  );

  /**
   * The API reference, built from the same declarations the routes come from.
   * Served as well as committed: an integrator asks the deployment they are
   * actually calling, not a file in a repository they cannot see.
   */
  app.get(`/${API_VERSION}/platform/openapi.json`, async (request) => {
    void request;
    return generateOpenApi(API_VERSION, PUBLIC_API_URL);
  });

  app.get(`/${API_VERSION}/platform/settings`, async (request) =>
    success(
      platform.registry.settings().map((entry) => ({ moduleId: entry.moduleId, ...entry.item })),
      { requestId: (await contextFor(request as never)).requestId },
    ),
  );

  // --- platform administration ----------------------------------------------
  // The first control: a platform admin turns a module off for every store at
  // once, and no store can put it back. Deliberately NOT store-scoped — these
  // routes have no X-Store-Id and are guarded by a platform permission.

  /**
   * A platform OPERATOR, acting on every store at once.
   *
   * Three checks, and the first two are the ones that were missing. Holding the
   * permission was treated as sufficient, which meant two separate ways in:
   *
   *   - a merchant, because `platform.*` was declared in the `organization`
   *     category and the seed granted every declared permission to the store
   *     owner, so one merchant could disable a module for every store
   *   - an app, because nothing checked the actor — the same hole `requireUser`
   *     had, and no scope grants a platform permission today only by luck
   *
   * Both are closed at their source as well as here. This is the backstop, and
   * a backstop that only re-checks what the source already guarantees is not
   * one.
   */
  /**
   * An app's request budget, per app AND per store.
   *
   * Per store as well as per app because an app installed on a thousand stores
   * would otherwise share one allowance and the busiest merchant would starve
   * the rest. A person's requests are not limited here: a merchant clicking
   * around their own admin is self-limiting, and a runaway integration is what
   * this exists for.
   *
   * A function rather than two copies because there are two ways into the data
   * — module controllers and the generic read surface — and I put this on the
   * controller loop alone first. Eighty concurrent calls sailed through, because
   * every list endpoint a merchant's data actually lives behind is on the other
   * one. A limit that covers half the API is not a limit.
   */
  const enforceAppBudget = async (context: RequestContext, moduleId: string) => {
    if (context.actorType !== 'app') return;
    await platform.rateLimiter.enforce(
      `app:${context.appId}:${moduleId}:${context.storeId}`,
      { refillPerSecond: 4, capacity: 40 },
    );
  };

  const platformGuard = async (
    request: { headers: Record<string, unknown>; id: string },
    reply: { status(code: number): { send(body: unknown): unknown } },
    permission: string,
  ) => {
    const context = await contextFor(request);

    if (context.actorType === 'app') {
      reply.status(403).send(
        failure(
          [
            apiError(
              'forbidden',
              'Not available to apps',
              'Platform administration acts on every store. No app token can reach it.',
            ),
          ],
          { requestId: context.requestId },
        ),
      );
      return null;
    }

    if (context.accessType !== 'platform') {
      // Deliberately the same answer as a missing permission: telling a merchant
      // that the endpoint exists and they are the wrong KIND of caller is more
      // than they need, and maps the operator surface for anyone probing it.
      reply.status(403).send(
        failure([apiError('forbidden', 'Access denied', `This action needs "${permission}".`)], {
          requestId: context.requestId,
        }),
      );
      return null;
    }

    if (!context.permissions.includes(permission)) {
      reply.status(403).send(
        failure([apiError('forbidden', 'Access denied', `This action needs "${permission}".`)], {
          requestId: context.requestId,
        }),
      );
      return null;
    }
    return context;
  };

  /**
   * The review queue: apps asking for a restricted scope nobody has answered on.
   *
   * Behind `platformGuard`, so a merchant and an app are both refused whatever
   * they hold. Reviewing an app is a decision about every store at once.
   */
  app.get(`/${API_VERSION}/platform/app-reviews`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.apps.review');
    if (!context) return reply;

    const queue = await platform.appReview.queue();
    return success(
      queue.map((item) => ({
        appId: item.app.id,
        name: item.app.name,
        handle: item.app.handle,
        status: item.app.status,
        partnerId: item.app.partnerId,
        requested: item.requested.map((scope) => ({
          key: scope.key,
          label: scope.label,
          description: scope.description,
          restricted: scope.restricted,
        })),
        decisions: item.decisions,
      })),
      { requestId: context.requestId },
    );
  });

  app.post(`/${API_VERSION}/platform/app-reviews/:appId`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.apps.review');
    if (!context) return reply;

    const { appId } = request.params as { appId: string };
    const body = request.body as Record<string, unknown>;

    await platform.appReview.decide({
      appId,
      scope: String(body.scope ?? ''),
      approve: body.approve === true,
      operatorId: context.userId as string,
      reason: typeof body.reason === 'string' ? body.reason : null,
    });

    return success({ appId, scope: body.scope, approved: body.approve === true }, {
      requestId: context.requestId,
    });
  });

  app.post(`/${API_VERSION}/platform/apps/:appId/suspension`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.apps.suspend');
    if (!context) return reply;

    const { appId } = request.params as { appId: string };
    const body = request.body as Record<string, unknown>;
    const app = await platform.appSuspension.setSuspended({
      appId,
      suspend: body.suspend === true,
      reason: typeof body.reason === 'string' ? body.reason : null,
    });

    return success(
      { id: app.id, status: app.status, suspendedReason: app.suspendedReason },
      { requestId: context.requestId },
    );
  });

  app.get(`/${API_VERSION}/platform/module-states`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.modules.manage');
    if (!context) return reply;
    return success(await platform.moduleState.platformOverview(), { requestId: context.requestId });
  });

  app.put(`/${API_VERSION}/platform/module-states/:moduleId`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.modules.manage');
    if (!context) return reply;

    const { moduleId } = request.params as { moduleId: string };
    const body = request.body as Record<string, unknown>;
    await platform.moduleState.setPlatformState(
      moduleId,
      body.enabled === true,
      body.reason === undefined ? undefined : String(body.reason),
    );
    return success(await platform.moduleState.platformOverview(), { requestId: context.requestId });
  });

  app.put(`/${API_VERSION}/platform/settings/:key`, async (request, reply) => {
    const context = await platformGuard(request as never, reply as never, 'platform.settings.manage');
    if (!context) return reply;

    const { key } = request.params as { key: string };
    const body = request.body as Record<string, unknown>;
    await platform.settings.setForPlatform(key, body.value);
    return success(await platform.settings.get(key, null), { requestId: context.requestId });
  });

  /**
   * The guard for CORE's own store-scoped routes.
   *
   * Module endpoints do not use this — they declare a permission and the
   * registration loop applies it, with the module id taken from the controller.
   * These few are Core's, so the module is Core's, stated rather than derived.
   */
  const withStore = async <T>(
    request: { headers: Record<string, unknown>; id: string },
    reply: { status(code: number): { send(body: unknown): unknown } },
    permission: string,
    handler: (storeId: StoreId, context: RequestContext) => Promise<T>,
  ) => {
    const context = await contextFor(request);
    if (context.storeId === null) {
      return reply.status(400).send(
        failure([apiError('validation_failed', 'Missing store', 'Set the X-Store-Id header.')], {
          requestId: context.requestId,
        }),
      );
    }

    await platform.access.assert({ context, permission, moduleId: 'platform' });
    return withRequestContext(context, () => handler(context.storeId as StoreId, context));
  };

  // --- store-level module state and settings ---------------------------------

  app.get(`/${API_VERSION}/platform/store-modules`, async (request, reply) =>
    withStore(request as never, reply as never, 'store.settings.read', async (storeId, context) => {
      const states = await Promise.all(
        platform.registry.all().map(async (entry) => ({
          moduleId: entry.manifest.id,
          label: entry.manifest.label,
          ...(await platform.moduleState.availability(storeId, entry.manifest.id)),
        })),
      );
      return success(states, { requestId: context.requestId });
    }),
  );

  app.put(`/${API_VERSION}/platform/store-modules/:moduleId`, async (request, reply) =>
    withStore(request as never, reply as never, 'store.settings.manage', async (storeId, context) => {
      const { moduleId } = request.params as { moduleId: string };
      const body = request.body as Record<string, unknown>;
      await platform.moduleState.setStoreState(storeId, moduleId, body.enabled === true);
      return success(await platform.moduleState.availability(storeId, moduleId), {
        requestId: context.requestId,
      });
    }),
  );

  app.get(`/${API_VERSION}/platform/effective-settings`, async (request, reply) =>
    withStore(request as never, reply as never, 'store.settings.read', async (storeId, context) =>
      // Each value carries the level that supplied it. A settings screen that
      // hides that is how somebody "changes" a value that was never theirs.
      success(await platform.settings.all(storeId), { requestId: context.requestId }),
    ),
  );

  app.put(`/${API_VERSION}/platform/effective-settings/:key`, async (request, reply) =>
    withStore(request as never, reply as never, 'store.settings.manage', async (storeId, context) => {
      const { key } = request.params as { key: string };
      const body = request.body as Record<string, unknown>;

      // An explicit null clears the store's choice so it inherits again, which
      // is a different act from setting it to nothing.
      if (body.value === null && body.clear === true) {
        await platform.settings.clearForStore(storeId, key);
      } else {
        await platform.settings.setForStore(storeId, key, body.value);
      }
      return success(await platform.settings.get(key, storeId), { requestId: context.requestId });
    }),
  );

  app.get(`/${API_VERSION}/platform/dashboard/:slot`, async (request, reply) =>
    withStore(request as never, reply as never, 'store.read', async (storeId, context) => {
      const { slot } = request.params as { slot: string };
      const widgets = await platform.dashboard.compose(
        slot,
        storeId,
        new Set(context.permissions),
      );
      return success(widgets, { requestId: context.requestId });
    }),
  );

  // --- outbound webhooks -----------------------------------------------------
  // Registered by the store, delivered by the platform (§31.9).

  // --- generic read surface -------------------------------------------------
  // Every REST-exposed resource gets list and get from its declaration alone.
  // Writes stay module-owned: a generic writer would be a way around the domain.

  const bindings = bindResources(platform.registry);
  const reader = new GenericReader(platform.executor, platform.dialect);

  for (const [key, binding] of bindings) {
    const moduleId = key.split(':')[0]!;
    const base = `/${API_VERSION}/${moduleId}/${binding.resource.urlSegment}`;

    const guardStore = async (request: never, reply: { status(code: number): { send(body: unknown): unknown } }) => {
      const context = await contextFor(request);
      if (context.storeId === null) {
        reply
          .status(400)
          .send(
            failure(
              [
                apiError(
                  'validation_failed',
                  'No store selected',
                  'This session is not scoped to a store. Choose one first.',
                ),
              ],
              { requestId: context.requestId },
            ),
          );
        return null;
      }
      return context;
    };

    app.get(base, async (request, reply) => {
      const context = await guardStore(request as never, reply as never);
      if (!context) return reply;

      await enforceAppBudget(context, binding.moduleId);
      await platform.access.assert({
        context,
        permission: binding.resource.permissions.read,
        moduleId: binding.moduleId,
      });

      return withRequestContext(context, async () => {
        const url = new URL(request.url, 'http://internal');
        const connection = await reader.list(binding, parseListQuery(url.searchParams));
        return paginated(
          { ...connection, nodes: connection.nodes.map((row) => serializeRow(binding.resource, row)) },
          { requestId: context.requestId },
        );
      });
    });

    app.get(`${base}/:id`, async (request, reply) => {
      const context = await guardStore(request as never, reply as never);
      if (!context) return reply;
      const { id } = request.params as { id: string };

      await enforceAppBudget(context, binding.moduleId);
      await platform.access.assert({
        context,
        permission: binding.resource.permissions.read,
        moduleId: binding.moduleId,
      });

      return withRequestContext(context, async () => {
        const row = await reader.get(binding, id);
        if (!row) {
          return reply
            .status(404)
            .send(failure([apiError('not_found', 'Not found', `No ${binding.resource.name} "${id}" in this store.`)], { requestId: context.requestId }));
        }
        return success(serializeRow(binding.resource, row), { requestId: context.requestId });
      });
    });
  }

  // --- module endpoints -----------------------------------------------------
  // Every hand-written endpoint used to live in this file, each repeating the
  // same five-line preamble: resolve context, require a store, assert the
  // permission, enter the tenant scope, wrap the result. Five lines that are
  // easy to write and easy to write wrong — and one of them WAS wrong, deriving
  // the entitlement check's module from the permission prefix, so every route
  // on the platform asked whether `catalog` was enabled.
  //
  // Modules now return route DEFINITIONS and this loop is the only place that
  // knows about HTTP. The module id comes from the controller that owns the
  // route, so it cannot be guessed at.

  for (const moduleController of platform.controllers) {
    for (const route of moduleController.routes) {
      const url = `/${API_VERSION}/${moduleController.moduleId}${route.path}`;

      const handler = async (request: FastifyRequest, reply: FastifyReply) => {
        const context = await contextFor(request as never);

        if (context.storeId === null) {
          return reply.status(400).send(
            failure(
              [
              apiError(
                'validation_failed',
                'No store selected',
                'This session is not scoped to a store. Choose one first.',
              ),
            ],
              { requestId: context.requestId },
            ),
          );
        }

        await enforceAppBudget(context, moduleController.moduleId);

        // Authorisation before anything else runs, and the module is the one
        // that owns the route — so the platform kill switch, the store toggle
        // and the plan are all checked against the right module.
        await platform.access.assert({
          context,
          permission: route.permission,
          moduleId: moduleController.moduleId,
        });

        return withRequestContext(context, async () => {
          const payload = await route.handle({
            params: (request.params ?? {}) as Record<string, string>,
            body: (request.body ?? {}) as Record<string, unknown>,
            query: new URL(request.url, 'http://internal').searchParams,
            context,
            storeId: context.storeId as StoreId,
          });

          const body = success(payload, { requestId: context.requestId });
          return route.status && route.status !== 200
            ? reply.status(route.status).send(body)
            : body;
        });
      };

      switch (route.method) {
        case 'GET':
          app.get(url, handler);
          break;
        case 'POST':
          app.post(url, handler);
          break;
        case 'PATCH':
          app.patch(url, handler);
          break;
        case 'PUT':
          app.put(url, handler);
          break;
        case 'DELETE':
          app.delete(url, handler);
          break;
      }
    }
  }

  // --- error shape ----------------------------------------------------------

  app.setErrorHandler((error: unknown, request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) ?? request.id;
    const status = (error as { status?: number }).status ?? 500;
    const name = (error as { name?: string }).name ?? 'Error';
    const message = (error as { message?: string }).message ?? 'Unknown error';

    /**
     * Rate limiting, with the one header that makes it actionable.
     *
     * This fell through to the generic mapper, which returned the right STATUS
     * with the wrong code — and a client library branches on the code. Without
     * `Retry-After` a throttled caller retries immediately, which is how a
     * limit designed to shed load becomes a source of it.
     */
    if (name === 'RateLimitedError') {
      const retryAfter = (error as { decision?: { retryAfterSeconds?: number } }).decision
        ?.retryAfterSeconds;
      if (typeof retryAfter === 'number') reply.header('retry-after', String(Math.ceil(retryAfter)));
      return reply
        .status(429)
        .send(failure([apiError('rate_limited', 'Too many requests', message)], { requestId }));
    }

    if (name === 'InvalidTokenError') {
      return reply
        .status(401)
        .send(failure([apiError('invalid_token', 'Invalid access token', message)], { requestId }));
    }

    // OAuth errors carry their own code, which is what an integrator's client
    // library switches on. Flattening them to "validation_failed" would make
    // every failure in the flow look the same from the outside.
    if (name === 'OAuthError') {
      return reply
        .status((error as { status?: number }).status ?? 400)
        .send(
          failure(
            [apiError((error as { code: ErrorCode }).code, 'Authorization failed', message)],
            { requestId },
          ),
        );
    }

    if (name === 'AppRuleError') {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Refused', message, (error as { field?: string }).field)], { requestId }));
    }

    if (error instanceof AccessDeniedError) {
      const code = error.decision.reason === 'not-entitled' ? 'not_entitled' : 'forbidden';
      return reply
        .status(error.status)
        .send(failure([apiError(code, 'Access denied', message)], { requestId }));
    }

    // A lost update is a conflict the client can resolve by reloading, not a
    // server fault — it must not look like one.
    if (name === 'StaleWriteError') {
      return reply
        .status(409)
        .send(failure([apiError('conflict', 'Modified by someone else', message)], { requestId }));
    }

    if (error instanceof ProductInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Invalid product', message, error.field)], { requestId }));
    }

    if (error instanceof CustomerInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Invalid customer', message, error.field)], { requestId }));
    }

    if (name === 'CustomerNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    if (name === 'DuplicateCustomerError') {
      return reply
        .status(409)
        .send(failure([apiError('conflict', 'Already exists', message)], { requestId }));
    }

    if (error instanceof CollectionInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Invalid collection', message, error.field)], { requestId }));
    }

    if (name === 'CollectionNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    if (name === 'ModuleStateError' || name === 'SettingsError') {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Refused', message)], { requestId }));
    }

    if (error instanceof ContentInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Invalid content', message, error.field)], { requestId }));
    }

    if (name === 'ContentNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    if (error instanceof InventoryInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Invalid inventory change', message, error.field)], { requestId }));
    }

    if (name === 'InventoryNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    if (error instanceof RequestInvariantError) {
      return reply
        .status(422)
        .send(failure([apiError('validation_failed', 'Cannot do that', message, error.field)], { requestId }));
    }

    if (name === 'RequestNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    if (name === 'ProductNotFoundError') {
      return reply
        .status(404)
        .send(failure([apiError('not_found', 'Not found', message)], { requestId }));
    }

    // Internal detail never reaches the client; the log keeps it.
    const detail = status >= 500 ? 'An unexpected error occurred.' : message;
    // eslint-disable-next-line no-console
    if (status >= 500) console.error('[error]', error);

    return reply.status(status).send(
      failure(
        [apiError(status >= 500 ? 'internal_error' : 'validation_failed', name, detail)],
        { requestId },
      ),
    );
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });

  // eslint-disable-next-line no-console
  console.log(
    `API listening on :${port} — ${platform.registry.enabled().length} modules, ${platform.routes.length} routes, ${platform.dialect.name}`,
  );

  /**
   * Sends what is due, every few seconds.
   *
   * In-process is honest for one node and wrong for several: two would both
   * claim the same due rows and deliver twice. The fix when that day comes is a
   * claim on the row (SELECT … FOR UPDATE SKIP LOCKED), not a bigger interval —
   * writing that down here because "it worked on one box" is exactly how
   * duplicate deliveries reach production.
   */
  const drainTimer = setInterval(() => {
    void platform.drainWebhooks().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[webhooks] drain failed', error);
    });
  }, 5_000);
  drainTimer.unref();

  const shutdown = async () => {
    clearInterval(drainTimer);
    await app.close();
    await platform.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start:', error);
  process.exit(1);
});
