/**
 * Customers · config/index.ts
 * Build-time configuration. Runtime settings belong in the manifest's schema so
 * the platform generates their UI, storage and API (§31.9).
 * Layer: config.
 */

export const customersConfig = {
  /** Segments are evaluated live; this caps how many customers one preview scans. */
  segmentPreviewLimit: 250,
} as const;
