/**
 * Auth · application/index.ts
 * Use-cases over the identity domain: the access decision and the auth flows.
 * Transport-agnostic, so REST, GraphQL and workers share one implementation
 * (§13.1).
 * Layer: application.
 */

export * from './access-evaluator';
export * from './auth-service';
