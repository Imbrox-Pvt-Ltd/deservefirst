/**
 * Core · http/response-envelope.ts
 * One response shape across every transport (§5.6, §13.6). Consistency here is
 * what lets clients — and generated SDKs — handle success, pagination and errors
 * without special-casing each endpoint.
 * Layer: core/http.
 */

import type { Connection } from '@deservefirst/contracts';

export interface ResponseMeta {
  readonly requestId: string;
  readonly pagination?: {
    readonly hasNextPage: boolean;
    readonly hasPreviousPage: boolean;
    readonly startCursor: string | null;
    readonly endCursor: string | null;
    readonly totalCount?: number;
  };
  readonly deprecations?: readonly string[];
}

/** RFC 7807 problem+json fields, plus a stable machine-readable code (§14.7). */
export interface ApiError {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly status: number;
  /** JSON pointer to the offending field, for validation failures. */
  readonly pointer?: string;
}

export interface ApiResponse<T> {
  readonly data: T | null;
  readonly meta: ResponseMeta;
  readonly errors: readonly ApiError[];
}

export function success<T>(data: T, meta: ResponseMeta): ApiResponse<T> {
  return { data, meta, errors: [] };
}

export function paginated<T>(
  connection: Connection<T>,
  meta: Omit<ResponseMeta, 'pagination'>,
): ApiResponse<readonly T[]> {
  return {
    data: connection.nodes,
    meta: {
      ...meta,
      pagination: {
        hasNextPage: connection.pageInfo.hasNextPage,
        hasPreviousPage: connection.pageInfo.hasPreviousPage,
        startCursor: connection.pageInfo.startCursor,
        endCursor: connection.pageInfo.endCursor,
        ...(connection.totalCount === undefined ? {} : { totalCount: connection.totalCount }),
      },
    },
    errors: [],
  };
}

export function failure(errors: readonly ApiError[], meta: ResponseMeta): ApiResponse<never> {
  return { data: null, meta, errors };
}

/** Typed error codes, so clients branch on a constant rather than a message. */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  TENANT_MISMATCH: 'tenant_mismatch',
  NOT_ENTITLED: 'not_entitled',
  RATE_LIMITED: 'rate_limited',
  VALIDATION_FAILED: 'validation_failed',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PRECONDITION_FAILED: 'precondition_failed',
  INTERNAL: 'internal_error',

  // OAuth. Named as the specification names them, because an integrator's
  // client library switches on these exact strings and inventing our own
  // spelling means every one of them needs a special case for us.
  INVALID_TOKEN: 'invalid_token',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  INVALID_SCOPE: 'invalid_scope',
  INVALID_REDIRECT_URI: 'invalid_redirect_uri',
  APP_SUSPENDED: 'app_suspended',
  APP_NOT_PUBLISHED: 'app_not_published',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  tenant_mismatch: 403,
  not_entitled: 402,
  rate_limited: 429,
  validation_failed: 422,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  internal_error: 500,
  invalid_token: 401,
  invalid_client: 401,
  invalid_grant: 400,
  invalid_scope: 400,
  invalid_redirect_uri: 400,
  app_suspended: 403,
  app_not_published: 403,
};

export function apiError(
  code: ErrorCode,
  title: string,
  detail: string,
  pointer?: string,
): ApiError {
  return {
    code,
    title,
    detail,
    status: STATUS_BY_CODE[code],
    ...(pointer === undefined ? {} : { pointer }),
  };
}
