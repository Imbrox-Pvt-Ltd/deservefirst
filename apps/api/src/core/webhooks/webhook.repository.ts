/**
 * Core · webhooks/webhook.repository.ts
 * Persistence for subscriptions and the delivery outbox.
 *
 * The delivery table is the outbox: rows are written before anything is sent and
 * kept afterwards. That history is what an operator reads when a partner says
 * "we never got it" — the answer is either a 200 we recorded or a list of
 * attempts that says otherwise, and neither is available if rows are deleted on
 * success.
 * Layer: infrastructure.
 */

import type { StoreId } from '@deservefirst/contracts';

import type { QueryExecutor } from '../list-engine';
import type { SqlDialect } from '../list-engine/dialect';
import { requireStoreContext } from '../tenant-context';
import type {
  WebhookDelivery,
  WebhookDeliveryRepository,
  WebhookSubscription,
  WebhookSubscriptionRepository,
} from './index';

const date = (value: unknown): Date | null => (value ? new Date(value as string) : null);

interface SubscriptionRow extends Record<string, unknown> {
  id: string;
  app_id: string | null;
  event_type: string;
  url: string;
  secret: string;
  status: string;
  consecutive_failures: number;
  disabled_reason: string | null;
  version: number;
}

export class SqlWebhookSubscriptionRepository implements WebhookSubscriptionRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private toDomain(row: SubscriptionRow): WebhookSubscription {
    return {
      id: row.id,
      appId: row.app_id,
      eventType: row.event_type,
      url: row.url,
      secret: row.secret,
      status: row.status as WebhookSubscription['status'],
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      disabledReason: row.disabled_reason,
      version: Number(row.version),
    };
  }

  /** An app's own endpoint on one store, if it has registered one. */
  async forApp(storeId: StoreId, appId: string): Promise<readonly WebhookSubscription[]> {
    const rows = await this.executor.query<SubscriptionRow>(
      `SELECT * FROM ${this.q('webhook_subscriptions')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('app_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL`,
      [storeId, appId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async listening(storeId: StoreId, eventType: string): Promise<readonly WebhookSubscription[]> {
    const rows = await this.executor.query<SubscriptionRow>(
      `SELECT * FROM ${this.q('webhook_subscriptions')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('event_type')} = ${this.p(2)}
          AND ${this.q('status')} = 'active'
          AND ${this.q('deleted_at')} IS NULL`,
      [storeId, eventType],
    );
    return rows.map((row) => this.toDomain(row));
  }

  /**
   * Looked up WITHOUT a store filter, because delivery runs on a timer outside
   * any request. The store is carried on the delivery row instead, which is
   * what scopes the work.
   */
  async findById(id: string): Promise<WebhookSubscription | null> {
    const rows = await this.executor.query<SubscriptionRow>(
      `SELECT * FROM ${this.q('webhook_subscriptions')}
        WHERE ${this.q('id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async save(subscription: WebhookSubscription): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('webhook_subscriptions')}
          SET ${this.q('url')} = ${this.p(1)},
              ${this.q('status')} = ${this.p(2)},
              ${this.q('consecutive_failures')} = ${this.p(3)},
              ${this.q('disabled_reason')} = ${this.p(4)},
              ${this.q('version')} = ${this.p(5)},
              ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('id')} = ${this.p(6)}`,
      [
        subscription.url,
        subscription.status,
        subscription.consecutiveFailures,
        subscription.disabledReason,
        subscription.version,
        subscription.id,
      ],
    );
  }

  /** Everything this store has registered, for the settings screen. */
  async listForStore(): Promise<readonly WebhookSubscription[]> {
    const storeId = requireStoreContext('core.webhooks').storeId;
    const rows = await this.executor.query<SubscriptionRow>(
      `SELECT * FROM ${this.q('webhook_subscriptions')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('event_type')} ASC`,
      [storeId],
    );
    return rows.map((row) => this.toDomain(row));
  }

  async insert(subscription: WebhookSubscription): Promise<void> {
    const values: Record<string, unknown> = {
      id: subscription.id,
      store_id: requireStoreContext('core.webhooks').storeId,
      handle: subscription.id,
      app_id: subscription.appId,
      event_type: subscription.eventType,
      url: subscription.url,
      secret: subscription.secret,
      status: subscription.status,
      consecutive_failures: 0,
      disabled_reason: null,
      version: 1,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('webhook_subscriptions')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, i) => this.p(i + 1)).join(', ')})`,
      Object.values(values),
    );
  }

  async remove(id: string): Promise<void> {
    const storeId = requireStoreContext('core.webhooks').storeId;
    await this.executor.query(
      `UPDATE ${this.q('webhook_subscriptions')} SET ${this.q('deleted_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('id')} = ${this.p(2)}`,
      [storeId, id],
    );
  }
}

interface DeliveryRow extends Record<string, unknown> {
  id: string;
  store_id: string;
  subscription_id: string;
  event_id: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  response_status: number | null;
  error: string | null;
  next_attempt_at: unknown;
  delivered_at: unknown;
}

export class SqlWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly dialect: SqlDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  private toDomain(row: DeliveryRow): { storeId: StoreId; delivery: WebhookDelivery } {
    return {
      storeId: row.store_id as StoreId,
      delivery: {
        id: row.id,
        subscriptionId: row.subscription_id,
        eventId: row.event_id,
        eventType: row.event_type,
        payload: row.payload,
        status: row.status as WebhookDelivery['status'],
        attempts: Number(row.attempts ?? 0),
        responseStatus: row.response_status === null ? null : Number(row.response_status),
        error: row.error,
        nextAttemptAt: date(row.next_attempt_at),
        deliveredAt: date(row.delivered_at),
      },
    };
  }

  async create(storeId: StoreId, delivery: WebhookDelivery): Promise<void> {
    const values: Record<string, unknown> = {
      id: delivery.id,
      store_id: storeId,
      handle: delivery.id,
      subscription_id: delivery.subscriptionId,
      event_id: delivery.eventId,
      event_type: delivery.eventType,
      payload: delivery.payload,
      status: delivery.status,
      attempts: delivery.attempts,
      response_status: delivery.responseStatus,
      error: delivery.error,
      next_attempt_at: delivery.nextAttemptAt,
      delivered_at: delivery.deliveredAt,
      version: 1,
    };
    const columns = Object.keys(values);

    await this.executor.query(
      `INSERT INTO ${this.q('webhook_deliveries')} (${columns.map((c) => this.q(c)).join(', ')})
       VALUES (${columns.map((_, i) => this.p(i + 1)).join(', ')})`,
      Object.values(values),
    );
  }

  async save(delivery: WebhookDelivery): Promise<void> {
    await this.executor.query(
      `UPDATE ${this.q('webhook_deliveries')}
          SET ${this.q('status')} = ${this.p(1)},
              ${this.q('attempts')} = ${this.p(2)},
              ${this.q('response_status')} = ${this.p(3)},
              ${this.q('error')} = ${this.p(4)},
              ${this.q('next_attempt_at')} = ${this.p(5)},
              ${this.q('delivered_at')} = ${this.p(6)},
              ${this.q('updated_at')} = CURRENT_TIMESTAMP(3)
        WHERE ${this.q('id')} = ${this.p(7)}`,
      [
        delivery.status,
        delivery.attempts,
        delivery.responseStatus,
        delivery.error,
        delivery.nextAttemptAt,
        delivery.deliveredAt,
        delivery.id,
      ],
    );
  }

  async findById(id: string) {
    const rows = await this.executor.query<DeliveryRow>(
      `SELECT * FROM ${this.q('webhook_deliveries')} WHERE ${this.q('id')} = ${this.p(1)} LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? this.toDomain(row) : null;
  }

  async due(now: Date, limit: number) {
    const rows = await this.executor.query<DeliveryRow>(
      `SELECT * FROM ${this.q('webhook_deliveries')}
        WHERE ${this.q('status')} = 'pending'
          AND ${this.q('next_attempt_at')} <= ${this.p(1)}
        ORDER BY ${this.q('next_attempt_at')} ASC
        LIMIT ${this.p(2)}`,
      [now, limit],
    );
    return rows.map((row) => this.toDomain(row));
  }

  /** This store's recent deliveries, newest first, for the settings screen. */
  async recentForStore(limit = 50) {
    const storeId = requireStoreContext('core.webhooks').storeId;
    const rows = await this.executor.query<DeliveryRow>(
      `SELECT * FROM ${this.q('webhook_deliveries')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
        ORDER BY ${this.q('created_at')} DESC
        LIMIT ${this.p(2)}`,
      [storeId, limit],
    );
    return rows.map((row) => this.toDomain(row).delivery);
  }
}
