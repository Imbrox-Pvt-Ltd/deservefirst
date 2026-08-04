/**
 * Platform CLI · manifests.mjs
 * Finding the manifests, from the built tree.
 *
 * Read from `dist` rather than by scanning source, because that is what the
 * runtime loads — a schema derived from something the platform does not
 * actually run is a schema that can be wrong in a way nothing catches.
 *
 * Shared by db:sync and the migration generator: two copies of "where do
 * manifests live" is two things to update when a module moves.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** A resource-shaped wrapper around an entity that declares its own fields. */
export function syntheticResource(entity) {
  return {
    name: entity.name,
    entity: entity.name,
    pluralName: `${entity.name}s`,
    urlSegment: entity.tableName,
    fields: entity.fields ?? [],
    api: { graphql: false, rest: false, visibility: 'internal' },
    screens: [],
    permissions: { read: 'internal', write: 'internal' },
  };
}

export function manifestsOf(root) {
  const manifests = [];
  const load = (path, names) => {
    if (!existsSync(path)) return;
    try {
      const loaded = require(path);
      const manifest = loaded.default ?? names.map((name) => loaded[name]).find(Boolean);
      if (manifest?.id) manifests.push(manifest);
    } catch {
      // A manifest that cannot be loaded is the build's problem, not this file's.
    }
  };

  // Core owns the operator tables and declares them like any module.
  load(join(root, 'apps/api/dist/core/platform.manifest.js'), ['platformManifest']);
  // Auth is a first-class sibling of modules/ (§3), discovered explicitly.
  load(join(root, 'apps/api/dist/auth/auth.manifest.js'), ['authManifest']);

  const modulesDir = join(root, 'apps/api/dist/modules');
  if (existsSync(modulesDir)) {
    for (const name of readdirSync(modulesDir)) {
      load(join(modulesDir, name, `${name}.manifest.js`), [`${name}Manifest`]);
    }
  }

  return manifests;
}
