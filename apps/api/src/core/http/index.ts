/**
 * Core · http/index.ts
 * Gateway conventions: the response envelope and the route composer. Transports
 * are thin adapters over the service layer (§13.1), so this package holds
 * shape and composition, never logic.
 * Layer: core/http.
 */

export * from './response-envelope';
export * from './route-composer';
