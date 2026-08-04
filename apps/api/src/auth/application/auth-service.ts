/**
 * Auth · application/auth-service.ts
 * The core auth flows (§4.5): signup, the rid-correlated login chain, refresh,
 * store switching and sign-out. Transport-agnostic — the same code serves REST,
 * GraphQL and any future surface (§13.1).
 * Layer: application.
 */

import type { OrganizationId, StoreId, UserId } from '@deservefirst/contracts';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  assertFlowUsable,
  assertStepTransition,
  assertValidEmail,
  buildClaims,
  checkPasswordPolicy,
  describeDevice,
  generateRequestId,
  generateToken,
  hashPassword,
  hashToken,
  IdentityRuleError,
  isExpired,
  LOGIN_FLOW_TTL_SECONDS,
  LoginFlowError,
  type AccessTokenClaims,
  type LoginFlow,
  type LoginStep,
  type Membership,
  type Session,
  type Store,
  type User,
  needsRehash,
  normalizeEmail,
  REFRESH_TOKEN_TTL_SECONDS,
  redeemRecoveryCode,
  sanitizeReturnPath,
  tokensMatch,
  verifyPassword,
  verifyTotp,
} from '../domain';

export interface IdentityRepository {
  findUserByEmail(email: string): Promise<(User & { passwordHash: string | null }) | null>;
  findUserById(id: UserId): Promise<User | null>;
  createUser(user: User, passwordHash: string): Promise<User>;
  updatePasswordHash(userId: UserId, passwordHash: string): Promise<void>;
  membershipsFor(userId: UserId): Promise<readonly (Membership & { store: Store })[]>;
  permissionsFor(userId: UserId, storeId: StoreId): Promise<readonly string[]>;
  roleKeysFor(userId: UserId, storeId: StoreId): Promise<readonly string[]>;
  mfaSecretFor(userId: UserId): Promise<string | null>;
  recoveryCodeHashesFor(userId: UserId): Promise<readonly string[]>;
  replaceRecoveryCodes(userId: UserId, hashes: readonly string[]): Promise<void>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  findByRefreshHash(hash: string): Promise<Session | null>;
  listForUser(userId: UserId): Promise<readonly Session[]>;
  rotate(sessionId: string, refreshTokenHash: string, expiresAt: Date): Promise<void>;
  rescope(sessionId: string, storeId: StoreId, organizationId: OrganizationId): Promise<void>;
  revoke(sessionId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: UserId, at: Date, exceptSessionId?: string): Promise<number>;
  touch(sessionId: string, at: Date): Promise<void>;
}

export interface LoginFlowRepository {
  create(flow: LoginFlow): Promise<void>;
  find(rid: string): Promise<LoginFlow | null>;
  update(flow: LoginFlow): Promise<void>;
  recordAttempt(rid: string): Promise<void>;
}

export interface AuthPorts {
  newId(): string;
  now(): Date;
  signAccessToken(claims: AccessTokenClaims): Promise<string>;
  entitlementsHashFor(storeId: StoreId): Promise<string | null>;
  emit(eventType: string, payload: Record<string, unknown>): Promise<void>;
  audit(event: {
    action: string;
    userId: UserId | null;
    storeId: StoreId | null;
    severity: 'info' | 'warning' | 'critical';
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface DeviceInfo {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

export class AuthenticationError extends Error {
  readonly status = 401;
  constructor(detail: string) {
    super(detail);
    this.name = 'AuthenticationError';
  }
}

export class AuthService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly sessions: SessionRepository,
    private readonly flows: LoginFlowRepository,
    private readonly ports: AuthPorts,
  ) {}

  // --- signup ---------------------------------------------------------------

  async signup(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    locale?: string;
    timeZone?: string;
  }): Promise<User> {
    const email = normalizeEmail(input.email);
    assertValidEmail(email);

    const policy = checkPasswordPolicy(input.password, { email });
    if (!policy.ok) {
      throw new IdentityRuleError('password', policy.problems.join('; '));
    }

    // Uniqueness is also enforced by a unique index; this check exists to give a
    // clear message rather than a constraint violation.
    if (await this.identity.findUserByEmail(email)) {
      throw new IdentityRuleError('email', 'is already registered');
    }

    const user: User = {
      id: this.ports.newId() as UserId,
      email,
      emailVerifiedAt: null,
      secondaryEmail: null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      status: 'active',
      mfaEnabled: false,
      providerRef: null,
      locale: input.locale ?? 'en-US',
      timeZone: input.timeZone ?? 'UTC',
      createdAt: this.ports.now(),
    };

    const created = await this.identity.createUser(user, await hashPassword(input.password));
    await this.ports.emit('auth.user.created', { userId: created.id, email: created.email });
    return created;
  }

  // --- login chain ----------------------------------------------------------

  /** Step 1. Opens a flow and returns its `rid`; every later step carries it. */
  async beginLogin(input: { email?: string; returnPath?: string | null }): Promise<LoginFlow> {
    const now = this.ports.now();
    const flow: LoginFlow = {
      rid: generateRequestId(),
      step: 'lookup',
      email: input.email ? normalizeEmail(input.email) : null,
      userId: null,
      returnPath: sanitizeReturnPath(input.returnPath),
      attempts: 0,
      startedAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_FLOW_TTL_SECONDS * 1000),
    };
    await this.flows.create(flow);
    return flow;
  }

  /**
   * Step 2. Verifies the password and decides what comes next.
   *
   * The response deliberately does not distinguish "no such user" from "wrong
   * password": either would let an attacker enumerate registered addresses.
   */
  async submitPassword(input: {
    rid: string;
    email: string;
    password: string;
  }): Promise<{ next: LoginStep; flow: LoginFlow }> {
    const flow = await this.requireFlow(input.rid);
    assertStepTransition(flow.step, 'password', flow.rid);

    const email = normalizeEmail(input.email);
    const user = await this.identity.findUserByEmail(email);

    const passwordOk =
      user?.passwordHash != null && (await verifyPassword(input.password, user.passwordHash));

    if (!user || !passwordOk) {
      await this.flows.recordAttempt(flow.rid);
      await this.ports.audit({
        action: 'auth.login.failed',
        userId: user?.id ?? null,
        storeId: null,
        severity: 'warning',
        metadata: { rid: flow.rid, email },
      });
      throw new AuthenticationError('Incorrect email or password.');
    }

    if (user.status !== 'active') {
      throw new AuthenticationError('This account is not active.');
    }

    // Transparently upgrade a hash made with older cost parameters.
    if (needsRehash(user.passwordHash!)) {
      await this.identity.updatePasswordHash(user.id, await hashPassword(input.password));
    }

    const next: LoginStep = user.mfaEnabled ? 'mfa' : 'store-select';
    const updated: LoginFlow = { ...flow, step: 'password', email, userId: user.id };
    await this.flows.update(updated);
    return { next, flow: updated };
  }

  /** Step 3. TOTP, or a recovery code when the device is lost. */
  async submitMfa(input: { rid: string; code: string; useRecoveryCode?: boolean }): Promise<LoginFlow> {
    const flow = await this.requireFlow(input.rid);
    assertStepTransition(flow.step, 'mfa', flow.rid);
    if (!flow.userId) throw new LoginFlowError(flow.rid, 'has no authenticated user yet');

    const accepted = input.useRecoveryCode
      ? await this.redeemRecovery(flow.userId, input.code)
      : verifyTotp((await this.identity.mfaSecretFor(flow.userId)) ?? '', input.code, this.ports.now().getTime());

    if (!accepted) {
      await this.flows.recordAttempt(flow.rid);
      await this.ports.audit({
        action: 'auth.mfa.failed',
        userId: flow.userId,
        storeId: null,
        severity: 'warning',
        metadata: { rid: flow.rid },
      });
      throw new AuthenticationError('That verification code is not valid.');
    }

    const updated: LoginFlow = { ...flow, step: 'mfa' };
    await this.flows.update(updated);
    return updated;
  }

  private async redeemRecovery(userId: UserId, code: string): Promise<boolean> {
    const stored = await this.identity.recoveryCodeHashesFor(userId);
    const result = redeemRecoveryCode(code, stored);
    if (!result.redeemed) return false;
    // Burn it: a single-use code that survives redemption is not single-use.
    await this.identity.replaceRecoveryCodes(userId, result.remaining);
    await this.ports.audit({
      action: 'auth.recovery_code.redeemed',
      userId,
      storeId: null,
      severity: 'warning',
      metadata: { remaining: result.remaining.length },
    });
    return true;
  }

  /** Step 4. Completes the flow and issues tokens, scoped to a chosen store. */
  async completeLogin(input: {
    rid: string;
    storeId?: StoreId;
    device: DeviceInfo;
  }): Promise<{ tokens: TokenPair; session: Session; returnPath: string | null }> {
    const flow = await this.requireFlow(input.rid);
    assertStepTransition(flow.step, 'complete', flow.rid);
    if (!flow.userId) throw new LoginFlowError(flow.rid, 'has no authenticated user yet');

    const memberships = await this.identity.membershipsFor(flow.userId);
    const active = memberships.filter((membership) => membership.status === 'active');

    let storeId: StoreId | null = null;
    let organizationId: OrganizationId | null = null;

    if (input.storeId) {
      const chosen = active.find((membership) => membership.storeId === input.storeId);
      if (!chosen) {
        // Not a 403: revealing that the store exists but is not theirs is itself
        // a disclosure.
        throw new AuthenticationError('No access to that store.');
      }
      storeId = chosen.storeId;
      organizationId = chosen.organizationId;
    } else if (active.length === 1) {
      // One store means no picker — go straight in (§8.4.3).
      storeId = active[0]!.storeId;
      organizationId = active[0]!.organizationId;
    }

    const session = await this.issueSession(flow.userId, storeId, organizationId, input.device);
    const tokens = await this.issueTokens(session, flow.userId, storeId);

    await this.flows.update({ ...flow, step: 'complete' });
    await this.ports.audit({
      action: 'auth.login.succeeded',
      userId: flow.userId,
      storeId,
      severity: 'info',
      metadata: { rid: flow.rid, sessionId: session.id },
    });

    return { tokens, session, returnPath: flow.returnPath };
  }

  // --- session lifecycle ----------------------------------------------------

  private async issueSession(
    userId: UserId,
    storeId: StoreId | null,
    organizationId: OrganizationId | null,
    device: DeviceInfo,
  ): Promise<Session> {
    const now = this.ports.now();
    const refreshToken = generateToken();

    const session: Session = {
      id: this.ports.newId(),
      userId,
      storeId,
      organizationId,
      refreshTokenHash: hashToken(refreshToken),
      deviceLabel: describeDevice(device.userAgent),
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      revokedAt: null,
    };

    const created = await this.sessions.create(session);
    // The plaintext token never leaves this method except through issueTokens;
    // what we stored is only its hash.
    return { ...created, refreshTokenHash: refreshToken };
  }

  private async issueTokens(
    session: Session,
    userId: UserId,
    storeId: StoreId | null,
  ): Promise<TokenPair> {
    const roles = storeId ? await this.identity.roleKeysFor(userId, storeId) : [];
    const entitlementsHash = storeId ? await this.ports.entitlementsHashFor(storeId) : null;

    const claims = buildClaims({
      session: { ...session, refreshTokenHash: '' },
      roles,
      entitlementsHash,
      now: this.ports.now(),
    });

    return {
      accessToken: await this.ports.signAccessToken(claims),
      // issueSession swaps the hash field for the plaintext on the way out.
      refreshToken: session.refreshTokenHash,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Rotates on every use: a refresh token is never valid twice. */
  async refresh(input: { refreshToken: string; device: DeviceInfo }): Promise<TokenPair> {
    const session = await this.sessions.findByRefreshHash(hashToken(input.refreshToken));
    if (!session) throw new AuthenticationError('That session is no longer valid.');

    const now = this.ports.now();
    if (isExpired(session, now)) {
      throw new AuthenticationError('That session has expired.');
    }
    if (!tokensMatch(input.refreshToken, session.refreshTokenHash)) {
      // Reaching here means the lookup matched but the compare did not — treat
      // it as tampering and kill the session rather than just refusing.
      await this.sessions.revoke(session.id, now);
      await this.ports.audit({
        action: 'auth.refresh.mismatch',
        userId: session.userId,
        storeId: session.storeId,
        severity: 'critical',
        metadata: { sessionId: session.id },
      });
      throw new AuthenticationError('That session is no longer valid.');
    }

    const nextRefresh = generateToken();
    await this.sessions.rotate(
      session.id,
      hashToken(nextRefresh),
      new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    );
    await this.sessions.touch(session.id, now);

    return this.issueTokens({ ...session, refreshTokenHash: nextRefresh }, session.userId, session.storeId);
  }

  /**
   * Switching store rescopes the existing session rather than issuing a new one,
   * so the device list does not grow an entry every time a merchant changes shop.
   */
  async switchStore(input: { sessionId: string; storeId: StoreId }): Promise<TokenPair> {
    const session = await this.sessions.findById(input.sessionId);
    if (!session || isExpired(session, this.ports.now())) {
      throw new AuthenticationError('That session is no longer valid.');
    }

    const memberships = await this.identity.membershipsFor(session.userId);
    const target = memberships.find(
      (membership) => membership.storeId === input.storeId && membership.status === 'active',
    );
    if (!target) throw new AuthenticationError('No access to that store.');

    await this.sessions.rescope(session.id, target.storeId, target.organizationId);
    return this.issueTokens(
      { ...session, storeId: target.storeId, organizationId: target.organizationId },
      session.userId,
      target.storeId,
    );
  }

  async signOut(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, this.ports.now());
  }

  /** "Sign out everywhere", keeping the current device signed in. */
  async signOutOthers(userId: UserId, keepSessionId: string): Promise<number> {
    const revoked = await this.sessions.revokeAllForUser(userId, this.ports.now(), keepSessionId);
    await this.ports.audit({
      action: 'auth.sessions.revoked_others',
      userId,
      storeId: null,
      severity: 'warning',
      metadata: { revoked },
    });
    return revoked;
  }

  async listSessions(userId: UserId): Promise<readonly Session[]> {
    return this.sessions.listForUser(userId);
  }

  private async requireFlow(rid: string): Promise<LoginFlow> {
    const flow = await this.flows.find(rid);
    if (!flow) throw new LoginFlowError(rid, 'was not found');
    assertFlowUsable(flow, this.ports.now());
    return flow;
  }
}
