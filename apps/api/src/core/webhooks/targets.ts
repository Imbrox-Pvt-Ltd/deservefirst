/**
 * Core · webhooks/targets.ts
 * Where a webhook can be delivered, besides an HTTPS endpoint.
 *
 * An app running on a cloud provider usually does not want an HTTP endpoint it
 * has to keep up. It wants events on a queue it already operates, with that
 * provider's retry, ordering and dead-lettering rather than ours. Pub/Sub and
 * EventBridge are the two the reference product offers, so they are the two
 * here.
 *
 * ─── What is and is not verified ────────────────────────────────────────────
 * The HTTPS target is exercised end to end against a live receiver, repeatedly.
 * The two cloud targets are NOT: publishing to them needs a Google service
 * account and AWS credentials, which this environment does not have, so their
 * transports are written against the providers' documented REST APIs and have
 * never had a real 200 back.
 *
 * That is stated here rather than discovered later. The parsing, validation and
 * routing around them are tested; the network call is the part taken on trust,
 * and anybody wiring this to a real project should treat the first delivery as
 * the actual test.
 * Layer: core.
 */

import { WebhookError } from './webhook';

export type DeliveryTargetKind = 'https' | 'pubsub' | 'eventbridge';

/**
 * Where a subscription sends.
 *
 * A discriminated union rather than a URL with a scheme prefix, because the
 * three carry genuinely different fields and squeezing them into one string is
 * how `pubsub://project/topic?region=` becomes a parser nobody can change.
 */
export type DeliveryTarget =
  | { readonly kind: 'https'; readonly url: string }
  | { readonly kind: 'pubsub'; readonly projectId: string; readonly topic: string }
  | { readonly kind: 'eventbridge'; readonly region: string; readonly eventBusArn: string };

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const TOPIC = /^[A-Za-z][\w.~+%-]{2,254}$/;
const REGION = /^[a-z]{2}-[a-z]+-\d$/;
const EVENT_BUS_ARN = /^arn:aws[a-z-]*:events:[a-z0-9-]+:\d{12}:event-bus\/[\w.-]+$/;

/**
 * Refuses a target the platform cannot deliver to.
 *
 * Shapes are checked at subscribe time rather than at first delivery, because a
 * typo in a project id becomes a delivery that fails forever, retries six
 * times, and dead-letters — and the person who typed it has long since closed
 * the tab.
 */
export function assertTargetValid(target: DeliveryTarget): void {
  switch (target.kind) {
    case 'https': {
      let parsed: URL;
      try {
        parsed = new URL(target.url);
      } catch {
        throw new WebhookError('url', 'must be an absolute URL');
      }
      if (parsed.protocol !== 'https:' && !isLoopback(parsed.hostname)) {
        throw new WebhookError('url', 'must use https, except on localhost for development');
      }
      return;
    }

    case 'pubsub': {
      if (!PROJECT_ID.test(target.projectId)) {
        throw new WebhookError('projectId', 'is not a Google Cloud project id');
      }
      if (!TOPIC.test(target.topic)) {
        throw new WebhookError('topic', 'is not a Pub/Sub topic name');
      }
      return;
    }

    case 'eventbridge': {
      if (!REGION.test(target.region)) {
        throw new WebhookError('region', 'is not an AWS region, e.g. eu-west-1');
      }
      if (!EVENT_BUS_ARN.test(target.eventBusArn)) {
        // The ARN carries the account id, so a wrong one is a delivery to
        // somebody else's account rather than a failure.
        throw new WebhookError('eventBusArn', 'is not an EventBridge event bus ARN');
      }
      return;
    }
  }
}

/** How a target reads on a screen, without leaking anything sensitive. */
export function describeTarget(target: DeliveryTarget): string {
  switch (target.kind) {
    case 'https':
      return target.url;
    case 'pubsub':
      return `Pub/Sub · ${target.projectId}/${target.topic}`;
    case 'eventbridge':
      return `EventBridge · ${target.region} · ${target.eventBusArn.split('/').pop()}`;
  }
}

/**
 * Whether a signature is worth sending.
 *
 * HTTPS receivers need one — anybody can POST to a public URL. A cloud queue
 * does not: the transport authenticates to the provider, and only something
 * holding our credentials can put a message on that topic. Sending one anyway
 * would be harmless and would also suggest it means something it does not.
 */
export function signsPayload(target: DeliveryTarget): boolean {
  return target.kind === 'https';
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Parses a stored target back into its union.
 *
 * Subscriptions predating cloud targets have a URL and no kind, so a missing
 * kind means https. A migration could have backfilled it; not needing one is
 * better than needing one.
 */
export function targetFrom(row: {
  targetKind?: string | null;
  url?: string | null;
  targetConfig?: unknown;
}): DeliveryTarget {
  const kind = (row.targetKind ?? 'https') as DeliveryTargetKind;
  const config = parseConfig(row.targetConfig);

  switch (kind) {
    case 'pubsub':
      return {
        kind: 'pubsub',
        projectId: String(config.projectId ?? ''),
        topic: String(config.topic ?? ''),
      };
    case 'eventbridge':
      return {
        kind: 'eventbridge',
        region: String(config.region ?? ''),
        eventBusArn: String(config.eventBusArn ?? ''),
      };
    default:
      return { kind: 'https', url: String(row.url ?? '') };
  }
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}
