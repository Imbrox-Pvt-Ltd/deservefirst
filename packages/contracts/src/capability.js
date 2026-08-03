"use strict";
/**
 * Contracts · capability.ts
 * Capability contracts (§31.7). Each capability a module declares must supply the
 * pieces its contract requires; the runtime validates every manifest at boot and
 * a module missing a required piece FAILS TO LOAD LOUDLY, never silently. That
 * fail-fast validation is what makes metadata-driven composition safe.
 * Layer: contracts (pure, no framework).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateManifest = validateManifest;
exports.assertManifestValid = assertManifestValid;
const CONTRACTS = [
    { capability: 'entities', requires: ['entities'] },
    {
        capability: 'resources',
        requires: ['resources'],
        validate: (manifest) => {
            const errors = [];
            const entityNames = new Set((manifest.entities ?? []).map((entity) => entity.name));
            for (const resource of manifest.resources ?? []) {
                if (!entityNames.has(resource.entity)) {
                    errors.push(`resource "${resource.name}" targets entity "${resource.entity}", which the manifest does not declare`);
                }
            }
            return errors;
        },
    },
    {
        capability: 'routes',
        requires: ['routes', 'permissions'],
        validate: (manifest) => {
            const errors = [];
            const declared = new Set((manifest.permissions ?? []).map((permission) => permission.key));
            for (const route of manifest.routes ?? []) {
                if (!declared.has(route.permission)) {
                    errors.push(`route "${route.path}" requires permission "${route.permission}", which the manifest does not declare`);
                }
            }
            return errors;
        },
    },
    {
        capability: 'navigation',
        requires: ['navigation', 'routes'],
        validate: (manifest) => {
            const errors = [];
            const paths = new Set((manifest.routes ?? []).map((route) => route.path));
            for (const item of manifest.navigation ?? []) {
                if (!paths.has(item.path)) {
                    errors.push(`navigation item "${item.id}" points at "${item.path}", which is not a declared route`);
                }
            }
            return errors;
        },
    },
    { capability: 'settings', requires: ['settings', 'permissions'] },
    { capability: 'permissions', requires: ['permissions'] },
    { capability: 'events', requires: ['events'] },
    {
        capability: 'webhooks',
        requires: ['webhooks', 'events'],
        validate: (manifest) => {
            const errors = [];
            const emitted = new Set((manifest.events ?? [])
                .filter((event) => event.direction === 'emits')
                .map((event) => event.type));
            for (const webhook of manifest.webhooks ?? []) {
                if (!emitted.has(webhook.eventType)) {
                    errors.push(`webhook topic "${webhook.topic}" maps to event "${webhook.eventType}", which this module does not emit`);
                }
            }
            return errors;
        },
    },
    { capability: 'jobs', requires: ['jobs'] },
    {
        capability: 'search',
        requires: ['searchProviders', 'entities', 'permissions'],
        validate: (manifest) => {
            const errors = [];
            const entityNames = new Set((manifest.entities ?? []).map((entity) => entity.name));
            const declared = new Set((manifest.permissions ?? []).map((permission) => permission.key));
            for (const provider of manifest.searchProviders ?? []) {
                if (!entityNames.has(provider.entity)) {
                    errors.push(`search provider targets undeclared entity "${provider.entity}"`);
                }
                if (!declared.has(provider.permission)) {
                    errors.push(`search provider requires undeclared permission "${provider.permission}"`);
                }
                if (provider.fields.length === 0) {
                    errors.push(`search provider for "${provider.entity}" declares no searchable fields`);
                }
            }
            return errors;
        },
    },
    { capability: 'commands', requires: ['commands'] },
    { capability: 'notifications', requires: ['notifications', 'events'] },
    { capability: 'integrations', requires: [] },
    { capability: 'dashboards', requires: ['dashboards'] },
    { capability: 'metrics', requires: [] },
    {
        capability: 'seo',
        requires: ['entities'],
        validate: (manifest) => {
            const seoEnabled = (manifest.entities ?? []).some((entity) => entity.toolkit?.seo);
            return seoEnabled
                ? []
                : ['seo capability declared but no entity opts into the SEO toolkit'];
        },
    },
    { capability: 'ai', requires: [] },
];
const CONTRACTS_BY_KEY = new Map(CONTRACTS.map((contract) => [contract.capability, contract]));
function isEmpty(value) {
    if (value === undefined || value === null)
        return true;
    if (Array.isArray(value))
        return value.length === 0;
    return false;
}
/**
 * Validates a manifest against its declared capability contracts. Returns every
 * problem rather than the first, so a module author fixes one round of errors
 * instead of playing whack-a-mole.
 */
function validateManifest(manifest) {
    const errors = [];
    if (!manifest.id || !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
        errors.push(`module id "${manifest.id}" must be lower-kebab-case`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        errors.push(`module version "${manifest.version}" must be semver`);
    }
    if (!manifest.entitlementKey) {
        errors.push('manifest must declare an entitlementKey — every feature is entitlement-gated');
    }
    for (const capability of manifest.capabilities) {
        const contract = CONTRACTS_BY_KEY.get(capability);
        if (!contract) {
            errors.push(`unknown capability "${capability}"`);
            continue;
        }
        for (const key of contract.requires) {
            if (isEmpty(manifest[key])) {
                errors.push(`capability "${capability}" requires manifest key "${String(key)}", which is missing or empty`);
            }
        }
        errors.push(...(contract.validate?.(manifest) ?? []));
    }
    // Declaring content without declaring the capability is the same class of bug:
    // the registry would never compose it, and the author would never know why.
    const undeclared = [
        ['routes', 'routes'],
        ['navigation', 'navigation'],
        ['webhooks', 'webhooks'],
        ['jobs', 'jobs'],
        ['searchProviders', 'search'],
        ['dashboards', 'dashboards'],
    ];
    for (const [key, capability] of undeclared) {
        if (!isEmpty(manifest[key]) && !manifest.capabilities.includes(capability)) {
            errors.push(`manifest declares "${String(key)}" but does not list capability "${capability}" — it would never be composed`);
        }
    }
    return { moduleId: manifest.id, errors };
}
/** Throws on the first invalid manifest. Called by the runtime at boot (§31.7). */
function assertManifestValid(manifest) {
    const result = validateManifest(manifest);
    if (result.errors.length > 0) {
        throw new Error(`Module "${result.moduleId}" failed capability-contract validation:\n` +
            result.errors.map((error) => `  · ${error}`).join('\n'));
    }
}
//# sourceMappingURL=capability.js.map