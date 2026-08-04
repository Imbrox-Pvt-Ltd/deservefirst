/**
 * Catalog · infrastructure/index.ts
 * Repositories and adapter implementations for the ports declared in domain/ and
 * application/. Every query here is store-scoped (§14.2).
 * Layer: infrastructure.
 */

export * from './product.repository';
export * from './collection.repository';
