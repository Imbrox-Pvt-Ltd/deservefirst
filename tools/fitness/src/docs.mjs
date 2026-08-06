/**
 * Fitness · docs.mjs
 * The API reference must match the API.
 *
 * §26.2 says reference docs are generated so they cannot drift. Generating them
 * is only half of that promise — the other half is noticing when the committed
 * copy no longer matches what the code would produce. Without this rule, "we
 * generate the docs" quietly becomes "we generated the docs once".
 * Layer: tooling.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * The compiled drops are CommonJS and this file is a module.
 *
 * Built once here rather than inside the rule: a rule that constructs its own
 * loader on every run is a rule that pays for it on every run.
 */
const load = createRequire(import.meta.url);

import { API_DOC_PATH, apiDocumentIsCurrent } from '../../platform-cli/src/api-docs.mjs';

export const apiReferenceCurrent = {
  name: 'api-reference-current',
  description: 'The committed API reference matches the declarations (§26.2)',
  run(_sources, rootDir) {
    // Nothing to compare against before a build; the build step runs first in CI.
    if (!existsSync(join(rootDir, 'apps/api/dist/describe.js'))) return [];

    let verdict;
    try {
      verdict = apiDocumentIsCurrent(rootDir);
    } catch (error) {
      return [
        {
          file: API_DOC_PATH,
          line: 1,
          rule: 'api-reference-current',
          message: `could not be generated: ${error.message}`,
        },
      ];
    }

    if (verdict.current) return [];
    return [
      {
        file: API_DOC_PATH,
        line: 1,
        rule: 'api-reference-current',
        message: `${verdict.reason}. The reference travels with the change that caused it.`,
      },
    ];
  },
};

/**
 * Every controller the server mounts is also one the reference describes.
 *
 * There are two lists of controllers by necessity: the composition root builds
 * them with real services, and describe.ts builds them with stubs so the docs
 * can be generated without a database. Nothing forced the two to agree, and
 * when they disagreed the failure was silent in the worst direction — the
 * endpoint worked, so nobody noticed it was missing from the reference until an
 * integrator asked where it was. `api-reference-current` cannot catch this: a
 * route absent from BOTH the document and the generator is perfectly current.
 */
export const controllersAreDescribed = {
  name: 'controllers-are-described',
  description: 'Every controller the server mounts appears in describe.ts (§26.2)',
  run(_sources, rootDir) {
    const read = (path) => {
      const full = join(rootDir, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    };

    const composition = read('apps/api/src/composition-root.ts');
    const describe = read('apps/api/src/describe.ts');
    if (!composition || !describe) return [];

    // Controllers are constructed as `xController({` or `xController(unused)`,
    // always suffixed `Controller` by the naming rule the skeleton enforces.
    const named = (source) =>
      new Set([...source.matchAll(/\b([a-zA-Z][\w]*Controller)\s*\(/g)].map((match) => match[1]));

    const mounted = named(composition);
    const described = named(describe);

    const lines = composition.split('\n');
    return [...mounted]
      .filter((name) => !described.has(name))
      // Reported against the mount, which is the line that exists and can be
      // navigated to; the fix is one line in describe.ts and the message says so.
      .map((name) => ({
        file: 'apps/api/src/composition-root.ts',
        line: lines.findIndex((line) => line.includes(`${name}(`)) + 1,
        rule: 'controllers-are-described',
        message:
          `${name} is mounted here but never built in describe.ts, so none of its ` +
          'routes reach the API reference. Add `' + name + '(unused)` there.',
      }));
  },
};

/**
 * Every manifest on disk is actually loaded by the runtime.
 *
 * There are three lists of manifests by necessity — the composition root
 * registers them, describe.ts builds the reference from them, and the CLI reads
 * them from `dist` for db:sync. The CLI's was a hardcoded list until tonight and
 * silently skipped the app platform's tables entirely; nothing would have caught
 * that, and nothing yet catches the other two drifting.
 *
 * The failure is quiet in the worst direction: a module whose manifest exists
 * but is never registered contributes no routes, no permissions and no
 * navigation, and looks from the outside exactly like a module that has not
 * been written yet.
 */
export const manifestsAreRegistered = {
  name: 'manifests-are-registered',
  description: 'Every manifest on disk is registered and described (§14.1)',
  run(sources, rootDir) {
    const read = (path) => {
      const full = join(rootDir, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    };

    const composition = read('apps/api/src/composition-root.ts');
    const describe = read('apps/api/src/describe.ts');
    if (!composition || !describe) return [];

    const declared = sources
      .filter((source) => /\.manifest\.ts$/.test(source.relativePath))
      .map((source) => {
        // `catalog.manifest.ts` exports `catalogManifest`; core's file is named
        // `platform.manifest.ts` and exports `platformManifest`, so the export
        // name follows the FILE rather than the directory.
        const base = source.relativePath.split('/').pop().replace('.manifest.ts', '');
        return { path: source.relativePath, symbol: `${base}Manifest` };
      });

    const violations = [];
    for (const manifest of declared) {
      if (!composition.includes(`registry.register(${manifest.symbol})`)) {
        violations.push({
          file: manifest.path,
          line: 1,
          rule: 'manifests-are-registered',
          message:
            `${manifest.symbol} is never registered in composition-root.ts, so the runtime ` +
            'loads none of its routes, permissions or navigation.',
        });
      }
      if (!describe.includes(manifest.symbol)) {
        violations.push({
          file: manifest.path,
          line: 1,
          rule: 'manifests-are-registered',
          message:
            `${manifest.symbol} is never built in describe.ts, so nothing it declares ` +
            'reaches the generated API reference.',
        });
      }
    }

    return violations;
  },
};

/**
 * §26.2 again, for the storefront vocabulary.
 *
 * The object reference is generated from the drops, which means it is correct
 * the moment it is written and wrong the moment somebody adds a property
 * without regenerating. A reference people have learned not to trust is worse
 * than none: they stop reading it and go back to the source, which is the
 * situation it exists to fix.
 *
 * Synchronous and dependency-free on purpose — it re-renders from the compiled
 * drops and compares, so there is no second copy of the format to drift.
 */
export const storefrontObjectsCurrent = {
  name: 'storefront-objects-current',
  description: 'The committed storefront object reference matches the drops (§26.2)',
  run(_sources, rootDir) {
    const dropsPath = join(rootDir, 'apps/api/dist/storefront/domain/index.js');
    // Nothing to compare against before a build; the build runs first in CI.
    if (!existsSync(dropsPath)) return [];

    const docPath = 'docs/storefront-objects.md';
    const target = join(rootDir, docPath);

    let expected;
    try {
      const domain = load(dropsPath);
      const compatPath = join(rootDir, 'apps/api/src/storefront/config/theme-compat.json');
      const raw = JSON.parse(readFileSync(compatPath, 'utf8'));
      const { branding } = load(join(rootDir, 'packages/config/dist/index.js'));
      const aliases = domain.resolveCompatMap(raw, branding.slug).properties;
      expected = domain.renderObjectReference([...domain.declaredDrops().values()], aliases).markdown;
    } catch (error) {
      return [
        { file: docPath, line: 1, rule: 'storefront-objects-current',
          message: `could not be generated: ${error.message}` },
      ];
    }

    if (!existsSync(target)) {
      return [
        { file: docPath, line: 1, rule: 'storefront-objects-current',
          message: 'is missing — run `platform storefront:objects --write`' },
      ];
    }

    if (readFileSync(target, 'utf8') === expected) return [];

    return [
      { file: docPath, line: 1, rule: 'storefront-objects-current',
        message: 'is out of date — run `platform storefront:objects --write`' },
    ];
  },
};

export const docsRules = [
  apiReferenceCurrent,
  controllersAreDescribed,
  manifestsAreRegistered,
  storefrontObjectsCurrent,
];

