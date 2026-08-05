/**
 * Storefront · domain/assets.ts
 * Serving a theme's own files to a browser.
 *
 * Nothing served them. The reference theme's homepage references 25 distinct
 * asset URLs — `theme.css`, `slideshow.css`, every script and image — and every
 * one answered 404, so the storefront rendered correct HTML that loaded no
 * stylesheet, no JavaScript and no images. "The storefront works" had been
 * measured in bytes of markup, which is exactly the measurement that cannot see
 * this.
 *
 * Three decisions live here, and each is a way to get it wrong:
 *
 * **The path is a theme path, not a URL path.** `/assets/theme.css` becomes
 * `assets/theme.css` and goes through `confinePath` like every other theme
 * read. It is attacker-controlled — anyone can request any URL — so it gets the
 * same rule the renderer uses rather than a second, looser one written here.
 *
 * **The content type is decided by extension, from a closed list.** Guessing
 * from the bytes would let an uploaded file be served as whatever it appears to
 * be, and `X-Content-Type-Options: nosniff` only helps if the type we send is
 * right. Anything unrecognised is served as a download rather than as content
 * the browser will interpret.
 *
 * **Caching is aggressive but not immutable.** These URLs are NOT
 * content-addressed: `theme.css` is the same URL before and after a merchant
 * publishes a change, so `immutable` would leave visitors on the old stylesheet
 * until their cache expired. A short max-age with revalidation is the honest
 * answer until asset URLs carry a version.
 * Layer: domain (pure).
 */

export interface AssetResponse {
  readonly contentType: string;
  readonly cacheControl: string;
  /**
   * Whether the browser may render it inline.
   *
   * A theme is untrusted third-party code and its assets are served from the
   * merchant's own domain. An HTML or SVG file served inline runs script in
   * that origin — so anything not on the known-safe list is sent as an
   * attachment, which browsers download rather than execute.
   */
  readonly inline: boolean;
}

/**
 * The types a theme may serve, and how.
 *
 * A closed map: an extension that is not here is not served as itself.
 */
const TYPES: Readonly<Record<string, { type: string; inline: boolean }>> = {
  '.css': { type: 'text/css; charset=utf-8', inline: true },
  '.js': { type: 'text/javascript; charset=utf-8', inline: true },
  '.mjs': { type: 'text/javascript; charset=utf-8', inline: true },
  '.map': { type: 'application/json; charset=utf-8', inline: true },
  '.json': { type: 'application/json; charset=utf-8', inline: true },

  '.png': { type: 'image/png', inline: true },
  '.jpg': { type: 'image/jpeg', inline: true },
  '.jpeg': { type: 'image/jpeg', inline: true },
  '.gif': { type: 'image/gif', inline: true },
  '.webp': { type: 'image/webp', inline: true },
  '.avif': { type: 'image/avif', inline: true },
  '.ico': { type: 'image/x-icon', inline: true },

  /**
   * SVG is an image that can hold script.
   *
   * Served inline because themes use them as icons everywhere and refusing
   * would break every theme on the platform — but the CSP already forbids
   * inline script without a nonce, and an SVG loaded through `<img>` cannot run
   * script at all. The risk is one loaded directly as a top-level document,
   * which `Content-Disposition` does not prevent and the policy does.
   */
  '.svg': { type: 'image/svg+xml', inline: true },

  '.woff': { type: 'font/woff', inline: true },
  '.woff2': { type: 'font/woff2', inline: true },
  '.ttf': { type: 'font/ttf', inline: true },
  '.otf': { type: 'font/otf', inline: true },
  '.eot': { type: 'application/vnd.ms-fontobject', inline: true },

  '.txt': { type: 'text/plain; charset=utf-8', inline: true },
  '.md': { type: 'text/plain; charset=utf-8', inline: true },
};

/**
 * How long a browser may keep an asset.
 *
 * Five minutes with revalidation. Not `immutable`, because these URLs are not
 * content-addressed — `theme.css` is the same URL after a merchant publishes a
 * change, and a year-long immutable cache would leave visitors on the old
 * stylesheet with no way to correct it. When `asset_url` learns to carry the
 * version reference this becomes a year and stops being a compromise.
 */
export const ASSET_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

/**
 * How long a VERSIONED asset may be kept.
 *
 * A year, and immutable. Safe only because the URL carries the theme's version:
 * publishing a change produces a different URL, so nothing can be stale. The
 * moment that stops being true this becomes wrong rather than merely
 * aggressive.
 */
export const VERSIONED_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Decides how to serve a file, or refuses to serve it as itself. */
export function assetResponseFor(path: string, versioned = false): AssetResponse {
  const cacheControl = versioned ? VERSIONED_CACHE_CONTROL : ASSET_CACHE_CONTROL;
  const name = path.split('/').pop() ?? '';
  const at = name.lastIndexOf('.');
  const extension = at <= 0 ? '' : name.slice(at).toLowerCase();

  const known = TYPES[extension];
  if (known) {
    return { contentType: known.type, cacheControl, inline: known.inline };
  }

  /**
   * Unknown extensions are served as bytes nobody will interpret.
   *
   * `application/octet-stream` plus an attachment disposition. A theme should
   * not contain one — the installer's allow-list is narrower than this map —
   * but a theme that reached the store some other way must not be able to serve
   * HTML from the merchant's domain by naming a file `.htm`.
   */
  return { contentType: 'application/octet-stream', cacheControl, inline: false };
}

/**
 * The theme path an asset URL refers to, or null.
 *
 * Only `/assets/`. The other theme directories hold templates, schemas and
 * translations — a merchant's `settings_data.json` describes their whole store
 * setup, and `locales/` is nobody's business. Serving a directory because it
 * exists is how a config file ends up on the public internet.
 */
export function assetPathFor(urlPath: string): string | null {
  const match = /^\/assets\/([^/]+)$/.exec(urlPath);
  if (!match) return null;

  let name: string;
  try {
    // Decoded here so `confinePath` sees what will actually be opened; it
    // decodes again and refuses anything that changes meaning twice.
    name = decodeURIComponent(match[1] as string);
  } catch {
    return null;
  }

  /**
   * Re-checked AFTER decoding, because decoding is what creates the problem.
   *
   * `%2e%2e%2fconfig%2fx.json` has no literal slash, so the pattern above
   * matches it as a single segment — and decoding then produces
   * `../config/x.json`. `confinePath` refuses that downstream, and this was
   * verified to 404, but a function that hands back a path it can see is a
   * traversal is one relying on the next layer's vigilance. It should not
   * return it at all.
   */
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;

  return `assets/${name}`;
}
