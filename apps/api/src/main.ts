/**
 * main.ts
 * The HTTP entry point. Fastify, kept deliberately thin (ADR 0003): parse,
 * establish context, authorize, serialize, call a use-case. No business logic
 * lives here, which is what keeps the same services usable from GraphQL, a
 * worker or the CLI (§13.1).
 * Layer: transport.
 */

import Fastify from 'fastify';

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
import { bootstrap, newRequestId } from './composition-root';
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

  // --- generic read surface -------------------------------------------------
  // Every REST-exposed resource gets list and get from its declaration alone.
  // Writes stay module-owned: a generic writer would be a way around the domain.

  const bindings = bindResources(platform.registry);
  const reader = new GenericReader(platform.executor, platform.dialect);

  for (const [key, binding] of bindings) {
    const moduleId = key.split(':')[0]!;
    const base = `/${API_VERSION}/${moduleId}/${binding.resource.urlSegment}`;

    const guardStore = (request: never, reply: { status(code: number): { send(body: unknown): unknown } }) => {
      const context = contextFor(request);
      if (context.storeId === null) {
        reply
          .status(400)
          .send(failure([apiError('validation_failed', 'Missing store', 'Set the X-Store-Id header.')], { requestId: context.requestId }));
        return null;
      }
      return context;
    };

    app.get(base, async (request, reply) => {
      const context = guardStore(request as never, reply as never);
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
      const context = guardStore(request as never, reply as never);
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

  // --- catalog writes -------------------------------------------------------
  // Reads come from the generic surface above. Writes stay here because they go
  // through the module's service, where invariants and events live.

  /**
   * Every write goes through the same shape: establish context, check the
   * permission, call the use-case. The access check is explicit rather than a
   * decorator so it is visible at the call site — authorisation that is easy to
   * miss when reading is authorisation that gets missed when editing.
   */
  const withStore = async <T>(
    request: { headers: Record<string, unknown>; id: string },
    reply: { status(code: number): { send(body: unknown): unknown } },
    permission: string,
    handler: (storeId: StoreId, context: RequestContext) => Promise<T>,
  ) => {
    const context = contextFor(request);
    if (context.storeId === null) {
      return reply
        .status(400)
        .send(failure([apiError('validation_failed', 'Missing store', 'Set the X-Store-Id header.')], { requestId: context.requestId }));
    }

    // The module is derived from the permission's own namespace rather than
    // passed in. It used to be hardcoded to 'catalog' for every route, so the
    // entitlement half of this check asked whether CATALOG was enabled before
    // letting someone edit a customer — the right answer by luck, and the wrong
    // one the moment a store runs without catalog.
    await platform.access.assert({ context, permission, moduleId: moduleForPermission(permission) });
    return withRequestContext(context, () => handler(context.storeId as StoreId, context));
  };

  app.post(`/${API_VERSION}/catalog/products`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.write', async (storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const product = await platform.productServiceFor(storeId).create({
        title: String(body.title ?? ''),
        description: body.description === undefined ? undefined : String(body.description),
        handle: body.handle === undefined ? undefined : String(body.handle),
        vendor: (body.vendor ?? null) as string | null,
        productType: (body.productType ?? null) as string | null,
        price: parseMoney(body.price),
        status: body.status as 'draft' | 'active' | 'archived' | undefined,
      });
      return reply.status(201).send(success(toProductDto(product), { requestId: context.requestId }));
    }),
  );

  app.patch(`/${API_VERSION}/catalog/products/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.write', async (storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const { id } = request.params as { id: string };

      const product = await platform.productServiceFor(storeId).update({
        id,
        // The client must send the version it read. Omitting it is not "no
        // opinion", it is a lost update waiting to happen.
        expectedVersion: Number(body.version ?? -1),
        ...(body.title === undefined ? {} : { title: String(body.title) }),
        ...(body.description === undefined ? {} : { description: String(body.description) }),
        ...(body.handle === undefined ? {} : { handle: String(body.handle) }),
        ...(body.status === undefined ? {} : { status: body.status as 'draft' | 'active' | 'archived' }),
        ...(body.vendor === undefined ? {} : { vendor: body.vendor as string | null }),
        ...(body.productType === undefined ? {} : { productType: body.productType as string | null }),
        ...(body.price === undefined ? {} : { price: parseMoney(body.price) }),
      });
      return success(toProductDto(product), { requestId: context.requestId });
    }),
  );

  app.post(`/${API_VERSION}/catalog/products/:id/publish`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.publish', async (storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const { id } = request.params as { id: string };
      const channels = Array.isArray(body.channels) ? (body.channels as unknown[]).map(String) : ['online-store'];

      const product = await platform
        .productServiceFor(storeId)
        .publish(id, channels, Number(body.version ?? -1));
      return success(toProductDto(product), { requestId: context.requestId });
    }),
  );

  app.delete(`/${API_VERSION}/catalog/products/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.write', async (storeId, context) => {
      const { id } = request.params as { id: string };
      // Soft delete: hidden and restorable, never destroyed (§12.1).
      await platform.productServiceFor(storeId).delete(id);
      return success({ id, deleted: true }, { requestId: context.requestId });
    }),
  );

  // --- collections ----------------------------------------------------------
  // Rules are set as a whole set rather than one condition at a time: a
  // per-condition endpoint would let a screen leave the collection in a state
  // the engine cannot evaluate between two calls.

  const toCollectionDto = (collection: Collection) => ({
    id: collection.id,
    handle: collection.handle,
    title: collection.title,
    description: collection.description,
    type: collection.type,
    match: collection.match,
    conditions: collection.conditions,
    exclusions: collection.exclusions,
    productIds: collection.productIds,
    sortOrder: collection.sortOrder,
    version: collection.version,
  });

  app.get(`/${API_VERSION}/catalog/collections/:id/detail`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.read', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const found = await platform.collectionServiceFor(storeId).get(id);
      return success(toCollectionDto(found), { requestId: context.requestId });
    }),
  );

  app.patch(`/${API_VERSION}/catalog/collections/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.write', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform.collectionServiceFor(storeId).updateDetails({
        id,
        expectedVersion: Number(body.version ?? -1),
        ...(body.title === undefined ? {} : { title: String(body.title) }),
        ...(body.description === undefined ? {} : { description: String(body.description) }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder as Collection['sortOrder'] }),
      });
      return success(toCollectionDto(updated), { requestId: context.requestId });
    }),
  );

  app.put(`/${API_VERSION}/catalog/collections/:id/rules`, async (request, reply) =>
    withStore(request as never, reply as never, 'catalog.write', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform.collectionServiceFor(storeId).setRules({
        id,
        expectedVersion: Number(body.version ?? -1),
        match: (body.match as 'all' | 'any') ?? 'all',
        conditions: (body.conditions ?? []) as Condition[],
        exclusions: (body.exclusions ?? []) as Condition[],
      });
      return success(toCollectionDto(updated), { requestId: context.requestId });
    }),
  );

  // --- customers ------------------------------------------------------------
  // Consent has its own endpoint, mirroring the service. Folding it into the
  // generic update would let a bulk edit change consent by accident and would
  // lose the before/after pair a compliance question needs.

  const toCustomerDto = (customer: Customer) => ({
    id: customer.id,
    displayName: displayName(customer),
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    state: customer.state,
    emailConsent: customer.emailConsent,
    smsConsent: customer.smsConsent,
    locale: customer.locale,
    taxExempt: customer.taxExempt,
    ordersCount: customer.ordersCount,
    totalSpent: {
      amount: toDecimalString(customer.totalSpent),
      currency: customer.totalSpent.currency,
    },
    version: customer.version,
  });

  app.get(`/${API_VERSION}/customers/customers/:id/detail`, async (request, reply) =>
    withStore(request as never, reply as never, 'customers.read', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const found = await platform.customerServiceFor(storeId).get(id);
      return success(toCustomerDto(found), { requestId: context.requestId });
    }),
  );

  app.patch(`/${API_VERSION}/customers/customers/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'customers.manage', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform.customerServiceFor(storeId).update({
        id,
        expectedVersion: Number(body.version ?? -1),
        ...(body.firstName === undefined ? {} : { firstName: body.firstName as string | null }),
        ...(body.lastName === undefined ? {} : { lastName: body.lastName as string | null }),
        ...(body.phone === undefined ? {} : { phone: body.phone as string | null }),
        ...(body.note === undefined ? {} : { note: body.note as string | null }),
        ...(body.taxExempt === undefined ? {} : { taxExempt: Boolean(body.taxExempt) }),
      });
      return success(toCustomerDto(updated), { requestId: context.requestId });
    }),
  );

  app.post(`/${API_VERSION}/customers/customers/:id/consent`, async (request, reply) =>
    withStore(request as never, reply as never, 'customers.manage', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform.customerServiceFor(storeId).changeConsent({
        id,
        channel: (body.channel as 'email' | 'sms') ?? 'email',
        to: (body.to as MarketingConsent) ?? 'unknown',
        expectedVersion: Number(body.version ?? -1),
      });
      return success(toCustomerDto(updated), { requestId: context.requestId });
    }),
  );

  // --- requests -------------------------------------------------------------
  // The quoting workflow. Each step is its own endpoint rather than a generic
  // "set status", because the transitions carry rules — a quote cannot be sent
  // half-priced, and an expired one cannot be accepted.

  /** The wire shape, including lines, which the generic reader does not load. */
  const toRequestDto = (request: QuoteRequest) => ({
    id: request.id,
    reference: request.reference,
    customerId: request.customerId,
    contactEmail: request.contactEmail,
    contactName: request.contactName,
    status: request.status,
    currency: request.currency,
    note: request.note,
    quoteExpiresAt: request.quoteExpiresAt,
    submittedAt: request.submittedAt,
    version: request.version,
    subtotal: {
      amount: toDecimalString(subtotal(request)),
      currency: request.currency,
    },
    lines: request.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      title: line.title,
      sku: line.sku,
      quantity: line.quantity,
      listPrice: { amount: toDecimalString(line.listPrice), currency: line.listPrice.currency },
      quotedPrice: line.quotedPrice
        ? { amount: toDecimalString(line.quotedPrice), currency: line.quotedPrice.currency }
        : null,
      note: line.note,
    })),
  });

  app.get(`/${API_VERSION}/orders/requests/:id/detail`, async (request, reply) =>
    withStore(request as never, reply as never, 'orders.read', async (storeId, context) => {
      const { id } = request.params as { id: string };
      const found = await platform.requestServiceFor(storeId).get(id);
      return success(toRequestDto(found), { requestId: context.requestId });
    }),
  );

  app.post(`/${API_VERSION}/orders/requests/:id/lines`, async (request, reply) =>
    withStore(request as never, reply as never, 'orders.manage', async (storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const { id } = request.params as { id: string };

      const updated = await platform.requestServiceFor(storeId).addLine(
        id,
        {
          productId: String(body.productId ?? ''),
          title: String(body.title ?? ''),
          sku: body.sku === undefined ? null : String(body.sku),
          quantity: Number(body.quantity ?? 1),
          listPrice: parseMoney(body.listPrice),
        },
        Number(body.version ?? -1),
      );
      return success(toRequestDto(updated), { requestId: context.requestId });
    }),
  );

  app.delete(`/${API_VERSION}/orders/requests/:id/lines/:lineId`, async (request, reply) =>
    withStore(request as never, reply as never, 'orders.manage', async (storeId, context) => {
      const { id, lineId } = request.params as { id: string; lineId: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform
        .requestServiceFor(storeId)
        .removeLine(id, lineId, Number(body.version ?? -1));
      return success(toRequestDto(updated), { requestId: context.requestId });
    }),
  );

  app.post(`/${API_VERSION}/orders/requests/:id/lines/:lineId/quote`, async (request, reply) =>
    withStore(request as never, reply as never, 'orders.quote', async (storeId, context) => {
      const { id, lineId } = request.params as { id: string; lineId: string };
      const body = request.body as Record<string, unknown>;
      const updated = await platform
        .requestServiceFor(storeId)
        .quoteLine(id, lineId, parseMoney(body.price), Number(body.version ?? -1));
      return success(toRequestDto(updated), { requestId: context.requestId });
    }),
  );

  for (const [action, permission] of [
    ['submit', 'orders.manage'],
    ['quote', 'orders.quote'],
    ['accept', 'orders.manage'],
    ['decline', 'orders.manage'],
    ['cancel', 'orders.manage'],
  ] as const) {
    app.post(`/${API_VERSION}/orders/requests/:id/${action}`, async (request, reply) =>
      withStore(request as never, reply as never, permission, async (storeId, context) => {
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;
        const version = Number(body.version ?? -1);
        const service = platform.requestServiceFor(storeId);

        const updated =
          action === 'submit'
            ? await service.submit(id, version)
            : action === 'quote'
              ? await service.sendQuote(id, version)
              : action === 'accept'
                ? await service.accept(id, version)
                : action === 'decline'
                  ? await service.decline(id, String(body.reason ?? 'no reason given'), version)
                  : await service.cancel(id, version);

        return success(toRequestDto(updated), { requestId: context.requestId });
      }),
    );
  }

  // --- inventory ------------------------------------------------------------
  // Levels are read through the generic surface like any other resource; these
  // are the operations that MOVE stock, which is where the invariants live.

  const toLocationDto = (location: StoredLocation) => ({
    id: location.id,
    name: location.name,
    address: location.address,
    countryCode: location.countryCode,
    fulfilsOrders: location.fulfilsOrders,
    archivedAt: location.archivedAt?.toISOString() ?? null,
    version: location.version,
  });

  const toLevelDto = (level: StoredLevel) => ({
    id: level.id,
    locationId: level.locationId,
    productId: level.productId,
    variantId: level.variantId,
    title: level.title,
    sku: level.sku,
    onHand: level.onHand,
    committed: level.committed,
    incoming: level.incoming,
    // Derived, never stored — a stored copy is one more thing that can disagree
    // with the numbers it is derived from.
    available: platform.inventory.availableFor(level),
    version: level.version,
  });

  const toAdjustmentDto = (adjustment: InventoryAdjustment) => ({
    id: adjustment.id,
    locationId: adjustment.locationId,
    productId: adjustment.productId,
    variantId: adjustment.variantId,
    delta: adjustment.delta,
    reason: adjustment.reason,
    reference: adjustment.reference,
    occurredAt: adjustment.occurredAt.toISOString(),
  });

  const toPurchaseOrderDto = (order: PurchaseOrder) => ({
    id: order.id,
    reference: order.reference,
    supplierName: order.supplierName,
    destinationLocationId: order.destinationLocationId,
    status: order.status,
    expectedAt: order.expectedAt?.toISOString() ?? null,
    lines: order.lines,
    version: order.version,
  });

  const toTransferDto = (transfer: Transfer) => ({
    id: transfer.id,
    reference: transfer.reference,
    originLocationId: transfer.originLocationId,
    destinationLocationId: transfer.destinationLocationId,
    status: transfer.status,
    lines: transfer.lines,
    inTransit: inTransit(transfer),
    version: transfer.version,
  });

  app.get(`/${API_VERSION}/inventory/locations/active`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.read', async (_storeId, context) =>
      success(
        (await platform.inventory.locationsForPicker()).map(toLocationDto),
        { requestId: context.requestId },
      ),
    ),
  );

  app.post(`/${API_VERSION}/inventory/inventory/adjust`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.adjust', async (_storeId, context) => {
      const body = request.body as Record<string, unknown>;

      // Two ways to say the same thing: a signed movement, or a counted total.
      // The service turns the count into a movement so the log only ever holds
      // deltas with reasons.
      const level =
        body.onHand === undefined
          ? await platform.inventory.adjust({
              locationId: String(body.locationId ?? ''),
              productId: String(body.productId ?? ''),
              variantId: (body.variantId ?? null) as string | null,
              delta: Number(body.delta ?? 0),
              reason: (body.reason ?? 'correction') as never,
              reference: (body.reference ?? null) as string | null,
              title: body.title === undefined ? undefined : String(body.title),
              sku: (body.sku ?? null) as string | null,
            })
          : await platform.inventory.recount({
              locationId: String(body.locationId ?? ''),
              productId: String(body.productId ?? ''),
              variantId: (body.variantId ?? null) as string | null,
              onHand: Number(body.onHand),
              title: body.title === undefined ? undefined : String(body.title),
              sku: (body.sku ?? null) as string | null,
            });

      return success(toLevelDto(level), { requestId: context.requestId });
    }),
  );

  app.get(`/${API_VERSION}/inventory/inventory/:id/history`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.read', async (_storeId, context) => {
      const { id } = request.params as { id: string };
      const level = await platform.inventory.get(id);
      const history = await platform.inventory.history(level.locationId, level.productId);
      return success(
        { level: toLevelDto(level), history: history.map(toAdjustmentDto) },
        { requestId: context.requestId },
      );
    }),
  );

  app.get(`/${API_VERSION}/inventory/purchase-orders/:id/detail`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.read', async (_storeId, context) => {
      const { id } = request.params as { id: string };
      return success(toPurchaseOrderDto(await platform.purchaseOrders.get(id)), {
        requestId: context.requestId,
      });
    }),
  );

  app.post(`/${API_VERSION}/inventory/purchase-orders`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const order = await platform.purchaseOrders.create({
        supplierName: String(body.supplierName ?? ''),
        destinationLocationId: String(body.destinationLocationId ?? ''),
        expectedAt: (body.expectedAt ?? null) as string | null,
        lines: (body.lines ?? []) as never,
      });
      return reply.status(201).send(success(toPurchaseOrderDto(order), { requestId: context.requestId }));
    }),
  );

  app.patch(`/${API_VERSION}/inventory/purchase-orders/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const order = await platform.purchaseOrders.update(id, Number(body.version ?? -1), {
        supplierName: body.supplierName === undefined ? undefined : String(body.supplierName),
        expectedAt: body.expectedAt as string | null | undefined,
        lines: body.lines as never,
      });
      return success(toPurchaseOrderDto(order), { requestId: context.requestId });
    }),
  );

  for (const action of ['place', 'receive', 'cancel'] as const) {
    app.post(`/${API_VERSION}/inventory/purchase-orders/:id/${action}`, async (request, reply) =>
      withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;
        const version = Number(body.version ?? -1);

        const order =
          action === 'place'
            ? await platform.purchaseOrders.place(id, version)
            : action === 'receive'
              ? await platform.purchaseOrders.receive(id, version, (body.lines ?? []) as never)
              : await platform.purchaseOrders.cancel(id, version);

        return success(toPurchaseOrderDto(order), { requestId: context.requestId });
      }),
    );
  }

  app.get(`/${API_VERSION}/inventory/transfers/:id/detail`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.read', async (_storeId, context) => {
      const { id } = request.params as { id: string };
      return success(toTransferDto(await platform.transfers.get(id)), {
        requestId: context.requestId,
      });
    }),
  );

  app.post(`/${API_VERSION}/inventory/transfers`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
      const body = request.body as Record<string, unknown>;
      const transfer = await platform.transfers.create({
        originLocationId: String(body.originLocationId ?? ''),
        destinationLocationId: String(body.destinationLocationId ?? ''),
        lines: (body.lines ?? []) as never,
      });
      return reply.status(201).send(success(toTransferDto(transfer), { requestId: context.requestId }));
    }),
  );

  app.patch(`/${API_VERSION}/inventory/transfers/:id`, async (request, reply) =>
    withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const transfer = await platform.transfers.update(id, Number(body.version ?? -1), {
        destinationLocationId:
          body.destinationLocationId === undefined ? undefined : String(body.destinationLocationId),
        lines: body.lines as never,
      });
      return success(toTransferDto(transfer), { requestId: context.requestId });
    }),
  );

  for (const action of ['ship', 'receive', 'cancel'] as const) {
    app.post(`/${API_VERSION}/inventory/transfers/:id/${action}`, async (request, reply) =>
      withStore(request as never, reply as never, 'inventory.manage', async (_storeId, context) => {
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, unknown>;
        const version = Number(body.version ?? -1);

        const transfer =
          action === 'ship'
            ? await platform.transfers.ship(id, version)
            : action === 'receive'
              ? await platform.transfers.receive(id, version, (body.lines ?? []) as never)
              : await platform.transfers.cancel(id, version);

        return success(toTransferDto(transfer), { requestId: context.requestId });
      }),
    );
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

/**
 * The module a permission belongs to, from its namespace: `inventory.adjust` →
 * `inventory`. Permission keys are already namespaced by module (§31.4), so the
 * mapping is the convention rather than a second table to keep in step.
 *
 * The two that do not follow their own name are listed explicitly. Silently
 * falling back to the first segment for them would ask the entitlement check
 * about a module that does not exist, and a module that does not exist is not
 * enabled — every catalog write would have been refused.
 */
const MODULE_BY_PERMISSION_PREFIX: Readonly<Record<string, string>> = {
  catalog: 'catalog',
  orders: 'orders',
  customers: 'customers',
  inventory: 'inventory',
  content: 'content',
  store: 'catalog',
  auth: 'auth',
};

function moduleForPermission(permission: string): string {
  const prefix = permission.split('.')[0] ?? '';
  return MODULE_BY_PERMISSION_PREFIX[prefix] ?? prefix;
}

/** Accepts `{ amount: "19.99", currency: "USD" }` and refuses anything else. */
function parseMoney(value: unknown) {
  const candidate = value as { amount?: unknown; currency?: unknown } | undefined;
  if (!candidate || typeof candidate.amount !== 'string' || typeof candidate.currency !== 'string') {
    throw new ProductInvariantError('price', 'must be { amount: "19.99", currency: "USD" }');
  }
  return moneyFromDecimalString(candidate.amount, candidate.currency);
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start:', error);
  process.exit(1);
});
