/**
 * Auth · domain/index.ts
 * Pure identity rules: the scope model, credentials, MFA, sessions and the
 * permission catalogue. No I/O, no framework — every rule here is testable
 * without a database (§14.1).
 * Layer: domain (pure).
 */

export * from './identity';
export * from './credentials';
export * from './mfa';
export * from './session';
export * from './permissions';
