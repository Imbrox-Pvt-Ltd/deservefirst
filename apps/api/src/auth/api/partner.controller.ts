/**
 * Auth · api/partner.controller.ts
 * The merchant's half of the partner gate.
 *
 * Only the store-scoped side lives here, because only the store-scoped side can:
 * every route mounted this way runs inside a store's context and is authorised
 * against that store. The partner's own routes — listing its clients, asking for
 * access — belong to no store at all and are mounted separately on the platform
 * surface, where a partner-scoped context is what identifies the caller.
 *
 * Splitting them is not tidiness. A route that answers "which partners may work
 * here" must be answerable by the merchant and nobody else, and putting it on
 * the same surface as the partner's own routes is how that gets confused.
 * Layer: api.
 */

import { controller, type ModuleController } from '../../core/http/controller';
import type { PartnerService } from '../application/partner-service';

export interface PartnerControllerDeps {
  readonly partners: PartnerService;
  /** Store permissions a merchant may hand to a partner, from the manifests. */
  readonly grantablePermissions: () => readonly { key: string; label: string }[];
}

export function partnerController(deps: PartnerControllerDeps): ModuleController {
  return controller('auth', [
    {
      method: 'GET',
      path: '/partner-access',
      // The merchant's own permission, not one of the partner's. Reading who has
      // keys to your store is a store concern.
      permission: 'store.partners.manage',
      async handle({ storeId }) {
        const entries = await deps.partners.partnersForStore(storeId);
        return entries.map(({ partnerId, partnerName, link }) => ({
          id: link.id,
          partnerId,
          partnerName,
          status: link.status,
          accessLevel: link.accessLevel,
          permissions: link.permissions,
          createdByPartner: link.createdByPartner,
          requestedAt: link.requestedAt.toISOString(),
          decidedAt: link.decidedAt?.toISOString() ?? null,
          revokedReason: link.revokedReason,
        }));
      },
    },

    {
      method: 'GET',
      path: '/grantable-permissions',
      permission: 'store.partners.manage',
      /**
       * What the merchant can choose from when narrowing a partner's access.
       *
       * Read off the registry rather than written down in the screen, so a
       * permission a module adds is offerable the day it exists — the
       * alternative is a checkbox list that quietly falls behind the platform.
       */
      async handle() {
        return deps.grantablePermissions();
      },
    },

    {
      method: 'POST',
      path: '/partner-access/:id/decide',
      permission: 'store.partners.manage',
      /**
       * Approve, narrow, or remove.
       *
       * The level comes from the body — the merchant's answer — and not from
       * what the partner asked for. A partner requesting `full` and being given
       * `limited` is the normal case, not an error.
       */
      async handle({ storeId, params, body }) {
        const link = await deps.partners.decideStoreAccess(storeId, params.id as string, {
          grant: body.grant === true,
          accessLevel: body.accessLevel as 'full' | 'limited' | undefined,
          permissions: Array.isArray(body.permissions) ? (body.permissions as string[]) : undefined,
          reason: typeof body.reason === 'string' ? body.reason : undefined,
        });

        return {
          id: link.id,
          status: link.status,
          accessLevel: link.accessLevel,
          permissions: link.permissions,
          decidedAt: link.decidedAt?.toISOString() ?? null,
          revokedReason: link.revokedReason,
        };
      },
    },
  ]);
}
