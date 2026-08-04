/**
 * Auth · infrastructure/index.ts
 * Persistence for the identity model. Identity is the one place where not every
 * query carries a store predicate — a user is found before any store context
 * exists — which is why its tables are declared platform- and organization-
 * scoped in the manifest (§14.2).
 * Layer: infrastructure.
 */

export * from './identity.repository';
export * from './session.repository';
export * from './auth-ports';
