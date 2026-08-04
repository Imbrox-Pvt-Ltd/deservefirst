/**
 * main.ts
 * The HTTP entry point. Fastify, kept deliberately thin (ADR 0003): parse,
 * establish context, authorize, serialize, call a use-case. No business logic
 * lives here, which is what keeps the same services usable from GraphQL, a
 * worker or the CLI (§13.1).
 * Layer: transport.
 */

import Fastify from 'fastify';

import { apiError, failure, paginated, success, withRequestContext } from './core';
import { AccessDeniedError } from './auth/application';
import { bootstrap, newRequestId } from './composition-root';
import { toProductDto } from './modules/catalog/api/product.controller';
import {
  parseListQuery,
  type OrganizationId,
  type RequestContext,
  type StoreId,
  type UserId,
} from '@deservefirst/contracts';

/** Dated API version (§13.6). */
const API_VERSION = '2026-01';

async function start(): Promise<void> {
  const platform = await bootstrap();
  const app = Fastify({ logger: false });

  /**
   * Establishes the request context (§5.6). In development the store and actor
   * come from headers so the admin can be driven before the login UI exists;
   * once auth is wired these are replaced by the verified token claims and the
   * headers stop being trusted.
   */
  const contextFor = (request: {
    headers: Record<string, unknown>;
    id: string;
  }): RequestContext => {
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === 'string' && value.length > 0 ? value : null;
    };

    return {
      requestId: header('x-request-id') ?? request.id ?? newRequestId(),
      correlationId: header('x-correlation-id') ?? request.id ?? newRequestId(),
      actorType: 'user',
      userId: (header('x-user-id') as UserId | null),
      organizationId: header('x-organization-id') as OrganizationId | null,
      businessEntityId: null,
      storeId: header('x-store-id') as StoreId | null,
      partnerId: null,
      accessType: 'member',
      roleKeys: [],
      permissions: (header('x-permissions') ?? '').split(',').filter(Boolean),
      supportSessionId: null,
      entitlementsHash: null,
      locale: header('accept-language') ?? 'en-US',
      timeZone: 'UTC',
      shardKey: null,
    };
  };

  app.addHook('onSend', async (_request, reply) => {
    // Correlation ids propagate end to end so a log line can be traced to a
    // request and an event (§14.7).
    reply.header('x-api-version', API_VERSION);
  });

  // --- platform reflection (§36.1) -----------------------------------------

  app.get('/health', async () => ({ status: 'ok', version: API_VERSION }));

  app.get(`/${API_VERSION}/platform/modules`, async (request) => {
    const meta = { requestId: contextFor(request as never).requestId };
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
    success(platform.routes, { requestId: contextFor(request as never).requestId }),
  );

  app.get(`/${API_VERSION}/platform/navigation`, async (request) =>
    success(
      platform.registry.navigation().map((entry) => ({ moduleId: entry.moduleId, ...entry.item })),
      { requestId: contextFor(request as never).requestId },
    ),
  );

  app.get(`/${API_VERSION}/platform/settings`, async (request) =>
    success(
      platform.registry.settings().map((entry) => ({ moduleId: entry.moduleId, ...entry.item })),
      { requestId: contextFor(request as never).requestId },
    ),
  );

  // --- catalog --------------------------------------------------------------

  app.get(`/${API_VERSION}/catalog/products`, async (request, reply) => {
    const context = contextFor(request as never);
    if (context.storeId === null) {
      return reply
        .status(400)
        .send(failure([apiError('validation_failed', 'Missing store', 'Set the X-Store-Id header.')], { requestId: context.requestId }));
    }

    return withRequestContext(context, async () => {
      const url = new URL(request.url, 'http://internal');
      const connection = await platform.products.list(parseListQuery(url.searchParams));
      return paginated(
        { ...connection, nodes: connection.nodes.map(toProductDto) },
        { requestId: context.requestId },
      );
    });
  });

  app.get(`/${API_VERSION}/catalog/products/:id`, async (request, reply) => {
    const context = contextFor(request as never);
    const { id } = request.params as { id: string };

    return withRequestContext(context, async () => {
      const product = await platform.products.findById(id);
      if (!product) {
        return reply
          .status(404)
          .send(failure([apiError('not_found', 'Not found', `No product "${id}" in this store.`)], { requestId: context.requestId }));
      }
      return success(toProductDto(product), { requestId: context.requestId });
    });
  });

  // --- error shape ----------------------------------------------------------

  app.setErrorHandler((error: unknown, request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) ?? request.id;
    const status = (error as { status?: number }).status ?? 500;
    const name = (error as { name?: string }).name ?? 'Error';
    const message = (error as { message?: string }).message ?? 'Unknown error';

    if (error instanceof AccessDeniedError) {
      return reply
        .status(error.status)
        .send(failure([apiError('forbidden', 'Access denied', message)], { requestId }));
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
