/**
 * Fitness · context.mjs
 * Shared source-tree walker and parsing helpers for the fitness suite. Kept
 * dependency-free and un-compiled so `platform check` runs in a second — a rule
 * developers wait on is a rule developers skip.
 * Layer: tooling.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', '.next', '.git', 'coverage',
  'out', 'recording', 'REQUIREMENT', 'PLAN', '.claude',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** Files exempt from the header rule: generated or config-only. */
const HEADER_EXEMPT = /(\.d\.ts|next-env\.d\.ts)$/;

export function walkSourceFiles(rootDir) {
  const files = [];

  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        visit(full);
      } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
        files.push(full);
      }
    }
  };

  visit(rootDir);
  return files;
}

export function loadSources(rootDir) {
  return walkSourceFiles(rootDir).map((path) => ({
    path,
    relativePath: relative(rootDir, path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
    exemptFromHeader: HEADER_EXEMPT.test(path),
  }));
}

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g;
const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractImports(text) {
  const specifiers = [];
  for (const match of text.matchAll(IMPORT_PATTERN)) {
    if (match[1]) specifiers.push(match[1]);
  }
  for (const match of text.matchAll(REQUIRE_PATTERN)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Identifies which module and which layer a file belongs to, from its path.
 * Returns null for files outside the module tree.
 */
export function classify(relativePath) {
  const moduleMatch = /^apps\/api\/src\/modules\/([^/]+)\/([^/]+)/.exec(relativePath);
  if (moduleMatch) {
    return { kind: 'module', module: moduleMatch[1], layer: moduleMatch[2] };
  }
  const coreMatch = /^apps\/api\/src\/core\/([^/]+)/.exec(relativePath);
  if (coreMatch) {
    return { kind: 'core', module: 'core', layer: coreMatch[1] };
  }
  if (relativePath.startsWith('apps/api/src/auth/')) {
    return { kind: 'core', module: 'auth', layer: 'auth' };
  }
  return null;
}

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function violation(file, line, rule, message) {
  return { file, line, rule, message };
}
