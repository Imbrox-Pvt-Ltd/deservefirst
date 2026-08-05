/**
 * Functions · application/registry.ts
 * Deploying a function, and running whatever is deployed at a point.
 * Layer: application.
 */

import { randomUUID } from 'node:crypto';

import type { StoreId } from '@deservefirst/contracts';

import {
  DEFAULT_LIMITS,
  FunctionRuleError,
  assertLimitsValid,
  isAuthorFault,
  type ResourceLimits,
  type RunResult,
} from '../domain/limits';
import { inspect, run } from '../infrastructure/runner';

export interface FunctionDeployment {
  readonly id: string;
  readonly appId: string;
  readonly point: string;
  readonly name: string;
  readonly wasmBase64: string;
  readonly timeoutMs: number;
  readonly memoryPages: number;
  readonly status: 'active' | 'disabled';
  readonly disabledReason: string | null;
}

/** What a validation-style point gets back. */
export interface PointVerdict {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
  readonly ran: number;
  readonly failed: number;
}

export interface RegistryPorts {
  readonly deployments: {
    forPoint(point: string): Promise<readonly FunctionDeployment[]>;
    forApp(appId: string): Promise<readonly FunctionDeployment[]>;
    insert(deployment: FunctionDeployment): Promise<void>;
    save(deployment: FunctionDeployment): Promise<void>;
  };
  /** Which apps are installed on this store, so only those run. */
  readonly installedAppIds: (storeId: StoreId) => Promise<readonly string[]>;
  /** How a point behaves when a function breaks — declared by the module. */
  readonly failureModeFor: (point: string) => 'allow' | 'deny';
  readonly publish: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
}

export class FunctionRegistry {
  constructor(private readonly ports: RegistryPorts) {}

  /**
   * Deploys a module, refusing it if the tier cannot run it safely.
   *
   * Inspection happens here rather than at first run, so an author finds out
   * their module imports a filesystem while they are looking at the deploy
   * screen — not weeks later inside a merchant's checkout.
   */
  async deploy(input: {
    appId: string;
    point: string;
    name: string;
    wasm: Uint8Array;
    limits?: Partial<ResourceLimits>;
  }): Promise<FunctionDeployment> {
    const limits: ResourceLimits = { ...DEFAULT_LIMITS, ...input.limits };
    assertLimitsValid(limits);

    // Compiles and reads the import and export tables. Runs no guest code.
    await inspect(input.wasm);

    const deployment: FunctionDeployment = {
      id: randomUUID(),
      appId: input.appId,
      point: input.point,
      name: input.name.trim(),
      wasmBase64: Buffer.from(input.wasm).toString('base64'),
      timeoutMs: limits.timeoutMs,
      memoryPages: limits.memoryPages,
      status: 'active',
      disabledReason: null,
    };

    await this.ports.deployments.insert(deployment);
    await this.ports.publish({
      type: 'functions.deployment.created',
      payload: { deploymentId: deployment.id, appId: input.appId, point: input.point },
    });
    return deployment;
  }

  async forApp(appId: string): Promise<readonly FunctionDeployment[]> {
    return this.ports.deployments.forApp(appId);
  }

  /**
   * Runs every function deployed at a point for this store, and combines them.
   *
   * Sequentially rather than in parallel: each one costs up to its own timeout,
   * and running ten at once on a request path is how the tier becomes the
   * reason a page is slow. If that ever needs to change it should change with a
   * cap on concurrency, not by removing the loop.
   */
  async runPoint(point: string, storeId: StoreId, input: unknown): Promise<PointVerdict> {
    const installed = new Set(await this.ports.installedAppIds(storeId));
    const deployments = (await this.ports.deployments.forPoint(point)).filter(
      (deployment) => deployment.status === 'active' && installed.has(deployment.appId),
    );

    if (deployments.length === 0) return { allowed: true, reasons: [], ran: 0, failed: 0 };

    const failureMode = this.ports.failureModeFor(point);
    const payload = JSON.stringify(input);
    const reasons: string[] = [];
    let failed = 0;

    for (const deployment of deployments) {
      const result = await run(Buffer.from(deployment.wasmBase64, 'base64'), payload, {
        timeoutMs: deployment.timeoutMs,
        memoryPages: deployment.memoryPages,
        maxPayloadBytes: DEFAULT_LIMITS.maxPayloadBytes,
      });

      if (result.outcome !== 'ok') {
        failed += 1;
        await this.reportFailure(deployment, result);

        // The declared failure mode decides. `allow` keeps the merchant
        // working when a third party ships a bug; `deny` is a module saying
        // the decision is too important to make without an answer.
        if (failureMode === 'deny') {
          reasons.push(`${deployment.name} could not run, and this check cannot be skipped.`);
        }
        continue;
      }

      const verdict = this.parse(result.output);
      if (verdict === null) {
        failed += 1;
        await this.reportFailure(deployment, { ...result, outcome: 'invalid_output' });
        if (failureMode === 'deny') {
          reasons.push(`${deployment.name} gave an answer we could not read.`);
        }
        continue;
      }

      if (!verdict.allow) {
        reasons.push(verdict.reason || `${deployment.name} refused this.`);
      }
    }

    return { allowed: reasons.length === 0, reasons, ran: deployments.length, failed };
  }

  /**
   * A function's answer, or null if it is not one.
   *
   * Strict on purpose. A function that answers `{}` has not said yes — it has
   * said nothing, and reading that as approval is how a validation point stops
   * validating without anybody noticing.
   */
  private parse(output: string | null): { allow: boolean; reason: string } | null {
    if (!output) return null;
    try {
      const parsed: unknown = JSON.parse(output);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const allow = (parsed as { allow?: unknown }).allow;
      if (typeof allow !== 'boolean') return null;
      const reason = (parsed as { reason?: unknown }).reason;
      return { allow, reason: typeof reason === 'string' ? reason : '' };
    } catch {
      return null;
    }
  }

  private async reportFailure(deployment: FunctionDeployment, result: RunResult): Promise<void> {
    await this.ports.publish({
      type: 'functions.run.failed',
      payload: {
        deploymentId: deployment.id,
        appId: deployment.appId,
        point: deployment.point,
        outcome: result.outcome,
        authorFault: isAuthorFault(result.outcome),
        error: result.error,
      },
    });
  }

  /** Stops a function without deleting it, so it can be looked at afterwards. */
  async disable(deploymentId: string, appId: string, reason: string): Promise<void> {
    const mine = await this.ports.deployments.forApp(appId);
    const deployment = mine.find((entry) => entry.id === deploymentId);
    if (!deployment) throw new FunctionRuleError('deploymentId', 'is not a function you deployed');

    await this.ports.deployments.save({
      ...deployment,
      status: 'disabled',
      disabledReason: reason.trim() || 'Disabled.',
    });
  }
}
