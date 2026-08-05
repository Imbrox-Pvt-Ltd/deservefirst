/**
 * Storefront · domain/csp.ts
 * A Content-Security-Policy a theme can actually satisfy.
 *
 * This was deferred once, on the grounds that themes emit inline `<script>` and
 * `<style>` through `{% javascript %}` and `{% style %}`, so any policy worth
 * having needs per-render nonces threaded through those tags — and one every
 * theme violates teaches everyone to ignore the console. That reasoning was
 * right; the conclusion was only ever "not yet".
 *
 * A storefront renders **untrusted third-party code on a merchant's domain**.
 * It is the one page on the platform where a CSP is not belt-and-braces: a
 * theme, an app block or a reflected value that manages to inject a script is
 * exactly what this stops.
 *
 * The design in one line: **the platform's own inline code is nonced, and
 * nothing else may execute inline**. A theme's `{% javascript %}` gets the
 * nonce because the platform emitted that tag; a `<script>` that arrived inside
 * a product title does not, because nothing on the platform wrote it.
 * Layer: domain (pure).
 */

export interface CspOptions {
  /** The per-render nonce. One page, one value, never reused. */
  readonly nonce: string;
  /** Where a theme's own assets and images come from. */
  readonly assetHosts: readonly string[];
  /**
   * Hosts a merchant has allowed for analytics and embeds.
   *
   * Merchants genuinely need this — an analytics tag or a chat widget is a
   * legitimate part of a storefront — so the policy has to be extensible or it
   * gets turned off wholesale, which is worse than a policy with holes a
   * merchant chose.
   */
  readonly allowedScriptHosts?: readonly string[];
  readonly allowedFrameHosts?: readonly string[];
  /**
   * Who may frame this page.
   *
   * The theme editor previews a store in an iframe, so a blanket `none` would
   * break the product's own editor. Naming the admin host is why
   * `X-Frame-Options` is deliberately absent — it cannot express this.
   */
  readonly frameAncestors?: readonly string[];
  /**
   * Report-only, for rolling one out without breaking every existing theme.
   *
   * A policy switched straight to enforcing is a policy that takes storefronts
   * down on the day it ships. This is how it gets measured first.
   */
  readonly reportOnly?: boolean;
  readonly reportUri?: string | null;
}

/** The header name, which differs between enforcing and measuring. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'content-security-policy-report-only' : 'content-security-policy';
}

/**
 * The video and model hosts the media filters already emit.
 *
 * Listed here rather than left to merchants because the platform itself
 * produces these iframes — `external_video_tag` writes a YouTube embed, so a
 * policy that blocked it would break a filter we ship.
 */
const PLATFORM_FRAME_HOSTS = ['https://www.youtube.com', 'https://player.vimeo.com'];

export function buildCsp(options: CspOptions): string {
  const assets = [...new Set(options.assetHosts)].filter((host) => host !== '');
  const nonce = `'nonce-${options.nonce}'`;

  const directives: Record<string, readonly string[]> = {
    "default-src": ["'self'"],

    /**
     * `strict-dynamic` alongside the nonce.
     *
     * A theme's nonced bootstrap script loads its own bundles, and without this
     * every one of those would need a nonce it cannot have — the browser adds
     * them, not us. `strict-dynamic` says "code this trusted script loads is
     * also trusted", which is the only workable shape for third-party themes.
     *
     * Older browsers ignore it and fall back to the host list below, which is
     * why both are present.
     */
    'script-src': [
      nonce,
      "'strict-dynamic'",
      "'self'",
      ...assets,
      ...(options.allowedScriptHosts ?? []),
      // Ignored by browsers that understand strict-dynamic; a fallback for the
      // ones that do not.
      'https:',
    ],

    /**
     * Styles take the nonce but not `strict-dynamic`, which does not apply to
     * them, and `'unsafe-inline'` is NOT here.
     *
     * A theme's inline `style="..."` attributes still work — attribute styles
     * are governed by `style-src-attr`, and blocking those would break every
     * theme on the platform for no security gain, since an attribute cannot run
     * script.
     */
    'style-src': [nonce, "'self'", ...assets],
    'style-src-attr': ["'unsafe-inline'"],

    // Images and fonts come from anywhere a merchant hosts them; neither can
    // execute, and restricting them breaks storefronts for nothing.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:', 'https:'],
    'media-src': ["'self'", 'https:', ...assets],

    'connect-src': ["'self'", 'https:'],

    'frame-src': [...PLATFORM_FRAME_HOSTS, ...(options.allowedFrameHosts ?? [])],

    'frame-ancestors': options.frameAncestors?.length ? options.frameAncestors : ["'none'"],

    /**
     * The three that close the remaining gaps.
     *
     * `base-uri` stops an injected `<base>` re-pointing every relative URL on
     * the page, which is a way to hijack a form without touching the form.
     * `form-action` stops a submission being redirected off-site. `object-src`
     * closes plugin content, which nothing legitimate uses any more.
     */
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  const rendered = Object.entries(directives)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`);

  if (options.reportUri) rendered.push(`report-uri ${options.reportUri}`);

  return rendered.join('; ');
}

/**
 * Whether a nonce is one we generated.
 *
 * Base64url, at least 128 bits. Checked rather than assumed because a nonce
 * that a theme could predict or supply is not a nonce — it is a bypass with
 * ceremony.
 */
export function isUsableNonce(nonce: string): boolean {
  return /^[A-Za-z0-9_-]{22,}$/.test(nonce);
}
