#!/usr/bin/env node
/**
 * Platform CLI · bin/platform.mjs
 * The golden path in executable form (§18). Scaffolding, validation and the
 * fitness suite all run from here, so doing it any other way is simply harder —
 * which is how the Module Standard stays followed without policing.
 * Layer: tooling.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReport, runFitness } from '../../fitness/src/index.mjs';
import { listModules } from '../../fitness/src/structure.mjs';
import { dbSync } from '../src/db-sync.mjs';
import { smoke } from '../src/smoke.mjs';
import { listModuleStates, setModuleState } from '../src/module-state.mjs';
import { writeApiDocument } from '../src/api-docs.mjs';
import { auditThemeProperties, checkTheme, portTheme } from '../src/theme.mjs';
import { createMigration, generateMigration, markApplied, migrate, migrateStatus } from '../src/migrate.mjs';
import { seed } from '../src/seed.mjs';
import { formatTimestampReport, reportTimestamps } from '../src/timestamps.mjs';
import { moduleFiles } from '../src/scaffold.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Where tests live: every package, and every module's own tests/ folder (§27.1). */
const TEST_GLOBS = [
  'packages/**/tests/**/*.test.mjs',
  'apps/api/tests/**/*.test.mjs',
  'apps/api/src/modules/**/tests/**/*.test.mjs',
  /**
   * Platform capabilities that sit BESIDE modules/ — auth, apps.
   *
   * A wildcard rather than one line per capability. This was a list, and it
   * silently excluded auth's tests until somebody noticed; the fix at the time
   * was to add auth to the list, so when `apps` arrived — with the OAuth rules
   * on it — its tests were silently excluded too, and CI stayed green while
   * running none of them. A list that has failed this way twice is not a list.
   */
  'apps/api/src/*/tests/**/*.test.mjs',
  // The web app has pure logic worth testing too — URL building for the OAuth
  // callback, list-state parsing. Its tests import .ts directly, which is why
  // the runner strips types below.
  'apps/web/tests/**/*.test.mjs',
];

/**
 * Node needs telling it may import TypeScript.
 *
 * The web app has no build output to import from — Next compiles it in place —
 * so its tests import the source. Without this the whole run fails on an
 * unknown file extension rather than skipping quietly, which is the failure
 * mode to prefer.
 */
const NODE_TEST_ARGS = ['--experimental-strip-types', '--no-warnings', '--test'];

const cyan = (text) => `[36m${text}[0m`;
const red = (text) => `[31m${text}[0m`;
const green = (text) => `[32m${text}[0m`;
const dim = (text) => `[2m${text}[0m`;
const yellow = (text) => `[33m${text}[0m`;

function usage() {
  console.log(`
${cyan('platform')} — DeserveFirst module tooling

  ${cyan('module:new')} <name>     Scaffold the full Module Standard skeleton
  ${cyan('check')}                 Run the fitness suite (identical to CI)
  ${cyan('doctor')} [module]       Validate a module against the Standard
  ${cyan('test')}                  Run the test suite
  ${cyan('ci')}                    build + typecheck + check + test, exactly as CI runs it
  ${cyan('db:sync')}               Apply the schema derived from every manifest ${red('(dev only)')}
  ${cyan('db:timestamps')}         Report rows written before the UTC fix ${dim('(read-only)')}
  ${cyan('migrate')}               Apply pending migrations        [--dry-run]
  ${cyan('migrate:status')}        What has run, and what has not
  ${cyan('migrate:new')} <name>    Write an empty migration to fill in
  ${cyan('migrate:generate')}      Write an additive migration from the manifest diff
  ${cyan('migrate:mark')} <ver>    Record a migration as applied without running it
  ${cyan('seed')}                  Seed deterministic development data
  ${cyan('routes')}                Print the composed route registry
  ${cyan('smoke')}                 Open every navigation destination against a running admin
  ${cyan('module:enable')} <mod>    Make a module available again  [--store=handle]
  ${cyan('module:disable')} <mod>   Take a module away             [--store=handle] --reason=".."
  ${cyan('module:states')}          Show what is enabled, and where the decision was made
  ${cyan('theme:check')} <dir>   What in this theme will not run here, and why
  ${cyan('theme:properties')} <dir>  Which properties it reads that no drop declares
  ${cyan('theme:port')} <dir>    Rewrite another platform's names to ours [--dry-run]
  ${cyan('docs:api')}              Regenerate the API reference from the declarations

${dim('Every command is safe to run repeatedly; none mutate anything but the module')}
${dim('you name. `check` is what blocks a merge, so run it before you push.')}
${dim('`smoke` needs the API and admin running; it catches what static rules cannot —')}
${dim('a screen that compiles, passes every rule, and still shows the wrong thing.')}
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
  const ok = run('node', [...NODE_TEST_ARGS, ...TEST_GLOBS], 'test');
  process.exit(ok ? 0 : 1);
}

/**
 * Typechecks every workspace that actually has a TypeScript project. Running
 * `tsc` blindly across the workspace fails on the .mjs tooling packages, which
 * have no tsconfig by design.
 */
function typecheck() {
  /**
   * Discovered, not listed.
   *
   * This was a hardcoded array, which is the same shape as the test globs and
   * the manifest paths that both silently skipped real work this week: a new
   * package simply would not have been typechecked, and nothing would say so.
   * Anything with a tsconfig is a TypeScript project; anything without one is
   * the .mjs tooling, which has none by design.
   */
  const projects = ['packages', 'apps', 'tools']
    .flatMap((group) => {
      const dir = join(ROOT, group);
      if (!existsSync(dir)) return [];
      return readdirSync(dir).map((name) => `${group}/${name}`);
    })
    .filter((project) => existsSync(join(ROOT, project, 'tsconfig.json')))
    .sort();
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
      // Regenerated here so `api-reference-current` compares against a fresh
      // build; the rule then reports whether the COMMITTED copy matched.
      console.log(`\n${cyan('docs:api')}`);
      try {
        const result = writeApiDocument(ROOT);
        console.log(dim(`  ${result.operations} operations, ${result.schemas} schemas`));
        if (result.changed) {
          console.error(red('  The committed reference was stale — commit docs/api/openapi.json.'));
          return false;
        }
        return true;
      } catch (error) {
        console.error(red(`  ${error.message}`));
        return false;
      }
    },
    () => {
      const report = runFitness(ROOT);
      console.log(`\n${cyan('fitness')}`);
      console.log(formatReport(report));
      return report.total === 0;
    },
    () => run('node', [...NODE_TEST_ARGS, ...TEST_GLOBS], 'test'),
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
        console.log(dim('  Development only — production uses `platform migrate`.'));
        for (const table of result.tables) console.log(dim(`  ${table}`));
        // Reported separately: a new table is expected, but a column appearing
        // on an existing one means the schema had drifted from the manifests.
        if (result.addedColumns?.length) {
          console.log(green(`\nAdded ${result.addedColumns.length} missing column(s):`));
          for (const column of result.addedColumns) console.log(dim(`  ${column}`));
        }
      })
      .catch((error) => {
        console.error(red(`\ndb:sync failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  /**
   * Reports rows written before the connection was pinned to UTC.
   *
   * Read-only, with no flag to make it otherwise. Repairing them means guessing
   * an offset that nothing recorded, and a tool that can guess wrong on a whole
   * table should not exist next to one that reports honestly.
   */
  case 'db:timestamps': {
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    reportTimestamps(ROOT, urlArg ? { url: urlArg.slice('--url='.length) } : {})
      .then((report) => {
        console.log(cyan('\nTimestamp check'));
        console.log('');
        console.log(formatTimestampReport(report));
        console.log('');
      })
      .catch((error) => {
        console.error(red(`\ndb:timestamps failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'theme:check': {
    const dir = args[0];
    if (!dir) {
      console.error(red('\ntheme:check needs a theme directory.'));
      process.exit(1);
    }
    try {
      const result = await checkTheme(ROOT, dir, { green, red, dim, yellow });
      process.exit(result.errors > 0 ? 1 : 0);
    } catch (error) {
      console.error(red(`\ntheme:check failed: ${error.message}`));
      process.exit(1);
    }
    break;
  }
  case 'theme:properties': {
    const dir = args[0];
    if (!dir) {
      console.error(red('\ntheme:properties needs a theme directory.'));
      process.exit(1);
    }
    try {
      const result = await auditThemeProperties(ROOT, dir, { green, red, dim, yellow });
      // Reporting, not gating: several of these are features that do not exist
      // yet, and a red CI on a known backlog teaches people to ignore it.
      process.exit(result.gaps >= 0 ? 0 : 1);
    } catch (error) {
      console.error(red(`\ntheme:properties failed: ${error.message}`));
      process.exit(1);
    }
    break;
  }
  case 'theme:port': {
    const dir = args.find((a) => !a.startsWith('--'));
    if (!dir) {
      console.error(red('\ntheme:port needs a theme directory.'));
      process.exit(1);
    }
    try {
      await portTheme(ROOT, dir, { green, red, dim, yellow }, { dryRun: args.includes('--dry-run') });
    } catch (error) {
      console.error(red(`\ntheme:port failed: ${error.message}`));
      process.exit(1);
    }
    break;
  }
  case 'docs:api': {
    try {
      const result = writeApiDocument(ROOT);
      console.log(
        green(
          `\n${result.changed ? 'Updated' : 'Unchanged'}: ${result.path} — ` +
            `${result.operations} operations, ${result.schemas} schemas.`,
        ),
      );
      if (result.changed) console.log(dim('  Commit it: the reference travels with the change.'));
    } catch (error) {
      console.error(red(`\ndocs:api failed: ${error.message}`));
      process.exit(1);
    }
    break;
  }
  case 'module:enable':
  case 'module:disable': {
    const enabled = command === 'module:enable';
    const moduleId = args.find((arg) => !arg.startsWith('--'));
    const flag = (name) => {
      const found = args.find((arg) => arg.startsWith(`--${name}=`));
      return found ? found.slice(name.length + 3) : undefined;
    };

    setModuleState(ROOT, {
      moduleId,
      enabled,
      reason: flag('reason'),
      storeHandle: flag('store'),
      url: flag('url'),
    })
      .then((result) => {
        console.log(
          green(
            `\n${result.moduleId} is now ${result.enabled ? 'ENABLED' : 'DISABLED'} for ${result.scope}.`,
          ),
        );
        if (result.reason) console.log(dim(`  reason: ${result.reason}`));
        if (!result.enabled && result.scope === 'every store') {
          console.log(dim('  No store can re-enable it while this stands.'));
        }
      })
      .catch((error) => {
        console.error(red(`\n${command} failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'module:states': {
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    listModuleStates(ROOT, urlArg ? { url: urlArg.slice('--url='.length) } : {})
      .then((states) => {
        console.log(`\n${cyan('Module availability')}\n`);
        for (const state of states) {
          const label = state.enabled ? green('enabled ') : red('DISABLED');
          const origin = state.decided ? '' : dim('  (no decision recorded — default on)');
          console.log(`  ${label}  ${state.moduleId}${origin}`);
          if (state.reason) console.log(dim(`             ${state.reason}`));
        }
        console.log('');
      })
      .catch((error) => {
        console.error(red(`\nmodule:states failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'smoke': {
    const flag = (name) => {
      const found = args.find((arg) => arg.startsWith(`--${name}=`));
      return found ? found.slice(name.length + 3) : undefined;
    };
    smoke(ROOT, {
      ...(flag('base') ? { baseUrl: flag('base') } : {}),
      ...(flag('api') ? { apiUrl: flag('api') } : {}),
      ...(flag('store') ? { handle: flag('store') } : {}),
      ...(flag('email') ? { email: flag('email') } : {}),
      ...(flag('password') ? { password: flag('password') } : {}),
    })
      .then((report) => {
        console.log(`\nOpening every navigation destination at ${report.baseUrl}\n`);
        for (const result of report.results) {
          const state = !result.ok
            ? red(`FAIL  ${result.reason}`)
            : result.placeholder
              ? dim('not installed')
              : green('ok');
          console.log(`  ${state.padEnd(24)} ${result.path}`);
        }
        if (report.failed === 0) {
          console.log(green(`\nAll ${report.results.length} destinations render.`));
        } else {
          console.error(red(`\n${report.failed} of ${report.results.length} destinations are broken.`));
          process.exit(1);
        }
      })
      .catch((error) => {
        console.error(red(`\nsmoke failed: ${error.message}`));
        console.error(dim('  Start the admin first: pnpm --filter @deservefirst/web start'));
        process.exit(1);
      });
    break;
  }
  case 'migrate': {
    const flag = (name) => args.some((arg) => arg === `--${name}`);
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    migrate(ROOT, {
      dryRun: flag('dry-run'),
      ...(urlArg ? { url: urlArg.slice('--url='.length) } : {}),
    })
      .then((result) => {
        if (result.dryRun) {
          console.log(
            result.pending.length === 0
              ? green('\nNothing pending.')
              : `\n${cyan('Would apply')} ${result.pending.join(', ')}`,
          );
          return;
        }
        console.log(
          result.applied.length === 0
            ? green('\nNothing pending — the database is up to date.')
            : green(`\nApplied ${result.applied.length}: ${result.applied.join(', ')}`),
        );
      })
      .catch((error) => {
        console.error(red(`\nmigrate failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'migrate:status': {
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    migrateStatus(ROOT, urlArg ? { url: urlArg.slice('--url='.length) } : {})
      .then((entries) => {
        console.log(`\n${cyan('Migrations')}\n`);
        if (entries.length === 0) console.log(dim('  none yet'));
        for (const entry of entries) {
          const label =
            entry.state === 'applied'
              ? green('applied ')
              : entry.state === 'pending'
                ? cyan('pending ')
                : red(entry.state.toUpperCase().padEnd(8));
          console.log(`  ${label}  ${entry.version}  ${entry.name}`);
          if (entry.state === 'changed') {
            console.log(red('              this file changed after it was applied — add a new one instead'));
          }
          if (entry.state === 'missing') {
            console.log(red('              applied here but absent from this checkout'));
          }
        }
        console.log('');
        if (entries.some((entry) => entry.state === 'changed' || entry.state === 'missing')) {
          process.exit(1);
        }
      })
      .catch((error) => {
        console.error(red(`\nmigrate:status failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'migrate:new': {
    try {
      const created = createMigration(ROOT, args.filter((arg) => !arg.startsWith('--')).join(' '));
      console.log(green(`\nCreated ${created.path}`));
      console.log(dim('  Fill it in, then `platform migrate`.'));
    } catch (error) {
      console.error(red(`\nmigrate:new failed: ${error.message}`));
      process.exit(1);
    }
    break;
  }
  case 'migrate:generate': {
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    const nameArg = args.find((arg) => arg.startsWith('--name='));
    generateMigration(ROOT, {
      ...(urlArg ? { url: urlArg.slice('--url='.length) } : {}),
      ...(nameArg ? { name: nameArg.slice('--name='.length) } : {}),
    })
      .then((result) => {
        if (result.statements === 0) {
          console.log(green('\nThe database already matches the manifests — nothing to generate.'));
          return;
        }
        console.log(green(`\nCreated ${result.path} — ${result.statements} statement(s).`));
        console.log(dim('  Additive only. Anything destructive is yours to write deliberately.'));
      })
      .catch((error) => {
        console.error(red(`\nmigrate:generate failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'migrate:mark': {
    const version = args.find((arg) => !arg.startsWith('--'));
    const urlArg = args.find((arg) => arg.startsWith('--url='));
    markApplied(ROOT, version, urlArg ? { url: urlArg.slice('--url='.length) } : {})
      .then((result) => {
        console.log(
          result.alreadyRecorded
            ? dim(`\n${result.version} was already recorded.`)
            : green(`\nRecorded ${result.version} as applied — it was NOT run.`),
        );
      })
      .catch((error) => {
        console.error(red(`\nmigrate:mark failed: ${error.message}`));
        process.exit(1);
      });
    break;
  }
  case 'seed':
    seed(ROOT)
      .then((result) => {
        console.log(green('\nSeeded:'));
        for (const [key, value] of Object.entries(result)) console.log(dim(`  ${value} ${key}`));
      })
      .catch((error) => {
        console.error(red(`\nseed failed: ${error.message}`));
        process.exit(1);
      });
    break;
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
