/**
 * Fitness · routes.mjs
 * Route-coherence rules (§24.5). Frontend routes and backend operations are two
 * surfaces derived from one manifest, so the failure mode is drift: a screen
 * that points at an operation nobody implemented, or a nav item to a route that
 * does not exist. These catch it at build time.
 * Layer: tooling.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { lineOf, violation } from './context.mjs';

const require = createRequire(import.meta.url);

/**
 * Reads the built manifests. Compiled output is used deliberately: it is what
 * the runtime actually loads, so a check against source could pass while the
 * running platform disagrees.
 */
function loadManifests(rootDir) {
  const manifests = [];
  const distRoot = join(rootDir, 'apps/api/dist');
  if (!existsSync(distRoot)) return manifests;

  const load = (path, names) => {
    if (!existsSync(path)) return;
    try {
      const loaded = require(path);
      const manifest = loaded.default ?? names.map((name) => loaded[name]).find(Boolean);
      if (manifest?.id) manifests.push(manifest);
    } catch {
      // A manifest that cannot be loaded is caught by the build, not here.
    }
  };

  load(join(distRoot, 'auth/auth.manifest.js'), ['authManifest']);

  const modulesDir = join(distRoot, 'modules');
  if (existsSync(modulesDir)) {
    for (const name of readdirSync(modulesDir)) {
      if (!statSync(join(modulesDir, name)).isDirectory()) continue;
      load(join(modulesDir, name, `${name}.manifest.js`), [`${name}Manifest`]);
    }
  }

  return manifests;
}

/** Every screen route must resolve to a declared permission and a real entity. */
export const routeCoherence = {
  name: 'route-coherence',
  description: 'No orphan routes, no undeclared permissions, no missing entities (§24.5)',
  run(_sources, rootDir) {
    const violations = [];
    const manifests = loadManifests(rootDir);
    if (manifests.length === 0) return violations;

    // Permissions may be declared by any module; a route may legitimately
    // require one another module owns.
    const allPermissions = new Set(
      manifests.flatMap((manifest) => (manifest.permissions ?? []).map((entry) => entry.key)),
    );

    for (const manifest of manifests) {
      const file = `apps/api/src/${manifest.id === 'auth' ? 'auth' : `modules/${manifest.id}`}/${manifest.id}.manifest.ts`;
      const entities = new Set((manifest.entities ?? []).map((entity) => entity.name));
      const routePaths = new Set((manifest.routes ?? []).map((route) => route.path));

      for (const route of manifest.routes ?? []) {
        if (!allPermissions.has(route.permission)) {
          violations.push(
            violation(file, 1, 'route-coherence', `route "${route.path}" requires undeclared permission "${route.permission}"`),
          );
        }
        // A route naming an entity nobody declared renders an empty screen.
        if (route.entity && !entities.has(route.entity)) {
          const declaredElsewhere = manifests.some((other) =>
            (other.entities ?? []).some((entity) => entity.name === route.entity),
          );
          if (!declaredElsewhere) {
            violations.push(
              violation(file, 1, 'route-coherence', `route "${route.path}" targets entity "${route.entity}", which no module declares`),
            );
          }
        }
      }

      for (const item of manifest.navigation ?? []) {
        if (!routePaths.has(item.path)) {
          violations.push(
            violation(file, 1, 'route-coherence', `navigation item "${item.id}" points at "${item.path}", which is not a declared route`),
          );
        }
      }

      // A resource declaring a list screen with no route is unreachable.
      for (const resource of manifest.resources ?? []) {
        if (!resource.screens?.includes('list')) continue;
        const expected = `/${resource.urlSegment}`;
        const reachable = [...routePaths].some((path) => path.endsWith(expected));
        if (!reachable && (manifest.routes ?? []).length > 0) {
          violations.push(
            violation(file, 1, 'route-coherence', `resource "${resource.name}" declares a list screen but no route ends in "${expected}"`),
          );
        }
      }
    }

    return violations;
  },
};

/** No two modules may claim the same path — routing would become order-dependent. */
export const routeCollisions = {
  name: 'route-collisions',
  description: 'No two modules claim the same route path (§24.5)',
  run(_sources, rootDir) {
    const violations = [];
    const manifests = loadManifests(rootDir);
    const owners = new Map();

    for (const manifest of manifests) {
      for (const route of manifest.routes ?? []) {
        const existing = owners.get(route.path);
        if (existing && existing !== manifest.id) {
          violations.push(
            violation(
              `apps/api/src/modules/${manifest.id}/${manifest.id}.manifest.ts`,
              1,
              'route-collisions',
              `"${route.path}" is claimed by both "${existing}" and "${manifest.id}"`,
            ),
          );
        } else {
          owners.set(route.path, manifest.id);
        }
      }
    }

    return violations;
  },
};

/**
 * List and detail screens must read their state FROM the URL (§24.3). A screen
 * holding filters in local state cannot be shared, bookmarked or restored, and
 * breaks under back/forward — the exact failure the URL rule exists to prevent.
 */
export const urlStateOnly = {
  name: 'url-state-only',
  description: 'List screens read filter/sort/pagination from the URL, not local state (§24.3)',
  run(sources) {
    const violations = [];
    const screenPattern = /(list|index)\.(tsx|ts)$|ListScreen|products\/page\.tsx/i;

    for (const source of sources) {
      if (!source.relativePath.startsWith('apps/web/')) continue;
      if (!screenPattern.test(source.relativePath) && !/<ListScreen/.test(source.text)) continue;
      // The template itself is where URL state is implemented.
      if (source.relativePath.startsWith('packages/ui/')) continue;

      const holdsListState = /useState[^)]*\b(filters?|sortOrder|sorting|pageIndex|cursor|currentPage)\b/i.exec(
        source.text,
      );
      if (holdsListState) {
        violations.push(
          violation(
            source.relativePath,
            lineOf(source.text, holdsListState.index),
            'url-state-only',
            'list state is held in component state — read it from the URL instead (§24.3)',
          ),
        );
      }
    }

    return violations;
  },
};

export const routeRules = [routeCoherence, routeCollisions, urlStateOnly];
