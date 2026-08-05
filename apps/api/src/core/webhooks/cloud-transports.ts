/**
 * Core · webhooks/cloud-transports.ts
 * Publishing to Pub/Sub and EventBridge.
 *
 * ─── Verification status ────────────────────────────────────────────────────
 * NEITHER of these has ever had a real response from its provider. This
 * environment has no Google service account and no AWS credentials, so both are
 * written against the documented REST APIs and are unproven against the actual
 * services. The routing, validation and error mapping around them are tested;
 * the request itself is taken on trust.
 *
 * Anybody wiring this up should treat the first delivery as the test, and
 * should expect the credential plumbing — not the request shape — to be where
 * it goes wrong. The credentials are read from the environment rather than
 * stored per subscription, because a merchant's webhook settings is not a place
 * to keep a cloud provider's private key.
 * Layer: core.
 */

import { createSign } from 'node:crypto';

import type { WebhookTransport } from './delivery.service';
import type { DeliveryTarget } from './targets';

export interface CloudCredentials {
  /** A Google service-account JSON, as the env var content. */
  readonly googleServiceAccountJson?: string | undefined;
  readonly awsRegion?: string | undefined;
  readonly awsAccessKeyId?: string | undefined;
  readonly awsSecretAccessKey?: string | undefined;
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): CloudCredentials {
  return {
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    awsRegion: env.AWS_REGION,
    awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  };
}

/**
 * A Google access token from a service account, via the JWT-bearer grant.
 *
 * Written out rather than pulled from `google-auth-library`, because that
 * dependency brings a large tree for one signed assertion — and the assertion
 * is twenty lines that are easier to audit than the tree.
 */
async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  const account = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/pubsub',
    aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');

  const response = await fetch(claims.aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });

  if (!response.ok) throw new Error(`Google refused the service account: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/** AWS SigV4, enough of it to sign one PutEvents call. */
async function sigV4Headers(input: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  body: string;
  host: string;
  target: string;
}): Promise<Record<string, string>> {
  const { createHash, createHmac } = await import('node:crypto');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const hmac = (key: Buffer | string, value: string) =>
    createHmac('sha256', key).update(value).digest();

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/events/aws4_request`;

  const canonical = [
    'POST',
    '/',
    '',
    `content-type:application/x-amz-json-1.1`,
    `host:${input.host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${input.target}`,
    '',
    'content-type;host;x-amz-date;x-amz-target',
    hash(input.body),
  ].join('\n');

  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n');
  const signingKey = ['aws4_request'].reduce(
    (key, part) => hmac(key, part),
    [input.region, 'events'].reduce(
      (key, part) => hmac(key, part),
      hmac(`AWS4${input.secretAccessKey}`, date),
    ),
  );

  return {
    'content-type': 'application/x-amz-json-1.1',
    'x-amz-date': amzDate,
    'x-amz-target': input.target,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      'SignedHeaders=content-type;host;x-amz-date;x-amz-target, ' +
      `Signature=${createHmac('sha256', signingKey).update(toSign).digest('hex')}`,
  };
}

/**
 * Picks a transport for a target.
 *
 * A missing credential is a 500-shaped failure rather than a 4xx, deliberately:
 * the app did nothing wrong, our deployment is misconfigured, and
 * `isRetryable` treats it as worth retrying — which is right, because the fix
 * is an environment variable somebody is about to set.
 */
export function cloudTransport(
  httpTransport: WebhookTransport,
  credentials: CloudCredentials = credentialsFromEnv(),
): (target: DeliveryTarget) => WebhookTransport {
  return (target) => {
    if (target.kind === 'https') return httpTransport;

    if (target.kind === 'pubsub') {
      return async ({ body }) => {
        if (!credentials.googleServiceAccountJson) {
          return { status: null, error: 'GOOGLE_SERVICE_ACCOUNT_JSON is not set on this deployment' };
        }
        try {
          const accessToken = await googleAccessToken(credentials.googleServiceAccountJson);
          const response = await fetch(
            `https://pubsub.googleapis.com/v1/projects/${target.projectId}/topics/${target.topic}:publish`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                messages: [{ data: Buffer.from(body).toString('base64') }],
              }),
            },
          );
          return { status: response.status, error: null };
        } catch (error) {
          return { status: null, error: error instanceof Error ? error.message : 'publish failed' };
        }
      };
    }

    return async ({ body }) => {
      if (!credentials.awsAccessKeyId || !credentials.awsSecretAccessKey) {
        return { status: null, error: 'AWS credentials are not set on this deployment' };
      }
      try {
        const host = `events.${target.region}.amazonaws.com`;
        const payload = JSON.stringify({
          Entries: [
            {
              EventBusName: target.eventBusArn,
              Source: 'deservefirst',
              DetailType: 'webhook',
              Detail: body,
            },
          ],
        });

        const response = await fetch(`https://${host}/`, {
          method: 'POST',
          headers: {
            host,
            ...(await sigV4Headers({
              region: target.region,
              accessKeyId: credentials.awsAccessKeyId,
              secretAccessKey: credentials.awsSecretAccessKey,
              body: payload,
              host,
              target: 'AWSEvents.PutEvents',
            })),
          },
          body: payload,
        });
        return { status: response.status, error: null };
      } catch (error) {
        return { status: null, error: error instanceof Error ? error.message : 'publish failed' };
      }
    };
  };
}
