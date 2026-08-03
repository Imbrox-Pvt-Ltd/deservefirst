/**
 * Fitness · structure.mjs
 * The Module Standard's folder law (§14.1). Every module has the same skeleton,
 * every module exports a manifest — if it isn't declared, the platform doesn't
 * load it. Checked structurally here; the manifest's *contents* are validated
 * against its capability contracts at boot and by `platform doctor`.
 * Layer: tooling.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
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
