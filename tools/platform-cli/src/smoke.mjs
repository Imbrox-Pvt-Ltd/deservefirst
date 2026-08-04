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

  const { composeNavigation, SETTINGS_NAV } = require(navDist);
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

  // Create screens are buttons on a list, not menu entries. Walking only the
  // menu is how nine of them went missing — every one reachable, every one
  // showing the merchant a record that does not exist.
  for (const route of declaredRoutes(rootDir)) {
    const resolved = route.replace(':handle', handle);
    // Anything still holding a parameter needs a real record id to visit. The
    // fitness rule covers those statically; this walks what can be opened cold.
    if (resolved.includes(':')) continue;
    paths.add(resolved);
  }

  // Every settings section is its own shareable URL (§8.5), so every one of them
  // is a screen that can be opened cold and has to render. They were skipped
  // here because they are not navigation entries — which meant the whole
  // settings surface, nineteen destinations, was never walked at all.
  for (const section of SETTINGS_NAV) {
    paths.add(`/store/${handle}/settings/${section.id}`);
  }

  // Two settings screens are reached from the organization switcher rather than
  // the settings rail, so walking SETTINGS_NAV alone misses them — including the
  // one that decides which agencies hold keys to the store.
  for (const id of ['organization-details', 'organization-account']) {
    paths.add(`/store/${handle}/settings/${id}`);
  }

  return [...paths].sort();
}

/** Screen routes each module declares, with parameters left in place. */
function declaredRoutes(rootDir) {
  const routes = [];
  const modulesDir = join(rootDir, 'apps/api/dist/modules');
  if (!existsSync(modulesDir)) return routes;

  for (const name of readdirSync(modulesDir)) {
    const manifestPath = join(modulesDir, name, `${name}.manifest.js`);
    if (!existsSync(manifestPath)) continue;
    const loaded = require(manifestPath);
    const manifest = loaded.default ?? loaded[`${name}Manifest`];

    for (const route of manifest?.routes ?? []) {
      if (route.presentation === 'overlay' || route.presentation === 'drawer') continue;
      routes.push(route.path.replace(':handle', '__HANDLE__'));
    }
  }

  return routes.map((route) => route.replace('__HANDLE__', ':handle'));
}

/**
 * Signs in and returns the session cookie.
 *
 * Added after this command reported "all 31 destinations render" while every
 * one of them was redirecting to the login page — it followed the redirect,
 * got a 200, found no failure text, and cheerfully checked that the login
 * screen rendered 31 times. A smoke test that silently stops testing is worse
 * than none, because it is believed.
 */
async function signIn(apiUrl, email, password) {
  const response = await fetch(`${apiUrl}/2026-01/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json();
  if (body.errors?.length) throw new Error(`sign-in failed: ${body.errors[0].detail}`);

  const cookie = /df_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
  if (!cookie) throw new Error('sign-in returned no session cookie');
  return `df_session=${cookie}`;
}

/** Scopes the session to a store, since most screens need one. */
async function chooseStore(apiUrl, cookie, storeId) {
  const response = await fetch(`${apiUrl}/2026-01/auth/switch-store`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ storeId }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(`could not open the store: ${body.errors[0].detail}`);
}

/**
 * The partner screens this person can actually open.
 *
 * Read from the API rather than guessed, because a partner id is a uuid: there
 * is no manifest to walk and inventing one would test a redirect, not a screen.
 */
async function partnerDestinations(apiUrl, cookie) {
  const paths = ['/partners'];
  try {
    const response = await fetch(`${apiUrl}/2026-01/partners`, { headers: { cookie } });
    const body = await response.json();
    for (const partner of body.data ?? []) {
      paths.push(`/partners/${partner.id}`);
      paths.push(`/partners/${partner.id}/stores`);
      // Only an owner is shown Team, and only an owner may open it.
      if (partner.role === 'owner') paths.push(`/partners/${partner.id}/team`);
    }
  } catch {
    // The partner surface being unreachable is itself worth reporting, but the
    // picker is walked either way and will fail loudly if the app is down.
  }
  return paths;
}

export async function smoke(rootDir, options = {}) {
  // 3000 because that is the port `apps/web` actually serves — see its dev and
  // start scripts. This defaulted to 4100, which nothing has ever listened on,
  // so a bare `platform smoke` reported all 33 destinations broken and the
  // honest reading of that was "the admin is down".
  const baseUrl = (options.baseUrl ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
  const apiUrl = (options.apiUrl ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
  const handle = options.handle ?? 'acme-us';
  const cookie = await signIn(
    apiUrl,
    options.email ?? 'dev@acme.test',
    options.password ?? 'a-perfectly-fine-passphrase',
  );
  await chooseStore(apiUrl, cookie, options.storeId ?? 'seed-store-us');

  const destinations = [
    ...navigationDestinations(rootDir, handle),
    // The partner surface is not a store, so it is not in the store navigation
    // and was walked by nothing. Its ids are data rather than manifest, so they
    // are resolved against the signed-in person's own partner accounts; when
    // they have none, only the picker is walked and that is the honest answer.
    ...(await partnerDestinations(apiUrl, cookie)),
  ];
  if (destinations.length === 0) {
    throw new Error('No navigation found — build first (`pnpm -r build`).');
  }

  const results = [];

  for (const path of destinations) {
    const url = `${baseUrl}${path}`;
    let status = 0;
    let body = '';

    try {
      const response = await fetch(url, { redirect: 'follow', headers: { cookie } });
      status = response.status;
      body = await response.text();

      // Landing on the sign-in screen means the session did not reach the page.
      // Reported as a failure rather than accepted as a 200, because that is
      // precisely the false pass this check once produced.
      if (new URL(response.url).pathname.startsWith('/login')) {
        results.push({ path, status, ok: false, reason: 'redirected to sign in' });
        continue;
      }
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
