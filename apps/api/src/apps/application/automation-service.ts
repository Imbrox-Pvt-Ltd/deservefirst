/**
 * Apps · application/automation-service.ts
 * Issuing and resolving CI tokens.
 * Layer: application.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { AppRuleError } from '../domain/app';
import {
  assertTokenValid,
  can,
  isUsable,
  pathIsAutomatable,
  type AutomationCapability,
  type AutomationToken,
} from '../domain/automation-token';
import { digestOf, type SqlAppRepository } from '../infrastructure/app.repository';

export const AUTOMATION_PREFIX = 'dfa_';

export class AutomationService {
  constructor(private readonly apps: SqlAppRepository) {}

  /**
   * Issues one. The secret is returned here and never again.
   *
   * Prefixed so a leaked token is greppable in a CI log and recognisable to a
   * secret scanner before anybody has to look it up.
   */
  async issue(input: {
    appId: string;
    partnerId: string;
    name: string;
    capabilities: readonly AutomationCapability[];
    expiresAt?: Date | null;
  }): Promise<{ token: AutomationToken; secret: string }> {
    const app = await this.apps.findApp(input.appId);
    if (!app || app.partnerId !== input.partnerId) {
      throw new AppRuleError('appId', 'is not an app you own');
    }

    const secret = `${AUTOMATION_PREFIX}${randomBytes(32).toString('base64url')}`;
    const token: AutomationToken = {
      id: randomUUID(),
      appId: input.appId,
      partnerId: input.partnerId,
      name: input.name.trim(),
      tokenHash: digestOf(secret),
      capabilities: [...input.capabilities],
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
    };
    assertTokenValid(token);

    await this.apps.insertAutomationToken(token);
    return { token, secret };
  }

  async listFor(appId: string, partnerId: string): Promise<readonly AutomationToken[]> {
    const app = await this.apps.findApp(appId);
    if (!app || app.partnerId !== partnerId) {
      throw new AppRuleError('appId', 'is not an app you own');
    }
    return this.apps.automationTokensFor(appId);
  }

  async revoke(id: string, appId: string, partnerId: string): Promise<void> {
    const tokens = await this.listFor(appId, partnerId);
    if (!tokens.some((token) => token.id === id)) {
      throw new AppRuleError('tokenId', 'is not a token on this app');
    }
    await this.apps.revokeAutomationToken(id, new Date());
  }

  /**
   * Turns a presented secret back into a token, or null.
   *
   * Records that it was used, so a leaked token being used shows up as a token
   * being used — the only signal anybody gets before the damage.
   */
  async resolve(secret: string): Promise<AutomationToken | null> {
    const token = await this.apps.findAutomationTokenByHash(digestOf(secret));
    if (!token) return null;

    const usable = isUsable(token, new Date());
    if (!usable.ok) return null;

    await this.apps.touchAutomationToken(token.id, new Date());
    return token;
  }

  /** Both gates: the path is automatable at all, and this token may do it. */
  allows(token: AutomationToken, pathname: string, capability: AutomationCapability): boolean {
    return pathIsAutomatable(pathname) && can(token, capability);
  }
}
