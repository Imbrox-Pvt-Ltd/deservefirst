/**
 * Inventory · domain/index.ts
 * Locations, stock levels, purchase orders and transfers. On-hand is derived
 * from adjustments rather than set, so every change has a reason (§14.1).
 * Layer: domain (pure).
 */

export * from './inventory';
