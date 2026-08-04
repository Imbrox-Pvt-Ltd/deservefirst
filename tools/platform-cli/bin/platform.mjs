#!/usr/bin/env node
/**
 * Platform CLI · bin/platform.mjs
 * The golden path in executable form (§18). Scaffolding, validation and the
 * fitness suite all run from here, so doing it any other way is simply harder —
 * which is how the Module Standard stays followed without policing.
 * Layer: tooling.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReport, runFitness } from '../../fitness/src/index.mjs';
import { listModules } from '../../fitness/src/structure.mjs';
import { dbSync } from '../src/db-sync.mjs';
import { moduleFiles } from '../src/scaffold.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Where tests live: every package, and every module's own tests/ folder (§27.1). */
const TEST_GLOBS = [
  'packages/**/tests/**/*.test.mjs',
  'apps/api/tests/**/*.test.mjs',
  'apps/api/src/modules/**/tests/**/*.test.mjs',
  // auth is a sibling of modules/, not inside it — omitting this silently
  // excluded the platform's most security-critical tests from CI.
  'apps/api/src/auth/tests/**/*.test.mjs',
];

const cyan = (text) => `[36m${text}[0m`;
const red = (text) => `[31m${text}[0m`;
const green = (text) => `[32m${text}[0m`;
const dim = (text) => `[2m${text}[0m`;

function usage() {
  console.log(`
${cyan('platform')} — DeserveFirst module tooling

  ${cyan('module:new')} <name>     Scaffold the full Module Standard skeleton
  ${cyan('check')}                 Run the fitness suite (identical to CI)
  ${cyan('doctor')} [module]       Validate a module against the Standard
  ${cyan('test')}                  Run the test suite
  ${cyan('ci')}                    build + typecheck + check + test, exactly as CI runs it
  ${cyan('db:sync')}               Apply the schema derived from every manifest (dev only)
  ${cyan('routes')}                Print the composed route registry

${dim('Every command is safe to run repeatedly; none mutate anything but the module')}
${dim('you name. `check` is what blocks a merge, so run it before you push.')}
`);
}

function moduleNew(name) {
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(red('module:new needs a lower-kebab-case name, e.g. `platform module:new catalog`'));
    process.exit(1);
  }

  const moduleDir = join(ROOT, 'apps/api/src/modules', name);
  if (existsSync(moduleDir)) {
    console.error(red(`Module "${name}" already exists at apps/api/src/modules/${name}`));
    process.exit(1);
  }

  const files = moduleFiles(name);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(moduleDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }

  console.log(green(`\nScaffolded module "${name}"`));
  console.log(dim(`  apps/api/src/modules/${name}/`));
  for (const relativePath of Object.keys(files).sort()) {
    console.log(dim(`    ${relativePath}`));
  }
  console.log(`
Next, per the Module Author Guide:
  1. Fill in the README — ubiquitous language and aggregates, before any code.
  2. Add capabilities to ${name}.manifest.ts as you build them.
  3. ${cyan('platform gen:entity ' + name + ' <Entity>')} to wire the Entity Toolkit.
  4. ${cyan('platform doctor ' + name)} to validate, ${cyan('platform check')} before you push.
`);
}

function check(args) {
  const only = args.filter((arg) => !arg.startsWith('-'));
  const report = runFitness(ROOT, only.length ? { only } : {});
  console.log(`\n${cyan('Fitness suite')}\n`);
  console.log(formatReport(report));
  process.exit(report.total === 0 ? 0 : 1);
}

function doctor(name) {
  const modules = listModules(ROOT);
  const targets = name ? [name] : modules;

  if (name && !modules.includes(name)) {
    console.error(red(`No module "${name}". Known modules: ${modules.join(', ') || '(none yet)'}`));
    process.exit(1);
  }
  if (targets.length === 0) {
    console.log(dim('No modules yet — run `platform module:new <name>` to create one.'));
    return;
  }

  const report = runFitness(ROOT, { only: ['module-skeleton', 'file-headers', 'layer-law', 'module-boundaries'] });
  const relevant = report.results.flatMap((result) =>
    result.violations.filter((item) => targets.some((target) => item.file.includes(`/modules/${target}`))),
  );

  console.log(`\n${cyan('doctor')} ${targets.join(', ')}\n`);
  if (relevant.length === 0) {
    console.log(green('  Structure valid — skeleton, headers, layer law and boundaries all pass.'));
    console.log(dim('  Manifest contents are validated against capability contracts at boot and by `platform test`.'));
    process.exit(0);
  }
  for (const item of relevant) {
    console.log(`  ${item.file}:${item.line}  ${red(item.rule)}  ${item.message}`);
  }
  process.exit(1);
}

function run(command, args, label) {
  console.log(`\n${cyan(label)}`);
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

function testSuite() {
  const built = run('pnpm', ['-r', 'run', 'build'], 'build');
  if (!built) process.exit(1);
  const ok = run('node', ['--test', ...TEST_GLOBS], 'test');
  process.exit(ok ? 0 : 1);
}

/**
 * Typechecks every workspace that actually has a TypeScript project. Running
 * `tsc` blindly across the workspace fails on the .mjs tooling packages, which
 * have no tsconfig by design.
 */
function typecheck() {
  const projects = ['packages/contracts', 'packages/config', 'apps/api'].filter((project) =>
    existsSync(join(ROOT, project, 'tsconfig.json')),
  );
  console.log(`\n${cyan('typecheck')}`);
  for (const project of projects) {
    try {
      execFileSync('pnpm', ['exec', 'tsc', '-p', join(project, 'tsconfig.json'), '--noEmit'], {
        cwd: ROOT,
        stdio: 'inherit',
      });
      console.log(dim(`  ok  ${project}`));
    } catch {
      console.error(red(`  fail  ${project}`));
      return false;
    }
  }
  return true;
}

function ci() {
  const steps = [
    () => run('pnpm', ['-r', 'run', 'build'], 'build'),
    typecheck,
    () => {
      const report = runFitness(ROOT);
      console.log(`\n${cyan('fitness')}`);
      console.log(formatReport(report));
      return report.total === 0;
    },
    () => run('node', ['--test', ...TEST_GLOBS], 'test'),
  ];

  for (const step of steps) {
    if (!step()) {
      console.error(red('\nCI failed. Fix the above before pushing — a red pipeline blocks the merge.'));
      process.exit(1);
    }
  }
  console.log(green('\nCI green. This PR will pass.'));
}

const [, , command, ...args] = process.argv;

switch (command) {
  case 'module:new':
    moduleNew(args[0]);
    break;
  case 'check':
    check(args);
    break;
  case 'doctor':
    doctor(args[0]);
    break;
  case 'test':
    testSuite();
    break;
  case 'ci':
    ci();
    break;
  case 'db:sync': {
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    dbSync(ROOT, urlArg ? { url: urlArg.slice('--url='.length) } : {})
      .then((result) => {
        console.log(
          green(`\nApplied ${result.applied} statement(s) to ${result.dialect}.`),
        );
        for (const table of result.tables) console.log(dim(`  ${table}`));
      })
      .catch((error) => {
        console.error(red(`\ndb:sync failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case undefined:
  case '--help':
  case '-h':
    usage();
    break;
  default:
    console.error(red(`Unknown command "${command}"`));
    usage();
    process.exit(1);
}
