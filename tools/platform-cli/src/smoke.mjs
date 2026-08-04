/**
 * Platform CLI · smoke.mjs
 * Opens every navigation destination against a running admin and reports what a
 * merchant would actually see.
 *
 * This exists because two defects reached a green pipeline. Neither was a type
 * error, neither broke a test, and both made a screen useless: one threw on
 * every request, the other rendered "this customer does not exist" for a section
 * of the admin. `platform check` now catches both statically — but static rules
 * only ever catch the shapes somebody has already been bitten by, and this
 * catches the rest by looking.
 *
 * Deliberately dependency-free: it fetches HTML and reads it. A headless browser
 * would also catch client-side exceptions, and is worth adding when something
 * needs it — but a check nobody can run without installing a browser is a check
 * that stops being run.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Text that means the screen failed even though the request succeeded.
 *
 * Deliberately narrow. "This page could not be found" is NOT here: the router
 * embeds its own not-found markup in the payload of every page under a layout
 * that has a catch-all, so matching it failed all 24 destinations including the
 * ones that render perfectly. A genuine 404 arrives as a 404 status.
 */
const FAILURE_MARKERS = [
  { text: 'Could not load', reason: 'the screen reported an API failure' },
  { text: 'does not exist in this store', reason: 'a section rendered as a missing record' },
  { text: 'Application error:', reason: 'a client-side exception' },
];

/**
 * Every destination a merchant can actually click.
 *
 * Composed exactly as the shell composes it, rather than by unioning the raw
 * paths. A module CLAIMS a reference entry by id — orders is labelled "Requests"
 * and serves /requests — so the union contained /orders, a path no menu item
 * points at and no screen serves. A check that invents its own destinations is
 * checking something other than the product.
 */
export function navigationDestinations(rootDir, handle) {
  const navDist = join(rootDir, 'packages/ui/dist/navigation.js');
  if (!existsSync(navDist)) return [];

  const { composeNavigation } = require(navDist);
  const contributed = [];

  const modulesDir = join(rootDir, 'apps/api/dist/modules');
  if (existsSync(modulesDir)) {
    for (const name of readdirSync(modulesDir)) {
      const manifestPath = join(modulesDir, name, `${name}.manifest.js`);
      if (!existsSync(manifestPath)) continue;
      const loaded = require(manifestPath);
      const manifest = loaded.default ?? loaded[`${name}Manifest`];

      for (const item of manifest?.navigation ?? []) {
        if (item.section === 'settings') continue;
        contributed.push({
          section: item.section,
          position: item.position,
          parentId: item.parentId,
          item: { ...item, path: item.path.replace(':handle', handle) },
        });
      }
    }
  }

  // The smoke run is an operator with everything granted: a destination hidden
  // behind a missing permission is not evidence that its screen works, and a
  // check that quietly skips screens is worse than no check.
  const everything = { has: () => true };
  const sections = composeNavigation(handle, contributed, everything);

  const paths = new Set();
  for (const section of sections) {
    for (const item of section.items) {
      paths.add(item.path.split('?')[0]);
      for (const child of item.children ?? []) paths.add(child.path.split('?')[0]);
    }
  }

  return [...paths].sort();
}

export async function smoke(rootDir, options = {}) {
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
  const handle = options.handle ?? 'acme-us';

  const destinations = navigationDestinations(rootDir, handle);
  if (destinations.length === 0) {
    throw new Error('No navigation found — build first (`pnpm -r build`).');
  }

  const results = [];

  for (const path of destinations) {
    const url = `${baseUrl}${path}`;
    let status = 0;
    let body = '';

    try {
      const response = await fetch(url, { redirect: 'follow' });
      status = response.status;
      body = await response.text();
    } catch (error) {
      results.push({ path, status: 0, ok: false, reason: `unreachable — ${error.message}` });
      continue;
    }

    const marker = FAILURE_MARKERS.find((entry) => body.includes(entry.text));
    // The placeholder is a SUCCESS: the section is declared, not installed, and
    // saying so plainly is the intended behaviour rather than a gap.
    const placeholder = body.includes('is not part of this install');

    results.push({
      path,
      status,
      ok: status < 400 && !marker,
      placeholder,
      reason: status >= 400 ? `HTTP ${status}` : marker?.reason,
    });
  }

  return {
    baseUrl,
    results,
    failed: results.filter((result) => !result.ok).length,
  };
}
