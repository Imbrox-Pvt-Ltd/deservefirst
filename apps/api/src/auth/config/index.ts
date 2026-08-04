/**
 * Auth · config/index.ts
 * Build-time configuration for the auth module. Runtime settings belong in the
 * manifest's schema-driven `settings` so the platform generates their UI and
 * storage (§31.9).
 * Layer: config.
 */

export const authConfig = {
  /** Sessions idle longer than this are pruned by the scheduled job. */
  sessionPruneAfterDays: 45,
} as const;
