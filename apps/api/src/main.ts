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
  type RequestContext,
  type StoreId,
  type UserId,
} from '@deservefirst/contracts';

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

  const platformGuard = async (
    request: { headers: Record<string, unknown>; id: string },
    reply: { status(code: number): { send(body: unknown): unknown } },
    permission: string,
  ) => {
    const context = await contextFor(request);
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

  const shutdown = async () => {
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
