/**
 * describe.ts
 * The platform's surface, without starting it.
 *
 * Documentation generation must not need a database, a port or a running
 * server — a doc step that can fail for operational reasons is a doc step that
 * gets skipped, and then the reference drifts, which is the exact thing §26.2
 * exists to prevent.
 *
 * The controllers are built with stub services. Their handlers are never
 * invoked here; only method, path, permission and status are read.
 * Layer: composition root.
 */

import { ModuleRegistry, buildOpenApiDocument, type ModuleController } from './core';
import { platformManifest } from './core/platform.manifest';
import { authManifest } from './auth/auth.manifest';
import { catalogManifest } from './modules/catalog/catalog.manifest';
import { contentManifest } from './modules/content/content.manifest';
import { customersManifest } from './modules/customers/customers.manifest';
import { inventoryManifest } from './modules/inventory/inventory.manifest';
import { ordersManifest } from './modules/orders/orders.manifest';
import { catalogController } from './modules/catalog/api/catalog.controller';
import { contentController } from './modules/content/api/content.controller';
import { customersController } from './modules/customers/api/customers.controller';
import { inventoryController } from './modules/inventory/api/inventory.controller';
import { ordersController } from './modules/orders/api/orders.controller';
import { webhooksController } from './core/webhooks/webhooks.controller';
import { partnerController } from './auth/api/partner.controller';
import { appsController } from './apps/api/apps.controller';
import { appsManifest } from './apps/apps.manifest';

/**
 * Stands in for a module's services while its routes are read.
 *
 * Property access has to SUCCEED — a controller may destructure its services or
 * capture them in a closure while it is being constructed — but calling one must
 * fail loudly, so this can never be mistaken for a working platform.
 */
function describeOnlyServices(): never {
  const proxy: unknown = new Proxy(function noop() {}, {
    get: () => proxy,
    apply: () => {
      throw new Error('describe.ts builds controllers to read their routes, never to run them.');
    },
  });
  return proxy as never;
}

const unused = describeOnlyServices();

export function describePlatform(): {
  registry: ModuleRegistry;
  controllers: readonly ModuleController[];
} {
  const registry = new ModuleRegistry();
  for (const manifest of [
    platformManifest,
    authManifest,
    catalogManifest,
    customersManifest,
    ordersManifest,
    contentManifest,
    inventoryManifest,
    appsManifest,
  ]) {
    registry.register(manifest);
  }
  registry.seal();

  return {
    registry,
    controllers: [
      catalogController(unused),
      customersController(unused),
      ordersController(unused),
      inventoryController(unused),
      contentController(unused),
      // Core contributes routes too, and they are the ones an integrator needs
      // most — they are how a partner receives anything at all.
      webhooksController(unused),
      partnerController(unused),
      appsController(unused),
    ],
  };
}

export function generateOpenApi(version: string, serverUrl: string) {
  const { registry, controllers } = describePlatform();
  return buildOpenApiDocument(registry, controllers, {
    version,
    title: 'DeserveFirst Admin API',
    serverUrl,
  });
}
