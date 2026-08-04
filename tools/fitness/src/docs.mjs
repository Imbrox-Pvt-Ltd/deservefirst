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

export const docsRules = [apiReferenceCurrent, controllersAreDescribed];
