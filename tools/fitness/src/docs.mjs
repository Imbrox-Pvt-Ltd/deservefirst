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

import { existsSync } from 'node:fs';
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

export const docsRules = [apiReferenceCurrent];
