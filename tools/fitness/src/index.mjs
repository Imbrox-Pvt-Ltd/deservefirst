/**
 * Fitness · index.mjs
 * The fitness-suite runner. `platform check` runs exactly this, and so does CI —
 * so a green local check means a green pipeline, and violations are caught in
 * seconds rather than in review (§18.2).
 * Layer: tooling.
 */

import { loadSources } from './context.mjs';
import { routeRules } from './routes.mjs';
import { allRules } from './rules.mjs';
import { moduleSkeleton } from './structure.mjs';

const RULES = [...allRules, moduleSkeleton, ...routeRules];

export function runFitness(rootDir, options = {}) {
  const only = options.only ? new Set(options.only) : null;
  const sources = loadSources(rootDir);
  const results = [];

  for (const rule of RULES) {
    if (only && !only.has(rule.name)) continue;
    const violations = rule.run(sources, rootDir) ?? [];
    results.push({ rule: rule.name, description: rule.description, violations });
  }

  const total = results.reduce((sum, result) => sum + result.violations.length, 0);
  return { results, total, filesScanned: sources.length };
}

export function formatReport(report) {
  const lines = [];
  const failing = report.results.filter((result) => result.violations.length > 0);

  for (const result of report.results) {
    const status = result.violations.length === 0 ? 'PASS' : 'FAIL';
    const count = result.violations.length ? ` (${result.violations.length})` : '';
    lines.push(`  ${status.padEnd(4)}  ${result.rule}${count}`);
  }

  if (failing.length > 0) {
    lines.push('');
    for (const result of failing) {
      lines.push(`${result.rule} — ${result.description}`);
      for (const item of result.violations) {
        lines.push(`  ${item.file}:${item.line}  ${item.message}`);
      }
      lines.push('');
    }
  }

  lines.push(
    report.total === 0
      ? `\nAll fitness functions pass (${report.filesScanned} files scanned).`
      : `\n${report.total} violation${report.total === 1 ? '' : 's'} across ${failing.length} rule${failing.length === 1 ? '' : 's'}.`,
  );

  return lines.join('\n');
}

export { RULES };
