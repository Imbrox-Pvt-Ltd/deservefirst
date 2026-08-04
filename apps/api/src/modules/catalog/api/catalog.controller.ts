/**
 * Catalog · api/catalog.controller.ts
 * The module's HTTP surface: products, their options and variants, and
 * collections.
 *
 * Reads come from the platform's generic surface, built from the resource
 * declarations. What lives here is everything that WRITES, because a write goes
 * through the service where the invariants and events are — a generic writer
 * would be a way around the domain (§13.1).
 * Layer: api.
 */

import { moneyFromDecimalString } from '@deservefirst/contracts';

import { controller, type ModuleController, type RouteRequest } from '../../../core/http/controller';
import type { CollectionService, ProductService } from '../application';
import { ProductInvariantError, type Collection, type Condition } from '../domain';
import { toProductDto } from './product.controller';

export interface CatalogServices {
  productServiceFor(storeId: string): ProductService;
  collectionServiceFor(storeId: string): CollectionService;
}

/**
 * Rules are set as a whole set rather than one condition at a time: a
 * per-condition endpoint would let a screen leave a collection in a state the
 * engine cannot evaluate between two calls.
 */
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

/** The version the client read. Omitting it is not "no opinion" — it is a lost update. */
const expectedVersion = (request: RouteRequest): number => Number(request.body.version ?? -1);

export function catalogController(services: CatalogServices): ModuleController {
  const products = (request: RouteRequest) => services.productServiceFor(request.storeId);
  const collections = (request: RouteRequest) => services.collectionServiceFor(request.storeId);

  return controller('catalog', [
    // --- products ------------------------------------------------------------
    {
      method: 'POST',
      path: '/products',
      permission: 'catalog.write',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toProductDto(
          await products(request).create({
            title: String(body.title ?? ''),
            description: body.description === undefined ? undefined : String(body.description),
            handle: body.handle === undefined ? undefined : String(body.handle),
            vendor: (body.vendor ?? null) as string | null,
            productType: (body.productType ?? null) as string | null,
            price: parseMoney(body.price),
            status: body.status as 'draft' | 'active' | 'archived' | undefined,
          }),
        );
      },
    },
    {
      // The full aggregate, variants included. The generic surface cannot serve
      // this: it projects declared fields, and variants live in their own table.
      method: 'GET',
      path: '/products/:id/detail',
      permission: 'catalog.read',
      handle: async (request) => toProductDto(await products(request).get(request.params.id!)),
    },
    {
      method: 'PATCH',
      path: '/products/:id',
      permission: 'catalog.write',
      handle: async (request) => {
        const { body } = request;
        return toProductDto(
          await products(request).update({
            id: request.params.id!,
            expectedVersion: expectedVersion(request),
            ...(body.title === undefined ? {} : { title: String(body.title) }),
            ...(body.description === undefined ? {} : { description: String(body.description) }),
            ...(body.handle === undefined ? {} : { handle: String(body.handle) }),
            ...(body.status === undefined
              ? {}
              : { status: body.status as 'draft' | 'active' | 'archived' }),
            ...(body.vendor === undefined ? {} : { vendor: body.vendor as string | null }),
            ...(body.productType === undefined
              ? {}
              : { productType: body.productType as string | null }),
            ...(body.price === undefined ? {} : { price: parseMoney(body.price) }),
          }),
        );
      },
    },
    {
      method: 'POST',
      path: '/products/:id/publish',
      permission: 'catalog.publish',
      handle: async (request) => {
        const channels = Array.isArray(request.body.channels)
          ? (request.body.channels as unknown[]).map(String)
          : ['online-store'];
        return toProductDto(
          await products(request).publish(request.params.id!, channels, expectedVersion(request)),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/products/:id',
      permission: 'catalog.write',
      handle: async (request) => {
        // Soft delete: hidden and restorable, never destroyed (§12.1).
        await products(request).delete(request.params.id!);
        return { id: request.params.id, deleted: true };
      },
    },

    // --- options and variants -------------------------------------------------
    {
      method: 'PUT',
      path: '/products/:id/options',
      permission: 'catalog.write',
      handle: async (request) =>
        toProductDto(
          await products(request).setOptions(
            request.params.id!,
            expectedVersion(request),
            (request.body.options ?? []) as never,
          ),
        ),
    },
    {
      // Which variants EXIST follows from the options; this only prices them.
      method: 'PATCH',
      path: '/products/:id/variants',
      permission: 'catalog.write',
      handle: async (request) => {
        const patches = ((request.body.variants ?? []) as Record<string, unknown>[]).map((entry) => ({
          id: String(entry.id ?? ''),
          sku: entry.sku === undefined ? undefined : ((entry.sku ?? null) as string | null),
          price: entry.price === undefined ? undefined : parseMoney(entry.price),
          inventoryQuantity:
            entry.inventoryQuantity === undefined ? undefined : Number(entry.inventoryQuantity),
        }));

        return toProductDto(
          await products(request).updateVariants(
            request.params.id!,
            expectedVersion(request),
            patches,
          ),
        );
      },
    },

    // --- collections ----------------------------------------------------------
    {
      method: 'POST',
      path: '/collections',
      permission: 'catalog.write',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toCollectionDto(
          await collections(request).create({
            title: String(body.title ?? ''),
            description: body.description === undefined ? undefined : String(body.description),
            handle: body.handle === undefined ? undefined : String(body.handle),
            // A collection with no rules is manual; the first condition makes it
            // automated.
            type: body.type === 'automated' ? 'automated' : 'manual',
          }),
        );
      },
    },
    {
      method: 'GET',
      path: '/collections/:id/detail',
      permission: 'catalog.read',
      handle: async (request) => toCollectionDto(await collections(request).get(request.params.id!)),
    },
    {
      method: 'PATCH',
      path: '/collections/:id',
      permission: 'catalog.write',
      handle: async (request) => {
        const { body } = request;
        return toCollectionDto(
          await collections(request).updateDetails({
            id: request.params.id!,
            expectedVersion: expectedVersion(request),
            ...(body.title === undefined ? {} : { title: String(body.title) }),
            ...(body.description === undefined ? {} : { description: String(body.description) }),
            ...(body.sortOrder === undefined
              ? {}
              : { sortOrder: body.sortOrder as Collection['sortOrder'] }),
          }),
        );
      },
    },
    {
      method: 'PUT',
      path: '/collections/:id/rules',
      permission: 'catalog.write',
      handle: async (request) =>
        toCollectionDto(
          await collections(request).setRules({
            id: request.params.id!,
            expectedVersion: expectedVersion(request),
            match: (request.body.match as 'all' | 'any') ?? 'all',
            conditions: (request.body.conditions ?? []) as Condition[],
            exclusions: (request.body.exclusions ?? []) as Condition[],
          }),
        ),
    },
  ]);
}

/** Accepts `{ amount: "19.99", currency: "USD" }` and refuses anything else. */
function parseMoney(value: unknown) {
  const candidate = value as { amount?: unknown; currency?: unknown } | undefined;
  if (!candidate || typeof candidate.amount !== 'string' || typeof candidate.currency !== 'string') {
    throw new ProductInvariantError('price', 'must be { amount: "19.99", currency: "USD" }');
  }
  return moneyFromDecimalString(candidate.amount, candidate.currency);
}
