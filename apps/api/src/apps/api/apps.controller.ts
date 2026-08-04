/**
 * Apps · api/apps.controller.ts
 * The merchant's view of the apps in their store.
 *
 * Only the store-scoped routes are here. The OAuth endpoints are not: an app
 * exchanging a code has no session and no store header, and mounting it on the
 * store-scoped surface would mean inventing a way for an unauthenticated caller
 * to name a store — which is the hole the flow exists to avoid.
 * Layer: api.
 */

import { controller, type ModuleController } from '../../core/http/controller';
import type { AppService } from '../application/app-service';

export interface AppsControllerDeps {
  readonly apps: AppService;
}

export function appsController(deps: AppsControllerDeps): ModuleController {
  return controller('apps', [
    {
      method: 'GET',
      path: '/installations',
      permission: 'store.apps.manage',
      async handle({ storeId }) {
        const entries = await deps.apps.installedOn(storeId);
        return entries.map(({ installation, appName, appHandle, appStatus, suspendedReason }) => ({
          appStatus,
          // Surfaced so the screen can say the app was stopped by us, rather
          // than showing it as working while every call it makes fails.
          suspendedReason,
          id: installation.id,
          appId: installation.appId,
          appName,
          appHandle,
          status: installation.status,
          grantedScopes: installation.grantedScopes,
          // Resolved to labels here rather than in the screen: what a scope
          // actually opens is knowledge the manifests hold, and a merchant
          // reading "read_customers" has not been told anything.
          scopeDetail: deps.apps.describeScopes(installation.grantedScopes).map((scope) => ({
            key: scope.key,
            label: scope.label,
            description: scope.description,
            feature: scope.feature,
            access: scope.access,
            restricted: scope.restricted,
          })),
          installedAt: installation.installedAt.toISOString(),
          uninstalledAt: installation.uninstalledAt?.toISOString() ?? null,
        }));
      },
    },

    {
      method: 'DELETE',
      path: '/installations/:appId',
      permission: 'store.apps.manage',
      /**
       * Removes an app and kills its tokens in the same call — see the service.
       * An uninstall that leaves tokens working is not an uninstall.
       */
      async handle({ storeId, params }) {
        await deps.apps.uninstall(params.appId as string, storeId);
        return { appId: params.appId, uninstalled: true };
      },
    },
  ]);
}
