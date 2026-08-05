/**
 * Storefront · application/platform-page.ts
 * What we serve on a storefront host that has no store behind it.
 *
 * Someone reaching this has almost always mistyped a store name or followed a
 * link to a shop that closed. A bare "Not found" tells them nothing and leaves
 * them nowhere, on a page carrying our own domain — so this is a branded page
 * with somewhere to go.
 *
 * Three constraints shape it, and each one rules something out:
 *
 *   **It must not reveal which stores exist.** So there is no suggestion, no
 *   "did you mean", and the same page answers an unknown host and a store that
 *   has closed. A helpful hint here is a store-enumeration oracle.
 *
 *   **It must not be indexed.** It is served on thousands of hostnames that
 *   have nothing behind them; without `noindex` a search engine would collect
 *   every one of them under our domain.
 *
 *   **It must not need the database.** It is the answer when lookup found
 *   nothing, and it is also what a flood of requests to random subdomains
 *   hits — a page that queried on the way out would make that flood expensive.
 *
 * Every brand value comes from config (§33.1), so renaming the platform renames
 * this page too.
 * Layer: application.
 */

import { branding } from '@deservefirst/config';

import { escapeHtml } from '../engine';

export interface PlatformPageOptions {
  /** The hostname that was asked for, shown back so the typo is visible. */
  readonly host?: string;
}

/**
 * The page itself.
 *
 * Self-contained: inline styles, no scripts, no external requests. It has to
 * render correctly when it is the only thing that worked.
 */
export function renderStoreNotFoundPage(options: PlatformPageOptions = {}): string {
  const platform = escapeHtml(branding.platformName);
  const marketing = escapeHtml(`https://${branding.domains.marketing}`);
  const support = escapeHtml(branding.supportEmail);
  const host = options.host ? escapeHtml(options.host) : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store not available &middot; ${platform}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #fafafa; color: #1a1a1a;
  }
  main { max-width: 30rem; text-align: center; }
  h1 { font-size: 1.5rem; line-height: 1.3; margin: 0 0 0.75rem; font-weight: 600; }
  p { margin: 0 0 1rem; color: #565656; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
    background: rgba(0,0,0,0.06); padding: 0.15em 0.4em; border-radius: 4px; word-break: break-all;
  }
  .actions { margin-top: 1.5rem; display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
  a.button {
    display: inline-block; padding: 0.6rem 1.1rem; border-radius: 8px; text-decoration: none;
    background: #1a1a1a; color: #fff; font-weight: 500;
  }
  a.quiet { color: #565656; text-decoration: underline; align-self: center; }
  footer { margin-top: 2rem; font-size: 0.875rem; color: #767676; }
  footer a { color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { background: #141414; color: #f2f2f2; }
    p { color: #a8a8a8; }
    code { background: rgba(255,255,255,0.1); }
    a.button { background: #f2f2f2; color: #141414; }
    a.quiet, footer { color: #a8a8a8; }
  }
</style>
</head>
<body>
<main>
  <h1>There's no store at this address</h1>
  ${host ? `<p>Nothing is published at <code>${host}</code>.</p>` : ''}
  <p>
    The address may be mistyped, or the store may have moved or closed.
    If you were sent here by a link, whoever shared it will know where the shop lives now.
  </p>
  <div class="actions">
    <a class="button" href="${marketing}">About ${platform}</a>
    <a class="quiet" href="${marketing}/start">Open your own store</a>
  </div>
  <footer>
    Hosted on ${platform}. Need a hand? <a href="mailto:${support}">${support}</a>
  </footer>
</main>
</body>
</html>
`;
}
