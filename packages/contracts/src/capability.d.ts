/**
 * Contracts · capability.ts
 * Capability contracts (§31.7). Each capability a module declares must supply the
 * pieces its contract requires; the runtime validates every manifest at boot and
 * a module missing a required piece FAILS TO LOAD LOUDLY, never silently. That
 * fail-fast validation is what makes metadata-driven composition safe.
 * Layer: contracts (pure, no framework).
 */
import type { ModuleManifest } from './module-manifest';
export interface ManifestValidationResult {
    readonly moduleId: string;
    readonly errors: readonly string[];
}
/**
 * Validates a manifest against its declared capability contracts. Returns every
 * problem rather than the first, so a module author fixes one round of errors
 * instead of playing whack-a-mole.
 */
export declare function validateManifest(manifest: ModuleManifest): ManifestValidationResult;
/** Throws on the first invalid manifest. Called by the runtime at boot (§31.7). */
export declare function assertManifestValid(manifest: ModuleManifest): void;
//# sourceMappingURL=capability.d.ts.map