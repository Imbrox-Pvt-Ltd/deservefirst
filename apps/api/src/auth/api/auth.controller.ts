/**
 * Auth · api/auth.controller.ts
 * Signing in, signing out, and asking who you are.
 *
 * These are the only endpoints on the platform that run WITHOUT a session, so
 * they cannot use the module controller contract — that contract guarantees an
 * authorised store scope, which is exactly what does not exist yet here. They
 * are registered directly by the transport instead, and the asymmetry is the
 * point rather than an oversight.
 * Layer: api.
 */

import type { StoreId } from '@deservefirst/contracts';

import type { AuthService } from '../application';
import type { Session } from '../domain';

export interface AuthRequest {
  readonly body: Readonly<Record<string, unknown>>;
  readonly cookie: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface LoginOutcome {
  readonly step: string;
  readonly rid: string;
  /** Set only once the flow completes. */
  readonly session?: Session;
  readonly returnPath?: string | null;
  readonly stores?: readonly { id: string; handle: string; name: string }[];
}

/**
 * The device label a session is remembered by.
 *
 * Derived from the user agent rather than asked for, because the point is that
 * somebody reviewing their sessions recognises the row — "Chrome on macOS" does
 * that and a UUID does not.
 */
export function deviceLabelFor(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Firefox\/|Edg\/|Chrome\/|Safari\//.exec(userAgent)?.[0]?.replace(/\/$/, '');
  const platform = /Mac OS X|Windows NT|Android|iPhone|Linux/.exec(userAgent)?.[0];
  const names: Record<string, string> = {
    'Mac OS X': 'macOS',
    'Windows NT': 'Windows',
    Edg: 'Edge',
  };
  const nice = (value: string | undefined) => (value ? (names[value] ?? value) : null);
  return [nice(browser), nice(platform)].filter(Boolean).join(' on ') || 'Unknown device';
}

export class AuthController {
  constructor(private readonly service: AuthService) {}

  /**
   * One endpoint for the whole login, driven by the flow's step.
   *
   * The alternative — an endpoint per step — lets a client post straight to the
   * last one. Here the server decides what comes next and the client only ever
   * reports what the person typed.
   */
  async login(request: AuthRequest): Promise<LoginOutcome> {
    const { body } = request;
    const device = {
      label: deviceLabelFor(request.userAgent),
      ipAddress: request.ip,
      userAgent: request.userAgent,
    };

    if (!body.rid) {
      const flow = await this.service.beginLogin({
        email: body.email === undefined ? undefined : String(body.email),
        returnPath: (body.returnPath ?? null) as string | null,
      });

      // Nothing is verified yet, so the password that arrived alongside is
      // checked as its own step rather than trusted for having travelled with
      // the email.
      if (body.password) {
        const outcome = await this.service.submitPassword({
          rid: flow.rid,
          email: String(body.email ?? ''),
          password: String(body.password),
        });
        return this.afterStep(flow.rid, outcome.next, device, body);
      }
      return { step: flow.step, rid: flow.rid };
    }

    const rid = String(body.rid);

    if (body.password !== undefined) {
      const outcome = await this.service.submitPassword({
        rid,
        email: String(body.email ?? ''),
        password: String(body.password),
      });
      return this.afterStep(rid, outcome.next, device, body);
    }

    if (body.code !== undefined) {
      const flow = await this.service.submitMfa({
        rid,
        code: String(body.code),
        useRecoveryCode: body.useRecoveryCode === true,
      });
      return this.afterStep(rid, flow.step === 'mfa' ? 'store-select' : flow.step, device, body);
    }

    return this.afterStep(rid, 'store-select', device, body);
  }

  /** Completes when the flow can complete, and reports the next step when not. */
  private async afterStep(
    rid: string,
    step: string,
    device: { label: string; ipAddress: string | null; userAgent: string | null },
    body: Readonly<Record<string, unknown>>,
  ): Promise<LoginOutcome> {
    if (step === 'mfa') return { step, rid };

    const completed = await this.service.completeLogin({
      rid,
      ...(body.storeId ? { storeId: String(body.storeId) as StoreId } : {}),
      device,
    });

    // Authenticated, but a session with no store still cannot open anything.
    // Reporting "complete" here would tell the client it was finished while
    // every subsequent call failed for want of a store.
    return {
      step: completed.session.storeId ? 'complete' : 'store-select',
      rid,
      session: completed.session,
      returnPath: completed.returnPath,
    };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.service.signOut(sessionId);
  }

  async switchStore(sessionId: string, storeId: StoreId) {
    return this.service.switchStore({ sessionId, storeId });
  }
}
