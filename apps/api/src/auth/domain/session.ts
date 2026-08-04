/**
 * Auth · domain/session.ts
 * Session and token rules (§4.4). Access tokens are short-lived and verified
 * statelessly so the hot path never touches the database; refresh tokens are
 * opaque, stored hashed, and rotated on every use.
 * Layer: domain (pure).
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

/** Short enough that a stolen token's blast radius is minutes, not days. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A login attempt must complete within this window before its `rid` expires. */
export const LOGIN_FLOW_TTL_SECONDS = 10 * 60;

export interface Session {
  readonly id: string;
  readonly userId: UserId;
  /** The store this session is currently scoped to; switching stores rescopes it. */
  readonly storeId: StoreId | null;
  readonly organizationId: OrganizationId | null;
  readonly refreshTokenHash: string;
  readonly deviceLabel: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface AccessTokenClaims {
  readonly sub: UserId;
  readonly sid: string;
  readonly storeId: StoreId | null;
  readonly organizationId: OrganizationId | null;
  readonly roles: readonly string[];
  /** Lets the gateway short-circuit entitlement checks without a lookup (§4.4). */
  readonly entitlementsHash: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function isExpired(session: Pick<Session, 'expiresAt' | 'revokedAt'>, now: Date): boolean {
  if (session.revokedAt !== null) return true;
  return session.expiresAt.getTime() <= now.getTime();
}

export function buildClaims(input: {
  session: Session;
  roles: readonly string[];
  entitlementsHash: string | null;
  now: Date;
}): AccessTokenClaims {
  const issuedAt = Math.floor(input.now.getTime() / 1000);
  return {
    sub: input.session.userId,
    sid: input.session.id,
    storeId: input.session.storeId,
    organizationId: input.session.organizationId,
    roles: input.roles,
    entitlementsHash: input.entitlementsHash,
    issuedAt,
    expiresAt: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * The multi-step login flow (§4.5). `rid` correlates every step, so a partial
 * attempt is resumable, auditable, and cannot be spliced with another attempt.
 */
export type LoginStep = 'lookup' | 'password' | 'mfa' | 'store-select' | 'complete';

export interface LoginFlow {
  readonly rid: string;
  readonly step: LoginStep;
  readonly email: string | null;
  readonly userId: UserId | null;
  /** Where to land once the flow completes; round-tripped from ?returnPath. */
  readonly returnPath: string | null;
  readonly attempts: number;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

export const MAX_LOGIN_ATTEMPTS = 5;

export class LoginFlowError extends Error {
  readonly status = 400;
  constructor(
    readonly rid: string,
    detail: string,
  ) {
    super(`Login flow ${rid}: ${detail}`);
    this.name = 'LoginFlowError';
  }
}

export function assertFlowUsable(flow: LoginFlow, now: Date): void {
  if (flow.expiresAt.getTime() <= now.getTime()) {
    throw new LoginFlowError(flow.rid, 'has expired — start again');
  }
  if (flow.attempts >= MAX_LOGIN_ATTEMPTS) {
    throw new LoginFlowError(flow.rid, 'has too many failed attempts');
  }
}

const ALLOWED_STEPS: Readonly<Record<LoginStep, readonly LoginStep[]>> = {
  lookup: ['password'],
  password: ['mfa', 'store-select', 'complete'],
  mfa: ['store-select', 'complete'],
  'store-select': ['complete'],
  complete: [],
};

/**
 * A flow may only move forward along a declared path. Without this, a client
 * could post straight to the completion step and skip the MFA challenge.
 */
export function assertStepTransition(from: LoginStep, to: LoginStep, rid: string): void {
  if (!ALLOWED_STEPS[from].includes(to)) {
    throw new LoginFlowError(rid, `cannot move from ${from} to ${to}`);
  }
}

/**
 * Only same-origin, absolute paths may be returned to. An open redirect here
 * would let a phishing link bounce a freshly authenticated user off-site.
 */
export function sanitizeReturnPath(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  // "//evil.example" and "/\evil.example" are protocol-relative URLs, not paths.
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  if (/[\r\n]/.test(decoded)) return null;
  return decoded;
}

/** A human-readable device label for the sessions screen. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Firefox\/[\d.]+/.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const platform = /Macintosh|Mac OS X/.test(userAgent)
    ? 'macOS'
    : /Windows/.test(userAgent)
      ? 'Windows'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${platform}`;
}
