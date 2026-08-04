/**
 * Platform CLI · api-docs.mjs
 * Writes the generated API reference to disk.
 *
 * Committed rather than produced only at deploy time, so a change to the API
 * shows up as a change to the reference in the same diff — which is where a
 * reviewer will actually notice that a field became public or an endpoint
 * disappeared. `platform check` regenerates and compares, so the committed file
 * cannot be stale.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

export const API_DOC_PATH = 'docs/api/openapi.json';
const API_VERSION = '2026-01';
const SERVER_URL = 'https://api.deservefirst.example';

/** The document, built from the built module tree — never from source scanning. */
export function buildApiDocument(root) {
  const describePath = join(root, 'apps/api/dist/describe.js');
  if (!existsSync(describePath)) {
    throw new Error('Build first — `pnpm --filter @deservefirst/api run build`.');
  }

  const { generateOpenApi } = require(describePath);
  return generateOpenApi(API_VERSION, SERVER_URL);
}

export function writeApiDocument(root) {
  const document = buildApiDocument(root);
  const target = join(root, API_DOC_PATH);

  mkdirSync(dirname(target), { recursive: true });
  // Trailing newline and stable key order so the diff is readable and the
  // comparison in `check` is exact.
  const serialised = `${JSON.stringify(document, null, 2)}\n`;

  const before = existsSync(target) ? readFileSync(target, 'utf8') : null;
  writeFileSync(target, serialised, 'utf8');

  return {
    path: API_DOC_PATH,
    changed: before !== serialised,
    operations: Object.values(document.paths).reduce(
      (total, methods) => total + Object.keys(methods).length,
      0,
    ),
    schemas: Object.keys(document.components.schemas).length,
  };
}

/** True when the committed reference matches what the code would generate now. */
export function apiDocumentIsCurrent(root) {
  const target = join(root, API_DOC_PATH);
  if (!existsSync(target)) return { current: false, reason: 'has never been generated' };

  const expected = `${JSON.stringify(buildApiDocument(root), null, 2)}\n`;
  const actual = readFileSync(target, 'utf8');
  return actual === expected
    ? { current: true }
    : { current: false, reason: 'is out of date — run `platform docs:api`' };
}
