/**
 * Platform CLI · theme.mjs
 * `theme:check` and `theme:port` — the two answers to "will my theme run here?"
 *
 * A developer arriving with a theme written for another platform wants one of
 * two things, and which one is their call rather than ours:
 *
 *   check — tell me what to change and I will change it
 *   port  — change it for me, so I can read the diff and commit it
 *
 * Both read the same map and the same detection logic, so they cannot disagree.
 * A checker and a fixer that report different things is worse than having only
 * one of them.
 *
 * `check` also runs the template linter, because "will it run" and "is it
 * correct" are the same question to somebody porting a theme.
 * Layer: tooling.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Every `.liquid` file under a directory, depth first. */
function templates(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.name.endsWith('.liquid')) found.push(path);
    }
  };
  walk(root);
  return found;
}

/**
 * Loads the compiled storefront domain.
 *
 * From `dist` rather than source, so the CLI runs exactly the code the server
 * runs — a porting tool that behaved differently from the renderer would send
 * people in circles.
 */
async function domain(root) {
  const path = join(root, 'apps', 'api', 'dist', 'storefront', 'domain', 'index.js');
  return import(`file://${path}`);
}

function compatMapFrom(root, slug) {
  const path = join(root, 'apps', 'api', 'src', 'storefront', 'config', 'theme-compat.json');
  return { raw: JSON.parse(readFileSync(path, 'utf8')), slug };
}

export async function checkTheme(root, themeDir, colours) {
  const { green, red, dim, yellow } = colours;
  const { findForeignNames, resolveCompatMap, lintTemplate } = await domain(root);
  const { branding } = await import(`file://${join(root, 'packages/config/dist/index.js')}`);

  const { raw } = compatMapFrom(root, branding.slug);
  const map = resolveCompatMap(raw, branding.slug);

  const files = templates(themeDir);
  const foreign = [];
  const lint = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(themeDir, file);
    foreign.push(...findForeignNames(name, source, map));
    lint.push(...lintTemplate(name, source));
  }

  console.log(`\n${files.length} templates scanned in ${relative(root, themeDir) || themeDir}\n`);

  if (foreign.length === 0) {
    console.log(green('  No names from other platforms. This theme speaks our vocabulary.'));
  } else {
    // Grouped by name rather than listed per occurrence: a developer wants to
    // know "what do I rename", not to read the same line ninety times.
    const byName = new Map();
    for (const finding of foreign) {
      const entry = byName.get(finding.found) ?? { ...finding, count: 0, files: new Set() };
      entry.count++;
      entry.files.add(finding.file);
      byName.set(finding.found, entry);
    }

    console.log(yellow(`  ${byName.size} name(s) from another platform, ${foreign.length} use(s):\n`));
    for (const entry of byName.values()) {
      console.log(`    ${entry.found}  →  ${green(entry.replacement)}`);
      console.log(dim(`      ${entry.count} use(s) across ${entry.files.size} file(s)`));
      for (const file of [...entry.files].slice(0, 3)) console.log(dim(`        ${file}`));
      if (entry.files.size > 3) console.log(dim(`        … and ${entry.files.size - 3} more`));
    }
    console.log(dim('\n  Fix them all: platform theme:port <dir>'));
    console.log(dim('  Or render with compatibility mode on, and change nothing.'));
  }

  const errors = lint.filter((finding) => finding.severity === 'error');
  const warnings = lint.filter((finding) => finding.severity === 'warning');

  if (lint.length > 0) {
    console.log(`\n  Template issues: ${errors.length} error(s), ${warnings.length} warning(s)\n`);
    for (const finding of [...errors, ...warnings].slice(0, 12)) {
      const label = finding.severity === 'error' ? red('error') : yellow('warn ');
      console.log(`    ${label} ${finding.file}:${finding.line}  ${finding.rule}`);
      console.log(dim(`      ${finding.message}`));
      console.log(dim(`      → ${finding.suggestion}`));
    }
    if (lint.length > 12) console.log(dim(`    … and ${lint.length - 12} more`));
  }

  const blocking = errors.length > 0;
  console.log(
    blocking
      ? red('\nThis theme has errors that will render a broken page.')
      : green('\nNothing here will break a render.'),
  );

  return { foreign: foreign.length, errors: errors.length, warnings: warnings.length };
}

export async function portTheme(root, themeDir, colours, { dryRun }) {
  const { green, dim, yellow } = colours;
  const { portTemplate, resolveCompatMap } = await domain(root);
  const { branding } = await import(`file://${join(root, 'packages/config/dist/index.js')}`);

  const { raw } = compatMapFrom(root, branding.slug);
  const map = resolveCompatMap(raw, branding.slug);

  const files = templates(themeDir);
  let changedFiles = 0;
  let changes = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const result = portTemplate(source, map);
    if (result.changes === 0) continue;

    changedFiles++;
    changes += result.changes;
    console.log(`  ${dryRun ? dim('would edit') : green('edited')}  ${relative(themeDir, file)}  ${dim(`${result.changes} change(s)`)}`);
    if (!dryRun) writeFileSync(file, result.source);
  }

  if (changes === 0) {
    console.log(green('\n  Nothing to port — this theme already speaks our vocabulary.'));
    return { changedFiles: 0, changes: 0 };
  }

  console.log(
    dryRun
      ? yellow(`\n  ${changes} change(s) across ${changedFiles} file(s). Re-run without --dry-run to apply.`)
      : green(`\n  ${changes} change(s) across ${changedFiles} file(s).`),
  );
  if (!dryRun) console.log(dim('  Read the diff before committing — this edited the theme in place.'));

  return { changedFiles, changes };
}
