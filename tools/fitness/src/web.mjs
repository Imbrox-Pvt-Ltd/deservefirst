/**
 * Fitness · web.mjs
 * Rules for the admin app's route tree and its client boundary.
 *
 * Both of these exist because a defect got past a green pipeline and was only
 * found by opening the page in a browser. A build that compiles is not evidence
 * that a screen renders, and neither is a passing test suite when nothing tests
 * the wiring between the router and the files it dispatches to.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function violation(file, line, rule, message) {
  return { file, line, rule, message };
}

const APP_DIR = 'apps/web/app';

/** Whether a module opts into the client bundle. */
function isClientModule(text) {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use client['"]/.test(text);
}

/** Resolves a relative import to a file in the source set. */
function resolveRelative(fromRelativePath, specifier, byPath) {
  if (!specifier.startsWith('.')) return null;

  const fromDir = fromRelativePath.slice(0, fromRelativePath.lastIndexOf('/'));
  const parts = [...fromDir.split('/'), ...specifier.split('/')];
  const stack = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }

  const base = stack.join('/');
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}

/**
 * A server component may only import COMPONENTS from a client module.
 *
 * Everything exported from a `'use client'` file becomes a client reference. A
 * component survives that — the server renders a placeholder and the browser
 * fills it in — but a plain function does not: calling it on the server throws
 * "attempted to call X() from the server". That is a runtime failure on every
 * request, and the build reports nothing, because nothing about it is a type
 * error. It is distinguished here by the only signal available without running
 * the code: components are capitalised and functions are not.
 */
/**
 * Polaris components need React context, which a server component cannot supply.
 *
 * Read out of `packages/ui/src/primitives.ts` rather than listed here, so the
 * set stays exactly what the design system re-exports. The package also exports
 * pure helpers — `composeNavigation`, `SETTINGS_NAV` — which are perfectly safe
 * on the server, so a blanket ban on the package would be wrong and would train
 * people to ignore the rule.
 */
function polarisComponentNames(sources) {
  const primitives = sources.find(
    (source) => source.relativePath === 'packages/ui/src/primitives.ts',
  );
  if (!primitives) return new Set();

  // The single `export { ... } from '@shopify/polaris'` block. The `export type`
  // block that follows is types only and cannot fail at runtime.
  const block = /export\s*\{([^}]*)\}\s*from\s*['"]@shopify\/polaris['"]/.exec(primitives.text);
  if (!block) return new Set();

  return new Set(
    block[1]
      .split(',')
      .map((raw) => raw.replace(/\/\/.*$/gm, '').trim())
      .filter((name) => /^[A-Z][A-Za-z0-9]*$/.test(name)),
  );
}

/**
 * A server page rendering Polaris directly.
 *
 * The sibling rule above only resolves RELATIVE imports, so it never looked at
 * `@deservefirst/ui` — and importing `<Card>` from there into a server page
 * type-checks, builds, and then throws `createContext is not a function` on
 * every request. Nothing before this caught it: not tsc, not `next build`, not
 * the smoke walk, because the screens were new and nothing else rendered them.
 */
export const polarisNeedsClient = {
  name: 'polaris-needs-client',
  description: 'Server components do not render design-system components (§8.3)',
  run(sources) {
    const violations = [];
    const components = polarisComponentNames(sources);
    if (components.size === 0) return violations;

    for (const source of sources) {
      if (!source.relativePath.startsWith(`${APP_DIR}/`)) continue;
      if (!/\/(page|layout|template|default)\.tsx$/.test(source.relativePath)) continue;
      if (isClientModule(source.text)) continue;

      const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@deservefirst\/ui['"]/g;
      let match;

      while ((match = pattern.exec(source.text)) !== null) {
        const [, typeOnly, names] = match;
        if (typeOnly) continue;

        for (const raw of names.split(',')) {
          const trimmed = raw.trim();
          if (!trimmed || trimmed.startsWith('type ')) continue;
          const name = trimmed.replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
          if (!name || !components.has(name)) continue;

          violations.push(
            violation(
              source.relativePath,
              source.text.slice(0, match.index).split('\n').length,
              'polaris-needs-client',
              `renders <${name}> in a server component. It needs React context that only a ` +
                `"use client" module can provide, so this throws on every request. Move the ` +
                `markup into a client component and pass it the data.`,
            ),
          );
        }
      }
    }

    return violations;
  },
};

export const clientBoundary = {
  name: 'client-boundary',
  description: 'Server components import only components from "use client" modules',
  run(sources) {
    const violations = [];
    const byPath = new Map(sources.map((source) => [source.relativePath, source]));

    for (const source of sources) {
      if (!source.relativePath.startsWith(`${APP_DIR}/`)) continue;
      if (!/\/(page|layout|template|default)\.tsx$/.test(source.relativePath)) continue;
      // A client page may import whatever it likes; it is already in the bundle.
      if (isClientModule(source.text)) continue;

      const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
      let match;

      while ((match = pattern.exec(source.text)) !== null) {
        const [, typeOnly, names, specifier] = match;
        if (typeOnly) continue;

        const targetPath = resolveRelative(source.relativePath, specifier, byPath);
        if (!targetPath) continue;
        const target = byPath.get(targetPath);
        if (!target || !isClientModule(target.text)) continue;

        for (const raw of names.split(',')) {
          const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
          if (!name) continue;
          if (raw.trim().startsWith('type ')) continue;
          // Components are capitalised; anything else is called, not rendered.
          if (/^[A-Z]/.test(name)) continue;

          violations.push(
            violation(
              source.relativePath,
              source.text.slice(0, match.index).split('\n').length,
              'client-boundary',
              `imports "${name}" from "${targetPath}", which is a "use client" module — ` +
                `move it to a module without the directive, or it will throw when called on the server`,
            ),
          );
        }
      }
    }

    return violations;
  },
};

/** The App Router tree: which child folders exist under each path. */
function readRouteTree(rootDir) {
  const root = join(rootDir, APP_DIR);
  if (!existsSync(root)) return null;

  const read = (dir) => {
    const node = { children: new Map(), hasPage: false };
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Route groups "(name)" do not appear in the URL.
        if (entry.startsWith('(') && entry.endsWith(')')) {
          const inner = read(full);
          for (const [key, value] of inner.children) node.children.set(key, value);
          node.hasPage ||= inner.hasPage;
          continue;
        }
        node.children.set(entry, read(full));
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry)) {
        node.hasPage = true;
      }
    }
    return node;
  };

  return read(root);
}

const isDynamic = (name) => name.startsWith('[') && !name.startsWith('[...') && !name.startsWith('[[');
const isCatchAll = (name) => name.startsWith('[...') || name.startsWith('[[...');

/**
 * How a URL resolves against the route tree, and by what.
 *
 * "Resolves" is not enough on its own — `/customers/segments` resolved
 * perfectly well, to `/customers/[id]`, and rendered "this customer does not
 * exist" for a section of the admin that simply is not installed.
 */
function resolve(tree, segments) {
  const hasCatchAll = (node) => [...node.children.keys()].some(isCatchAll);
  let sawCatchAll = false;

  /**
   * Matches a path against real routes only, ignoring catch-alls — they are the
   * last resort, applied once at the end.
   *
   * A directory with no `page` is NOT a route: `customers/segments/` sat there
   * empty and Next matched `customers/[id]` instead. So a literal branch that
   * leads nowhere falls through to the dynamic sibling rather than counting as a
   * match, which is exactly the precedence the router applies.
   */
  const walk = (node, index) => {
    if (hasCatchAll(node)) sawCatchAll = true;
    if (index >= segments.length) {
      return node.hasPage ? { kind: 'literal', via: null } : { kind: 'missing', via: null };
    }

    const literal = node.children.get(segments[index]);
    if (literal) {
      const result = walk(literal, index + 1);
      if (result.kind !== 'missing') return result;
    }

    const dynamic = [...node.children.keys()].find(isDynamic);
    if (dynamic) {
      const result = walk(node.children.get(dynamic), index + 1);
      if (result.kind !== 'missing') {
        // Matching a dynamic folder is correct for the store handle, and for a
        // segment the manifest itself declared as a parameter. It is only wrong
        // for a LITERAL segment — a named part of the admin being read as
        // somebody's record id.
        const declaredParam = segments[index] === '__param__';
        return index === 0 || declaredParam ? result : { kind: 'dynamic', via: dynamic };
      }
    }

    return { kind: 'missing', via: segments[index] };
  };

  const outcome = walk(tree, 0);
  if (outcome.kind === 'missing' && sawCatchAll) {
    return { kind: 'catch-all', via: null };
  }
  return outcome;
}

/**
 * Every store path the platform declares a screen for: navigation entries AND
 * the routes in each manifest.
 *
 * Navigation alone was not enough. "Create product" is a button on a list, not
 * a menu entry, so /products/new was never checked — and it was swallowed by
 * /products/[id], telling the merchant the product they were about to create
 * does not exist. Exactly the defect this rule was written for, one declaration
 * away from where it was looking.
 */
function navigationPaths(rootDir) {
  const paths = new Map();

  const add = (path, source) => {
    const clean = path.split('?')[0];
    if (clean?.startsWith('/store/')) paths.set(clean, source);
  };

  const navDist = join(rootDir, 'packages/ui/dist/navigation.js');
  if (existsSync(navDist)) {
    try {
      const { coreNavigation } = require(navDist);
      for (const section of coreNavigation('__handle__')) {
        for (const item of section.items) {
          add(item.path, 'packages/ui/src/navigation.ts');
          for (const child of item.children ?? []) add(child.path, 'packages/ui/src/navigation.ts');
        }
      }
    } catch {
      // Covered by the build; not this rule's job to report a broken module.
    }
  }

  const distRoot = join(rootDir, 'apps/api/dist/modules');
  if (existsSync(distRoot)) {
    for (const name of readdirSync(distRoot)) {
      const manifestPath = join(distRoot, name, `${name}.manifest.js`);
      if (!existsSync(manifestPath)) continue;
      try {
        const loaded = require(manifestPath);
        const manifest = loaded.default ?? loaded[`${name}Manifest`];
        const source = `apps/api/src/modules/${name}/${name}.manifest.ts`;
        for (const item of manifest?.navigation ?? []) {
          add(item.path.replace(':handle', '__handle__'), source);
        }

        for (const route of manifest?.routes ?? []) {
          // Overlays and drawers render above a parent that is already routed;
          // they do not each need a file of their own.
          if (route.presentation === 'overlay' || route.presentation === 'drawer') continue;
          add(
            route.path.replace(':handle', '__handle__').replace(/:[A-Za-z]+/g, '__param__'),
            source,
          );
        }
      } catch {
        // As above.
      }
    }
  }

  return paths;
}

/**
 * Every navigation entry must lead to a screen written for it.
 *
 * A section that falls through to a DYNAMIC segment is the failure this catches:
 * it looks fine in the route table, renders without error, and tells the
 * merchant something false — Segments reported a missing customer record.
 * Falling through to the store-level catch-all is fine: that is the deliberate
 * "not part of this install" placeholder.
 */
export const screenDestinations = {
  name: 'screen-destinations',
  description: 'Every declared screen and nav entry resolves to a page, not a dynamic route (§24.5)',
  run(_sources, rootDir) {
    const violations = [];
    const tree = readRouteTree(rootDir);
    if (!tree) return violations;

    const paths = navigationPaths(rootDir);
    if (paths.size === 0) return violations;

    for (const [path, source] of paths) {
      // "/store/__handle__/products/inventory" → ["__handle__","products","inventory"]
      const segments = path.split('/').filter(Boolean).slice(1);
      const storeNode = tree.children.get('store');
      if (!storeNode) continue;

      const outcome = resolve(storeNode, segments);

      if (outcome.kind === 'dynamic') {
        violations.push(
          violation(
            source,
            1,
            'screen-destinations',
            `"${path.replace('__handle__', ':handle')}" is served by the dynamic route "${outcome.via}" — ` +
              `add a page for it, or it renders as a missing record rather than a section`,
          ),
        );
      } else if (outcome.kind === 'missing') {
        violations.push(
          violation(
            source,
            1,
            'screen-destinations',
            `"${path.replace('__handle__', ':handle')}" has no screen and no placeholder — it would 404`,
          ),
        );
      }
    }

    return violations;
  },
};

/**
 * A module's endpoints live in that module, not in the transport.
 *
 * `main.ts` grew to 1,331 lines and 57 hand-written endpoints, each repeating
 * the same authorisation preamble — and one of those repetitions was wrong for
 * every route on the platform. Modules now return route definitions and the
 * transport registers them in one loop; this keeps it that way, because the
 * file only rots one endpoint at a time and each one looks reasonable.
 */
export const transportIsThin = {
  name: 'transport-is-thin',
  description: 'Module endpoints live in the module, not in the transport (§13.1)',
  run(sources, rootDir) {
    const violations = [];
    const main = sources.find((source) => source.relativePath === 'apps/api/src/main.ts');
    if (!main) return violations;

    const moduleIds = readdirSync(join(rootDir, 'apps/api/src/modules'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const pattern = /app\.(get|post|patch|put|delete)\(\s*`([^`]+)`/g;
    let match;

    while ((match = pattern.exec(main.text)) !== null) {
      const [, method, url] = match;
      const owner = moduleIds.find((id) => url.includes(`/${id}/`));
      if (!owner) continue;

      violations.push(
        violation(
          main.relativePath,
          main.text.slice(0, match.index).split('\n').length,
          'transport-is-thin',
          `registers ${method.toUpperCase()} "${url}" for module "${owner}" — ` +
            `declare it in apps/api/src/modules/${owner}/api/ and let the controller loop mount it`,
        ),
      );
    }

    return violations;
  },
};

/**
 * Authority comes from the session, never from a header the caller sets.
 *
 * The transport used to read `x-permissions`, `x-store-id` and `x-user-id`,
 * which meant every caller declared its own authority — anyone with curl could
 * claim `platform.modules.manage` and disable a module for every store. Every
 * access check on the platform was correct logic applied to an untrusted input.
 *
 * That scaffolding is exactly the kind that gets reintroduced "just for local
 * testing", so it is a build failure rather than a convention. The store id is
 * exempted for the CLIENT's own calls (the admin sends none) but forbidden as a
 * source of context on the server.
 */
/** Blanks comments while preserving line numbers, so reports still point true. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

export const authorityFromSession = {
  name: 'authority-from-session',
  description: 'The server never takes identity or permissions from a request header',
  run(sources) {
    const violations = [];
    const forbidden = /['"`]x-(permissions|user-id|organization-id|roles?)['"`]/gi;

    for (const source of sources) {
      // The server side only: a browser client naming a header it SENDS is
      // fine, and the API no longer accepts them anyway.
      if (!source.relativePath.startsWith('apps/api/src/')) continue;
      if (source.relativePath.includes('/tests/')) continue;

      // Comments are prose, and this file's own explanation of the bug names
      // the headers it removed. A rule that cannot tell code from a comment
      // punishes documenting the reason.
      const code = withoutComments(source.text);

      let match;
      while ((match = forbidden.exec(code)) !== null) {
        violations.push(
          violation(
            source.relativePath,
            code.slice(0, match.index).split('\n').length,
            'authority-from-session',
            `reads "${match[0].replace(/['"`]/g, '')}" from the request — ` +
              `identity and permissions come from the session, not from what the caller claims`,
          ),
        );
      }
    }

    return violations;
  },
};

export const webRules = [
  clientBoundary,
  polarisNeedsClient,
  screenDestinations,
  transportIsThin,
  authorityFromSession,
];
