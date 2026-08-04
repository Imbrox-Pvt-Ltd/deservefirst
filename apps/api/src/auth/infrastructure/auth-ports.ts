/**
 * Auth · infrastructure/auth-ports.ts
 * The side of authentication that touches the outside world: signing tokens,
 * emitting events, and recording who did what.
 *
 * The session cookie is a signed reference, not a bearer of claims. It carries a
 * session id and an HMAC of that id, and everything else — which store, which
 * permissions — is looked up server-side on each request. A cookie that carried
 * the claims themselves would let a revoked session keep working until it
 * expired, and "sign out everywhere" has to mean it.
 * Layer: infrastructure.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { StoreId, UserId } from '@deservefirst/contracts';

import type { EventBus } from '../../core/event-bus/event-bus';
import type { AccessTokenClaims } from '../domain';
import type { AuthPorts } from '../application';

export interface AuthPortsOptions {
  readonly secret: string;
  readonly events: EventBus;
  readonly entitlementsHashFor: (storeId: StoreId) => Promise<string | null>;
  readonly now?: () => Date;
}

const base64url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Compares two signatures without leaking their difference through timing.
 *
 * A plain `===` on a signature is the textbook side channel: it returns as soon
 * as two bytes differ, which is enough to recover a valid one a byte at a time.
 */
export function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** `sid.signature` — what the browser holds. */
export function sealSessionId(secret: string, sessionId: string): string {
  return `${sessionId}.${sign(secret, sessionId)}`;
}

/** The session id, or null when the cookie was not issued by us. */
export function openSessionCookie(secret: string, cookie: string | null): string | null {
  if (!cookie) return null;
  const separator = cookie.lastIndexOf('.');
  if (separator <= 0) return null;

  const sessionId = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);
  return signaturesMatch(sign(secret, sessionId), signature) ? sessionId : null;
}

export function createAuthPorts(options: AuthPortsOptions): AuthPorts {
  const now = options.now ?? (() => new Date());

  return {
    newId: () => randomUUID(),
    now,

    /**
     * A compact signed token for API clients.
     *
     * Deliberately not a full JWT yet: nothing consumes one, and shipping a
     * token format before there is a consumer means shipping a format nobody
     * has validated against a real client. The shape — payload plus HMAC — is
     * the part that has to be right now.
     */
    async signAccessToken(claims: AccessTokenClaims): Promise<string> {
      const payload = base64url(JSON.stringify(claims));
      return `${payload}.${sign(options.secret, payload)}`;
    },

    entitlementsHashFor: options.entitlementsHashFor,

    async emit(eventType, payload) {
      await options.events.emit(eventType, payload);
    },

    /**
     * Security events go onto the bus rather than into a table here.
     *
     * There is no audit store yet, and inventing a private one inside auth is
     * how a platform ends up with three. The event is emitted with everything a
     * real audit sink will need, so wiring one later is a subscriber rather than
     * a change to this code.
     */
    async audit(event) {
      await options.events.emit('auth.audit', {
        action: event.action,
        userId: event.userId,
        storeId: event.storeId,
        severity: event.severity,
        at: now().toISOString(),
        ...event.metadata,
      });

      if (event.severity !== 'info') {
        // eslint-disable-next-line no-console
        console.warn(`[security] ${event.action}`, {
          userId: event.userId,
          storeId: event.storeId,
          ...event.metadata,
        });
      }
    },
  };
}

/** What a resolved session tells the request context. */
export interface SessionIdentity {
  readonly sessionId: string;
  readonly userId: UserId;
  readonly storeId: StoreId | null;
  readonly organizationId: string | null;
  readonly permissions: readonly string[];
  readonly roleKeys: readonly string[];
}
