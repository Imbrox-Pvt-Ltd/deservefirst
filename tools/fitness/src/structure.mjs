/**
 * Fitness · structure.mjs
 * The Module Standard's folder law (§14.1). Every module has the same skeleton,
 * every module exports a manifest — if it isn't declared, the platform doesn't
 * load it. Checked structurally here; the manifest's *contents* are validated
 * against its capability contracts at boot and by `platform doctor`.
 * Layer: tooling.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { violation } from './context.mjs';

/** The eight folders every module must have, plus its README (§14.1). */
export const REQUIRED_MODULE_DIRS = [
  'domain',
  'application',
  'infrastructure',
  'api',
  'events',
  'contracts',
  'config',
  'tests',
];

export const REQUIRED_MODULE_FILES = ['README.md'];

export function listModules(rootDir) {
  const modulesDir = join(rootDir, 'apps/api/src/modules');
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir).filter((entry) => {
    try {
      return statSync(join(modulesDir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

export const moduleSkeleton = {
  name: 'module-skeleton',
  description: 'Every module has the mandated folder skeleton and a manifest (§14.1)',
  run(_sources, rootDir) {
    const violations = [];
    const modulesDir = join(rootDir, 'apps/api/src/modules');

    for (const moduleName of listModules(rootDir)) {
      const moduleDir = join(modulesDir, moduleName);
      const relative = `apps/api/src/modules/${moduleName}`;

      for (const dir of REQUIRED_MODULE_DIRS) {
        if (!existsSync(join(moduleDir, dir))) {
          violations.push(
            violation(relative, 1, 'module-skeleton', `missing required folder "${dir}/"`),
          );
        }
      }

      for (const file of REQUIRED_MODULE_FILES) {
        if (!existsSync(join(moduleDir, file))) {
          violations.push(
            violation(relative, 1, 'module-skeleton', `missing required file "${file}"`),
          );
        }
      }

      const manifestPath = join(moduleDir, `${moduleName}.manifest.ts`);
      if (!existsSync(manifestPath)) {
        violations.push(
          violation(
            relative,
            1,
            'module-skeleton',
            `missing "${moduleName}.manifest.ts" — a module the platform cannot read is a module it will not load`,
          ),
        );
      }

      if (!existsSync(join(moduleDir, 'contracts', 'index.ts'))) {
        violations.push(
          violation(
            relative,
            1,
            'module-skeleton',
            'contracts/index.ts is missing — other modules would have nothing to import',
          ),
        );
      }
    }

    return violations;
  },
};

/**
 * The Node version is pinned, and every place that states it agrees.
 *
 * Three files have to say the same thing — `.nvmrc` for developers, `engines`
 * for the installer, and the CI workflow for the pipeline — and nothing stops
 * them drifting apart except noticing. They HAD drifted: `engines` said
 * `>=22` with no upper bound and CI said `node-version: 22`, which floats to
 * whatever 22.x is newest, so CI and a developer's machine could differ by a
 * minor version with nothing reporting it.
 *
 * That is the "works on my machine" class of difference, and it is invisible
 * until a subtle behaviour change makes it very visible.
 */
export const runtimeIsPinned = {
  name: 'runtime-is-pinned',
  description: 'One Node version, stated identically everywhere it is stated',
  run(_sources, rootDir) {
    const violations = [];
    const read = (path) => {
      const full = join(rootDir, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    };

    const nvmrc = read('.nvmrc');
    if (!nvmrc) {
      return [
        violation('.nvmrc', 1, 'runtime-is-pinned',
          'missing. It is what `nvm use` and CI both read; without it every ' +
          'developer picks their own Node version.'),
      ];
    }

    const pinned = nvmrc.trim();
    if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
      violations.push(
        violation('.nvmrc', 1, 'runtime-is-pinned',
          `"${pinned}" is not an exact version. A range here defeats the point — ` +
          'the file exists so that everyone runs the same build.'),
      );
      return violations;
    }

    const major = pinned.split('.')[0];

    // `engines` must bound the major, or a future Node installs silently.
    const manifest = JSON.parse(read('package.json') ?? '{}');
    const declared = manifest.engines?.node ?? '';
    if (!declared.includes(pinned) || !declared.includes(`<${Number(major) + 1}`)) {
      violations.push(
        violation('package.json', 1, 'runtime-is-pinned',
          `engines.node is "${declared}" but .nvmrc pins ${pinned}. It should be ` +
          `">=${pinned} <${Number(major) + 1}" — patches land freely, a new major does not.`),
      );
    }

    /**
     * `engine-strict` is what makes any of this enforceable.
     *
     * pnpm treats `engines` as advisory without it, so the range is a comment
     * that installs ignore — which is how a version gate silently does nothing.
     */
    const npmrc = read('.npmrc') ?? '';
    if (!/^\s*engine-strict\s*=\s*true/m.test(npmrc)) {
      violations.push(
        violation('.npmrc', 1, 'runtime-is-pinned',
          'engine-strict=true is missing, so pnpm treats engines as advisory and ' +
          'the version range never actually blocks an install.'),
      );
    }

    // CI must read the file rather than restate the version.
    const workflow = read('.github/workflows/ci.yml');
    if (workflow && !workflow.includes('node-version-file: .nvmrc')) {
      violations.push(
        violation('.github/workflows/ci.yml', 1, 'runtime-is-pinned',
          'CI states its own Node version instead of reading .nvmrc, so the two ' +
          'can drift apart without anything reporting it.'),
      );
    }

    return violations;
  },
};
