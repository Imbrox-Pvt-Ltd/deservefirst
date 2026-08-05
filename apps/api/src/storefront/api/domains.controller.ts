/**
 * Storefront · api/domains.controller.ts
 * Connecting, checking and choosing a store's hostnames.
 *
 * Five endpoints, all of them writes or actions — reading the list is here too,
 * and deliberately not left to the generic resource surface, because a domain
 * is never useful without the DNS records that go with it. A merchant looking
 * at `store_domains` rows learns a token and nothing about what to do with it;
 * `list` returns each domain beside the exact records to paste at a registrar.
 *
 * Every route needs `store.domains.manage`, which the storefront module owns
 * rather than borrowing the general settings permission. Connecting a hostname
 * decides where every customer of this store lands, and disconnecting the
 * primary one moves the whole shop — staff who may change a shipping rate
 * should not inherit that by accident.
 * Layer: api.
 */

import { controller, type ModuleController, type RouteRequest } from '../../core/http/controller';
import type { DomainService } from '../application/domain-service';
import { DomainError } from '../application/domain-service';

export interface DomainServices {
  domains(): DomainService;
}

/**
 * A domain as the admin shows it.
 *
 * The verification token appears only inside `records`, where it is part of an
 * instruction. On its own it is a value nobody can act on.
 */
const present = (entry: Awaited<ReturnType<DomainService['list']>>[number]) => ({
  id: entry.domain.id,
  host: entry.domain.host,
  role: entry.domain.role,
  status: entry.domain.status,
  verifiedAt: entry.domain.verifiedAt,
  records: entry.records,
});

/**
 * Turns a refusal into the status code it deserves.
 *
 * Without this every one of these is a 500, and a merchant typing a domain they
 * already own gets "something went wrong" instead of "you already have that".
 */
function asHttp(error: unknown): never {
  if (error instanceof DomainError) {
    const status = {
      invalid: 422,
      taken: 409,
      not_found: 404,
      not_verified: 422,
      last_primary: 422,
    }[error.code];
    throw Object.assign(new Error(error.message), { statusCode: status });
  }
  throw error;
}

export function domainsController(services: DomainServices): ModuleController {
  return controller('storefront', [
    {
      method: 'GET',
      path: '/domains',
      permission: 'store.domains.manage',
      handle: async () => {
        const entries = await services.domains().list();
        return { domains: entries.map(present) };
      },
    },
    {
      method: 'POST',
      path: '/domains',
      permission: 'store.domains.manage',
      handle: async (request: RouteRequest) => {
        try {
          const entry = await services.domains().connect(String(request.body.host ?? ''));
          return present(entry);
        } catch (error) {
          asHttp(error);
        }
      },
    },
    {
      /**
       * Checks DNS and records what it found.
       *
       * A POST rather than a GET despite reading nothing of ours: it performs
       * live network lookups and writes a status, so it is neither safe nor
       * something a proxy should ever repeat on its own.
       */
      method: 'POST',
      path: '/domains/:id/verify',
      permission: 'store.domains.manage',
      handle: async (request: RouteRequest) => {
        try {
          const { domain, result } = await services.domains().verify(request.params.id as string);
          return {
            id: domain.id,
            host: domain.host,
            status: domain.status,
            owns: result.owns,
            reachesUs: result.reachesUs,
            message: result.message,
          };
        } catch (error) {
          asHttp(error);
        }
      },
    },
    {
      method: 'POST',
      path: '/domains/:id/primary',
      permission: 'store.domains.manage',
      handle: async (request: RouteRequest) => {
        try {
          await services.domains().makePrimary(request.params.id as string);
          return { ok: true };
        } catch (error) {
          asHttp(error);
        }
      },
    },
    {
      method: 'DELETE',
      path: '/domains/:id',
      permission: 'store.domains.manage',
      handle: async (request: RouteRequest) => {
        try {
          await services.domains().disconnect(request.params.id as string);
          return { ok: true };
        } catch (error) {
          asHttp(error);
        }
      },
    },
  ]);
}
