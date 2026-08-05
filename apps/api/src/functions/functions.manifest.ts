/**
 * Functions · functions.manifest.ts
 * The Functions tier's own tables.
 * Layer: manifest.
 */

import type { ModuleManifest } from '@deservefirst/contracts';

export const functionsManifest: ModuleManifest = {
  id: 'functions',
  version: '0.1.0',
  label: 'Functions',
  description: 'Third-party WebAssembly running on a sandboxed tier (§22.3).',

  entitlementKey: 'core',
  dependsOn: [
    { module: 'core', type: 'required' },
    { module: 'apps', type: 'required' },
  ],

  capabilities: ['entities', 'permissions', 'events'],

  entities: [
    {
      name: 'FunctionDeployment',
      tableName: 'function_deployments',
      // Platform-scoped: a deployment belongs to an app and runs for whichever
      // stores installed it. Scoping the artefact per store would mean one copy
      // of the same bytes per merchant.
      scope: 'platform',
      toolkit: {
        metafields: false, metaobjects: false, tags: false, savedViews: false,
        bulkActions: false, importExport: false, seo: false, timeline: true, audit: true,
      },
      fields: [
        { name: 'appId', type: 'reference', references: 'App', indexed: true, filterable: true },
        { name: 'point', type: 'string', required: true, indexed: true, filterable: true },
        { name: 'name', type: 'string', required: true, searchable: true },
        // base64 rather than a blob: the artefact is small by construction —
        // the tier caps memory at 5 MiB — and keeping it in the row means a
        // deployment is one thing to back up rather than a row plus an object.
        { name: 'wasmBase64', type: 'text', visibility: 'internal' },
        { name: 'timeoutMs', type: 'integer' },
        { name: 'memoryPages', type: 'integer' },
        { name: 'status', type: 'enum', values: ['active', 'disabled'], filterable: true },
        { name: 'disabledReason', type: 'text' },
      ],
    },
  ],

  permissions: [
    {
      key: 'partner.functions.deploy',
      label: 'Deploy functions',
      description: 'Upload WebAssembly for an app to run on the Functions tier.',
      categories: ['partner'],
    },
  ],

  events: [
    { type: 'functions.deployment.created', version: 1, label: 'Function deployed', description: 'An app deployed a function.', direction: 'emits' },
    { type: 'functions.run.failed', version: 1, label: 'Function run failed', description: 'A function trapped, timed out, or answered with nonsense.', direction: 'emits' },
  ],

  lifecycle: { startup: 'eager' },
};

export default functionsManifest;
