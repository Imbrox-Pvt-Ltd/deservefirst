/**
 * Core · adapters/index.ts
 * Every external dependency sits behind an interface (§0.8, §5.5). Swapping S3
 * for another store, or managed auth for self-hosted, is a new adapter and zero
 * call-site changes — which is what makes the §7 scale levers config rather than
 * redesign.
 * Layer: core.
 */

import type { StoreId } from '@deservefirst/contracts';

// --- storage ---------------------------------------------------------------

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly url: string;
}

export interface StorageProvider {
  /** Keys are always store-prefixed; an unscoped root is a cross-tenant leak. */
  put(storeId: StoreId, path: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(storeId: StoreId, path: string): Promise<Buffer | null>;
  delete(storeId: StoreId, path: string): Promise<void>;
  signedUrl(storeId: StoreId, path: string, expiresInSeconds: number): Promise<string>;
}

// --- email -----------------------------------------------------------------

export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly replyTo?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

// --- queue -----------------------------------------------------------------

export interface JobPayload {
  readonly storeId: StoreId | null;
  readonly moduleKey: string;
  readonly operation: string;
  readonly requestId: string | null;
  readonly data: Record<string, unknown>;
}

export interface QueueProvider {
  /**
   * `idempotencyKey` lets a retried enqueue be recognised rather than duplicated
   * — required, because at-least-once delivery without it means double work.
   */
  enqueue(queue: string, payload: JobPayload, idempotencyKey: string): Promise<{ jobId: string }>;
  schedule(queue: string, payload: JobPayload, runAt: Date, idempotencyKey: string): Promise<{ jobId: string }>;
}

// --- search ----------------------------------------------------------------

export interface SearchDocument {
  readonly id: string;
  readonly entity: string;
  readonly storeId: StoreId;
  readonly fields: Record<string, string | number | boolean | null>;
}

export interface SearchProvider {
  index(documents: readonly SearchDocument[]): Promise<void>;
  remove(storeId: StoreId, entity: string, ids: readonly string[]): Promise<void>;
  query(
    storeId: StoreId,
    entity: string,
    text: string,
    limit: number,
  ): Promise<readonly { id: string; score: number }[]>;
}

// --- auth ------------------------------------------------------------------

export interface Credential {
  readonly providerRef: string;
  readonly email: string;
  readonly mfaEnabled: boolean;
}

/**
 * The seam that keeps ADR 0001 D5 reversible: our own implementation today,
 * a managed or self-hosted engine later, with no change to the identity model.
 */
export interface AuthProvider {
  createCredential(email: string, password: string): Promise<Credential>;
  verify(email: string, password: string, mfaCode?: string): Promise<Credential | null>;
  startPasswordReset(email: string): Promise<{ token: string }>;
  completePasswordReset(token: string, password: string): Promise<void>;
  enrollMfa(providerRef: string, method: 'app' | 'sms' | 'email'): Promise<{ secret: string; otpauthUrl?: string }>;
}

// --- FX --------------------------------------------------------------------

/** Presentment currency is computed at read time and cached, never stored (§15.6). */
export interface RatesProvider {
  rate(from: string, to: string, at?: Date): Promise<number>;
  refresh(): Promise<void>;
}
