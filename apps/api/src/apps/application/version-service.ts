/**
 * Apps · application/version-service.ts
 * Drafting and releasing a version of an app.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import { AppRuleError } from '../domain/app';
import {
  assertEditable,
  assertReleasable,
  currentVersion,
  type AppVersion,
} from '../domain/version';
import type { SqlAppRepository } from '../infrastructure/app.repository';

/** The webhook payload shape a new draft starts on: whatever is current. */
export const DEFAULT_WEBHOOK_API_VERSION = '2026-01';

export class AppVersionService {
  constructor(private readonly apps: SqlAppRepository) {}

  async list(appId: string, partnerId: string): Promise<readonly AppVersion[]> {
    await this.assertOwned(appId, partnerId);
    return this.apps.versionsFor(appId);
  }

  private async assertOwned(appId: string, partnerId: string) {
    const app = await this.apps.findApp(appId);
    // Same answer for "not yours" and "does not exist", so a partner cannot
    // enumerate other people's app ids by asking for their versions.
    if (!app || app.partnerId !== partnerId) {
      throw new AppRuleError('appId', 'is not an app you own');
    }
    return app;
  }

  /**
   * A new draft, pre-filled from the last release.
   *
   * Starting from the current version rather than blank is the difference
   * between "change one URL" and "retype everything and hope you did not drop a
   * scope by omission" — and a dropped scope is an install that breaks.
   */
  async draft(
    appId: string,
    partnerId: string,
    input: { name: string; message?: string | null },
  ): Promise<AppVersion> {
    const app = await this.assertOwned(appId, partnerId);
    const previous = currentVersion(await this.apps.versionsFor(appId));

    const version: AppVersion = {
      id: randomUUID(),
      appId,
      name: input.name.trim(),
      message: input.message?.trim() || null,
      status: 'draft',
      scopes: previous ? [...previous.scopes] : [...app.requestedScopes],
      redirectUris: previous ? [...previous.redirectUris] : [...app.redirectUris],
      appUrl: previous ? previous.appUrl : app.appUrl,
      webhookApiVersion: previous ? previous.webhookApiVersion : DEFAULT_WEBHOOK_API_VERSION,
      createdAt: new Date(),
      releasedAt: null,
    };

    await this.apps.insertVersion(version);
    return version;
  }

  async update(
    versionId: string,
    partnerId: string,
    patch: {
      name?: string;
      message?: string | null;
      scopes?: readonly string[];
      redirectUris?: readonly string[];
      appUrl?: string | null;
      webhookApiVersion?: string;
    },
  ): Promise<AppVersion> {
    const version = await this.apps.findVersion(versionId);
    if (!version) throw new AppRuleError('versionId', 'is not a version of an app you own');
    await this.assertOwned(version.appId, partnerId);

    // A released version never changes — merchants consented to this exact list.
    assertEditable(version);

    const next: AppVersion = {
      ...version,
      name: patch.name?.trim() ?? version.name,
      message: patch.message === undefined ? version.message : (patch.message?.trim() || null),
      scopes: patch.scopes ? [...patch.scopes] : version.scopes,
      redirectUris: patch.redirectUris ? [...patch.redirectUris] : version.redirectUris,
      appUrl: patch.appUrl === undefined ? version.appUrl : patch.appUrl,
      webhookApiVersion: patch.webhookApiVersion ?? version.webhookApiVersion,
    };

    await this.apps.saveVersion(next);
    return next;
  }

  /**
   * Releases it. From here it is what merchants install, and it is frozen.
   *
   * Existing installs are NOT moved. They stay on the version they consented
   * to until the merchant is asked again — which is the entire reason versions
   * exist, and the thing that would be undone by a well-meaning migration here.
   */
  async release(versionId: string, partnerId: string): Promise<AppVersion> {
    const version = await this.apps.findVersion(versionId);
    if (!version) throw new AppRuleError('versionId', 'is not a version of an app you own');
    const app = await this.assertOwned(version.appId, partnerId);

    assertReleasable(version, app.requestedScopes);

    const released: AppVersion = { ...version, status: 'released', releasedAt: new Date() };
    await this.apps.saveVersion(released);
    return released;
  }
}
