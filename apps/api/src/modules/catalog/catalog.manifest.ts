/**
 * Catalog · catalog.manifest.ts
 * The module manifest — the single declaration from which the platform composes
 * this module's routes, API, permissions, events, settings and navigation.
 * If it is not declared here, the platform does not load it (§31.2, §14.1).
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest } from '@deservefirst/contracts';

export const catalogManifest: ModuleManifest = {
  id: 'catalog',
  version: '0.1.0',
  label: 'Catalog',
  description: 'TODO: one sentence on what this module does for a merchant.',

  entitlementKey: 'catalog',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'auth', type: 'required' },
  ],

  // Declare only what this module actually supplies; each capability's contract
  // is validated at boot and a missing piece fails the load loudly (§31.7).
  capabilities: ['permissions'],

  permissions: [
    {
      key: 'catalog.read',
      label: 'View catalog',
      description: 'Open the catalog workspace and read its records.',
      categories: ['organization', 'store'],
    },
    {
      key: 'catalog.write',
      label: 'Manage catalog',
      description: 'Create, edit and delete catalog records.',
      categories: ['organization', 'store'],
    },
  ],

  lifecycle: { startup: 'lazy' },
};

export default catalogManifest;
