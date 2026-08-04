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
      //
      // Matched on the route's declared ENTITY, not on its path. Matching the
      // path against `urlSegment` conflated two different namespaces: the API
      // segment is ours and kebab-cased, while the admin URL follows the
      // reference product (`/purchase_orders`, `/content/metaobjects`). Those
      // legitimately differ, and a string comparison called it an error — while
      // still passing a resource whose route happened to end in the right word
      // but pointed at another entity.
      // SettingsScreen counts: locations, sales channels and the like are listed
      // inside settings rather than as a primary section, and that screen is a
      // real, reachable list. What the rule is protecting against is a resource
      // nothing can open at all.
      const LISTING_SCREENS = new Set(['ListScreen', 'SettingsScreen']);
      const listedEntities = new Set(
        (manifest.routes ?? [])
          .filter((route) => LISTING_SCREENS.has(route.screen) && route.entity)
          .map((route) => route.entity),
      );

      for (const resource of manifest.resources ?? []) {
        if (!resource.screens?.includes('list')) continue;
        if (listedEntities.has(resource.entity)) continue;
        if ((manifest.routes ?? []).length === 0) continue;

        violations.push(
          violation(
            file,
            1,
            'route-coherence',
            `resource "${resource.name}" declares a list screen but no route declares screen "ListScreen" for entity "${resource.entity}"`,
          ),
        );
      }
    }

    return violations;
  },
};

/**
 * Splits a path into segments and marks which are parameters, so two routes can
 * be compared for shadowing rather than only for exact equality.
 */
function segmentsOf(path) {
  return path.split('/').filter(Boolean).map((segment) => ({
    literal: segment.startsWith(':') ? null : segment,
    isParam: segment.startsWith(':'),
  }));
}

/**
 * Whether `pattern` would swallow `candidate` — same arity, and every segment
 * either matches literally or is a parameter in the pattern.
 */
function shadows(pattern, candidate) {
  const a = segmentsOf(pattern);
  const b = segmentsOf(candidate);
  if (a.length !== b.length) return false;
  if (pattern === candidate) return false;

  let strictlyMoreGeneral = false;

  for (let index = 0; index < a.length; index += 1) {
    const segment = a[index];
    const other = b[index];

    if (segment.isParam) {
      // A parameter matches anything, including another parameter — two params
      // in the same position are equivalent, not a conflict. Shadowing only
      // happens where the pattern is a param and the candidate is a literal.
      if (!other.isParam) strictlyMoreGeneral = true;
      continue;
    }

    // A literal in the pattern must match exactly, or the paths never overlap.
    if (segment.literal !== other.literal) return false;
  }

  return strictlyMoreGeneral;
}

/** No two modules may claim the same path — routing would become order-dependent. */
export const routeCollisions = {
  name: 'route-collisions',
  description: 'No two modules claim or shadow the same route path (§24.5)',
  run(_sources, rootDir) {
    const violations = [];
    const manifests = loadManifests(rootDir);
    const owners = new Map();
    const all = [];

    for (const manifest of manifests) {
      const file = `apps/api/src/modules/${manifest.id}/${manifest.id}.manifest.ts`;
      for (const route of manifest.routes ?? []) {
        const existing = owners.get(route.path);
        if (existing && existing !== manifest.id) {
          violations.push(
            violation(file, 1, 'route-collisions', `"${route.path}" is claimed by both "${existing}" and "${manifest.id}"`),
          );
        } else {
          owners.set(route.path, manifest.id);
        }
        all.push({
          moduleId: manifest.id,
          path: route.path,
          file,
          shadows: route.shadows ?? [],
        });
      }
    }

    // Shadowing across modules: "/customers/:id" from one module swallows
    // "/customers/segments" from another, and whether the literal route is
    // reachable then depends on the router's precedence rules rather than on
    // anything either author declared. Within a single module this is a normal,
    // well-understood pattern, so only cross-module shadowing is reported.
    //
    // The exception is a DECLARED shadow. When the more specific route names the
    // general one in `shadows`, an author has stated which wins and the composer
    // registers in that order — the precedence is a reviewed decision rather
    // than an accident of discovery order. That is what the rule was protecting
    // against; it was never the nesting itself.
    for (const pattern of all) {
      for (const candidate of all) {
        if (pattern.moduleId === candidate.moduleId) continue;
        if (!shadows(pattern.path, candidate.path)) continue;
        if (candidate.shadows.includes(pattern.path)) continue;

        violations.push(
          violation(
            candidate.file,
            1,
            'route-collisions',
            `"${candidate.path}" is shadowed by "${pattern.path}" from module "${pattern.moduleId}" — ` +
              `declare shadows: ['${pattern.path}'] to take precedence deliberately, or change the path`,
          ),
        );
      }
    }

    // A declaration that names a route nothing owns is stale — usually the other
    // module renamed its path. Left unreported it reads as a live precedence
    // decision while protecting nothing.
    for (const route of all) {
      for (const shadowed of route.shadows) {
        const owner = all.find((other) => other.path === shadowed && other.moduleId !== route.moduleId);
        if (owner) continue;
        violations.push(
          violation(
            route.file,
            1,
            'route-collisions',
            `"${route.path}" declares it shadows "${shadowed}", which no other module declares`,
          ),
        );
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
