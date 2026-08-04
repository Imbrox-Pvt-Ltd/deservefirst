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

  // Core owns the operator tables and declares them like any module. Named
  // explicitly because it is the one manifest whose file is not <dir>.manifest.
  load(join(root, 'apps/api/dist/core/platform.manifest.js'), ['platformManifest']);

  /**
   * Platform capabilities that sit BESIDE modules/ — auth, apps (§3).
   *
   * Discovered by convention rather than listed. They were listed, and the
   * consequence was quiet: a new capability's manifest was simply not seen, so
   * `db:sync` created none of its tables and the first insert failed with
   * "unknown table" a long way from the declaration. Any `x/x.manifest.js`
   * beside modules/ is found now, so adding one is one file, not two.
   */
  const distDir = join(root, 'apps/api/dist');
  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      if (name === 'core' || name === 'modules') continue;
      load(join(distDir, name, `${name}.manifest.js`), [`${name}Manifest`]);
    }
  }

  const modulesDir = join(root, 'apps/api/dist/modules');
  if (existsSync(modulesDir)) {
    for (const name of readdirSync(modulesDir)) {
      load(join(modulesDir, name, `${name}.manifest.js`), [`${name}Manifest`]);
    }
  }

  return manifests;
}
