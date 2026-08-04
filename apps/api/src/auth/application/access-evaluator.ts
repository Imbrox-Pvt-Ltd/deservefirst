/**
 * Auth · application/access-evaluator.ts
 * ONE effective access decision, applied in a fixed order. Every store action
 * runs through this; no module may rely on its own permission logic alone.
 *
 * The order is not arbitrary, and the precedence rules are adopted from the
 * frozen contracts baseline:
 *   1. store boundary   — is this actor even in this store's context
 *   2. actor access     — support sessions carry explicit, wildcard-free lists
 *   3. permission       — does any assigned role grant it
 *   4. module enabled   — a globally disabled module always wins over a store
 *   5. plan entitlement — plan denial always wins over a store enable
 * Layer: application.
 */

import type { RequestContext, StoreId } from '@deservefirst/contracts';

export type DenialReason =
  | 'no-store-context'
  | 'store-mismatch'
  | 'support-session-expired'
  | 'permission-missing'
  | 'module-disabled'
  | 'not-entitled'
  | 'approval-required';

export interface AccessDecision {
  readonly allowed: boolean;
  readonly reason: DenialReason | null;
  readonly detail: string | null;
  /** Set when the action is permitted but needs a second authorised actor. */
  readonly requiresApproval: boolean;
}

const ALLOW: AccessDecision = { allowed: true, reason: null, detail: null, requiresApproval: false };

const deny = (reason: DenialReason, detail: string): AccessDecision => ({
  allowed: false,
  reason,
  detail,
  requiresApproval: false,
});

export interface AccessRequest {
  readonly context: RequestContext;
  readonly permission: string;
  /** The store the action targets, when it differs from the ambient context. */
  readonly targetStoreId?: StoreId;
  readonly moduleId?: string;
}

export interface AccessPorts {
  isModuleEnabledGlobally(moduleId: string): boolean;
  isModuleEnabledForStore(storeId: StoreId, moduleId: string): Promise<boolean>;
  isEntitled(storeId: StoreId, moduleId: string): Promise<boolean>;
  permissionRequiresApproval(permission: string): boolean;
  supportSessionValid(sessionId: string, now: Date): Promise<boolean>;
}

export class AccessEvaluator {
  constructor(
    private readonly ports: AccessPorts,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluate(request: AccessRequest): Promise<AccessDecision> {
    const { context, permission } = request;

    // 1. Store boundary. Organization membership alone never grants store data
    //    access — a store context must be active.
    const storeId = request.targetStoreId ?? context.storeId;
    if (storeId === null) {
      return deny('no-store-context', 'This action is store-scoped and no store context is active.');
    }
    if (context.storeId !== null && storeId !== context.storeId) {
      return deny(
        'store-mismatch',
        `Action targets store "${storeId}" but the request is scoped to "${context.storeId}".`,
      );
    }

    // 2. Support access is time-bound and enumerated. A stale session is not a
    //    reduced-permission session; it is no session.
    if (context.supportSessionId !== null) {
      const valid = await this.ports.supportSessionValid(context.supportSessionId, this.now());
      if (!valid) {
        return deny('support-session-expired', 'The support session has expired or been revoked.');
      }
      if (!context.permissions.includes(permission)) {
        return deny(
          'permission-missing',
          'Support access carries an explicit permission list and does not include this action.',
        );
      }
    }

    // 3. Permission. Wildcards are deliberately not supported — "*" is how a
    //    support role quietly becomes an admin role.
    if (!context.permissions.includes(permission)) {
      return deny('permission-missing', `No assigned role grants "${permission}".`);
    }

    if (request.moduleId) {
      // 4. Global disable beats a store enable, always.
      if (!this.ports.isModuleEnabledGlobally(request.moduleId)) {
        return deny('module-disabled', `Module "${request.moduleId}" is disabled platform-wide.`);
      }
      if (!(await this.ports.isModuleEnabledForStore(storeId, request.moduleId))) {
        return deny('module-disabled', `Module "${request.moduleId}" is not enabled for this store.`);
      }

      // 5. Plan denial beats a store enable, always.
      if (!(await this.ports.isEntitled(storeId, request.moduleId))) {
        return deny('not-entitled', `This store's plan does not include "${request.moduleId}".`);
      }
    }

    if (this.ports.permissionRequiresApproval(permission)) {
      return { allowed: true, reason: null, detail: null, requiresApproval: true };
    }

    return ALLOW;
  }

  /** Throws instead of returning — the shape most call sites want. */
  async assert(request: AccessRequest): Promise<AccessDecision> {
    const decision = await this.evaluate(request);
    if (!decision.allowed) {
      throw new AccessDeniedError(request.permission, decision);
    }
    return decision;
  }
}

export class AccessDeniedError extends Error {
  readonly status: number;
  constructor(
    readonly permission: string,
    readonly decision: AccessDecision,
  ) {
    super(decision.detail ?? `Access denied for "${permission}".`);
    this.name = 'AccessDeniedError';
    // Entitlement failures are a billing problem, not an authorisation one, and
    // the client should be able to tell the difference without parsing a string.
    this.status = decision.reason === 'not-entitled' ? 402 : 403;
  }
}
