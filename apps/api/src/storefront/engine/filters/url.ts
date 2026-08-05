/**
 * Storefront · engine/filters/url.ts
 * Filters that turn a name or an object into a URL.
 *
 * All of them route through the context's base URLs rather than building
 * absolute paths, because where assets live is a deployment decision — a
 * development store serving from disk and a production one serving from a CDN
 * run the same theme, and the theme should not know the difference.
 *
 * `image_url` is the important one. It does not fetch or resize anything; it
 * encodes the transformation into the URL and the image service performs it on
 * request. That keeps rendering free of image work, which matters when a
 * collection page asks for sixty images at four widths each.
 * Layer: engine.
 */

import { branding } from '@deservefirst/config';

import { escapeHtml, safeUrl } from '../markup';
import { arg, numberArg, stringify, type FilterGroup } from '../types';
import { handleize } from './string';

/** Joins a base and a path without doubling or dropping the separator. */
function join(base: string, filePath: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = stringify(filePath).replace(/^\/+/, '');
  return trimmedPath === '' ? trimmedBase : `${trimmedBase}/${trimmedPath}`;
}

/**
 * The transformation parameters `image_url` accepts.
 *
 * An allow-list, so a theme cannot invent a parameter that reaches the image
 * service. Anything not listed is dropped rather than passed along.
 */
const IMAGE_PARAMS = ['width', 'height', 'crop', 'format', 'pad_color'] as const;

const CROP_VALUES = ['top', 'center', 'bottom', 'left', 'right', 'region'];
const FORMAT_VALUES = ['jpg', 'pjpg', 'png', 'webp'];

/**
 * The URL of an image, with its transformation as query parameters.
 *
 * Takes either an image object from a drop or a string that is already a URL,
 * because themes chain it both ways: `product.featured_image | image_url` and
 * `settings.logo | image_url: width: 200`.
 */
function imageUrl(base: string, value: unknown, named: Readonly<Record<string, unknown>>): string {
  const source =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'src' in value
        ? stringify((value as { src: unknown }).src)
        : '';
  if (source === '') return '';

  const url = source.startsWith('http') || source.startsWith('//') ? source : join(base, source);

  const params = new URLSearchParams();
  for (const key of IMAGE_PARAMS) {
    const raw = named[key];
    if (raw === undefined || raw === null || raw === '') continue;

    if (key === 'crop' && !CROP_VALUES.includes(String(raw))) continue;
    if (key === 'format' && !FORMAT_VALUES.includes(String(raw))) continue;
    if (key === 'width' || key === 'height') {
      const size = numberArg(raw, 0);
      // A zero or negative dimension would be a request the image service has
      // to reject; dropping it here means the theme gets the original instead.
      if (size <= 0) continue;
      params.set(key, String(Math.round(size)));
      continue;
    }
    params.set(key, String(raw));
  }

  const query = params.toString();
  return query === '' ? url : `${url}?${query}`;
}

export const urlFilters: FilterGroup = {
  name: 'url',
  filters: [
    /** A file in this theme's `assets/` directory. */
    { name: 'asset_url', apply: (context, value) => join(context.assetBaseUrl, stringify(value)) },

    /**
     * A file the merchant uploaded, rather than one the theme ships.
     *
     * `file_url` and `file_img_url` differ only in that the second accepts a
     * size; both resolve against the same store files.
     */
    { name: 'file_url', apply: (context, value) => join(context.cdnBaseUrl, stringify(value)) },
    {
      name: 'file_img_url',
      apply: (context, value, args) =>
        imageUrl(context.cdnBaseUrl, join(context.cdnBaseUrl, stringify(value)), {
          ...args.named,
          ...sizeToParams(arg(args, 0)),
        }),
    },

    /**
     * A platform-provided script or stylesheet, not one of the theme's.
     *
     * The name carries our brand and is built from `branding.slug`, so renaming
     * the platform renames the filter — §33.1 applies to the theme vocabulary
     * exactly as it applies to anything else a theme author reads. Themes
     * written for another platform name this differently and must be ported;
     * there is no alias, by decision.
     */
    {
      name: `${branding.slug}_asset_url`,
      apply: (context, value) => join(context.platformAssetBaseUrl, stringify(value)),
    },

    { name: 'image_url', apply: (context, value, args) => imageUrl(context.cdnBaseUrl, value, args.named) },

    /**
     * The legacy image filter, whose size is one positional string.
     *
     * Kept because themes in the wild still use it — `img_url: '300x300'` — and
     * a theme that renders every image at full size is a slow storefront rather
     * than an obviously broken one, which is worse.
     */
    {
      name: 'img_url',
      apply: (context, value, args) =>
        imageUrl(context.cdnBaseUrl, value, { ...args.named, ...sizeToParams(arg(args, 0)) }),
    },

    { name: 'font_url', apply: (context, value, args) => fontUrl(context.assetBaseUrl, value, args) },

    /**
     * A watchable URL for an externally hosted video.
     *
     * Only the two hosts the reference product supports. An arbitrary host here
     * would be a theme choosing what gets embedded in an iframe on the
     * merchant's domain.
     */
    {
      name: 'external_video_url',
      apply: (_context, value, args) => {
        const media = value as { host?: unknown; external_id?: unknown } | null;
        const host = String(media?.host ?? '').toLowerCase();
        const id = stringify(media?.external_id);
        if (id === '') return '';

        const options = new URLSearchParams();
        for (const [key, raw] of Object.entries(args.named)) {
          if (/^[a-z_]+$/.test(key)) options.set(key, String(raw));
        }
        const query = options.toString();

        if (host === 'youtube') {
          return `https://www.youtube.com/embed/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
        }
        if (host === 'vimeo') {
          return `https://player.vimeo.com/video/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
        }
        return '';
      },
    },

    /**
     * An anchor. The href is escaped and scheme-checked; the label is not.
     *
     * The asymmetry is the reference product's and it is forced: the reference
     * theme writes `{{ '&larr;' | link_to: url }}`, and escaping that label
     * would put the literal text "&larr;" on the page instead of an arrow. So
     * the label passes through exactly as Liquid passes any `{{ value }}`
     * through — unescaped, with `| escape` available to a theme that wants it.
     *
     * The href is a different matter. `{{ x | link_to: some.url }}` where the
     * URL came from a merchant's setting is exactly the path a `javascript:`
     * href takes, and unlike the label there is no legitimate theme that needs
     * one, so `safeUrl` refuses it.
     */
    {
      name: 'link_to',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const href = safeUrl(stringify(arg(args, 0)));
        const title = arg(args, 1);
        const titleAttr = title === undefined ? '' : ` title="${escapeHtml(stringify(title))}"`;
        return `<a href="${escapeHtml(href)}"${titleAttr}>${stringify(value)}</a>`;
      },
    },

    { name: 'url_for_tag', apply: (_context, value) => `/collections/all/${handleize(stringify(value))}` },
    { name: 'url_for_vendor', apply: (_context, value) => `/collections/vendors?q=${encodeURIComponent(stringify(value))}` },
    { name: 'url_for_type', apply: (_context, value) => `/collections/types?q=${encodeURIComponent(stringify(value))}` },

    linkToCollection('link_to_tag', (value) => `/collections/all/${handleize(value)}`),
    linkToCollection('link_to_vendor', (value) => `/collections/vendors?q=${encodeURIComponent(value)}`),
    linkToCollection('link_to_type', (value) => `/collections/types?q=${encodeURIComponent(value)}`),

    /**
     * Tag links that add to or remove from the tags already filtering a view.
     *
     * These are how faceted filtering works without JavaScript, and they need
     * the tags currently applied — which arrive as the filter's second argument
     * because a filter cannot reach the surrounding template's state.
     */
    {
      name: 'link_to_add_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const tag = stringify(value);
        const current = toTagList(arg(args, 0));
        const next = current.includes(tag) ? current : [...current, tag];
        return tagAnchor(next, stringify(args.positional[1] ?? value));
      },
    },
    {
      name: 'link_to_remove_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const tag = stringify(value);
        const next = toTagList(arg(args, 0)).filter((entry) => entry !== tag);
        return tagAnchor(next, stringify(args.positional[1] ?? value));
      },
    },

    /**
     * Marks the tag currently being filtered on.
     *
     * A `<span>` rather than a link, because linking to the view you are
     * already on is a dead control that screen readers still announce.
     */
    {
      name: 'highlight_active_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const tag = stringify(value);
        const className = stringify(arg(args, 0)) || 'active';
        return `<span class="${escapeHtml(className)}">${escapeHtml(tag)}</span>`;
      },
    },

    /**
     * A product URL scoped to the collection it was reached through.
     *
     * The scoping is what makes "next product" work on a collection page, and
     * it is also why a product has more than one URL — which is precisely the
     * duplicate-content problem the canonical policy in PLAN/07 has to solve.
     */
    {
      name: 'within',
      apply: (_context, value, args) => {
        const url = stringify(value);
        const collection = arg(args, 0) as { handle?: unknown } | null;
        const handle = stringify(collection?.handle);
        if (handle === '' || url === '') return url;
        return `/collections/${handle}${url.startsWith('/') ? url : `/${url}`}`;
      },
    },

    /** A theme asset with a size, the legacy counterpart to `asset_url`. */
    {
      name: 'asset_img_url',
      apply: (context, value, args) =>
        imageUrl(context.assetBaseUrl, join(context.assetBaseUrl, stringify(value)), {
          ...args.named,
          ...sizeToParams(arg(args, 0)),
        }),
    },

    /**
     * A shared asset served for every store, not one theme's copy.
     *
     * Distinct from the branded platform-asset filter: this is for files a
     * theme references by well-known name, so the URL must not vary per store
     * or the browser cache is wasted across the platform.
     */
    {
      name: 'global_asset_url',
      apply: (context, value) => join(context.platformAssetBaseUrl, `global/${stringify(value)}`),
    },

    {
      name: 'payment_type_img_url',
      apply: (context, value) => {
        const type = stringify(value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return type === ''
          ? ''
          : join(context.platformAssetBaseUrl, `payment-icons/${type}.svg`);
      },
    },

    /**
     * A collection URL carrying a sort order.
     *
     * Replaces any existing `sort_by` rather than appending, so chaining it
     * twice does not produce a URL with two of them — which some routers read
     * as the first and some as the last.
     */
    {
      name: 'sort_by',
      apply: (_context, value, args) => {
        const url = stringify(value);
        const order = stringify(arg(args, 0));
        if (url === '' || order === '') return url;

        const [base, query = ''] = url.split('?');
        const params = new URLSearchParams(query);
        params.set('sort_by', order);
        return `${base}?${params.toString()}`;
      },
    },

    { name: 'customer_login_link', ...customerLink('account_login_url') },
    { name: 'customer_logout_link', ...customerLink('account_logout_url') },
    { name: 'customer_register_link', ...customerLink('account_register_url') },
  ],
};

/** `'300x300'`, `'1085x'` and `'x400'` as width/height parameters. */
function sizeToParams(size: unknown): Record<string, string> {
  const text = stringify(size).trim();
  if (text === '') return {};

  // Named sizes the reference product defines, mapped to their pixel widths.
  const NAMED: Readonly<Record<string, string>> = {
    pico: '16', icon: '32', thumb: '50', small: '100',
    compact: '160', medium: '240', large: '480', grande: '600',
    original: '1024', master: '2048',
  };
  if (NAMED[text]) return { width: NAMED[text] as string };

  const match = /^(\d*)x(\d*)$/.exec(text);
  if (!match) return {};
  const params: Record<string, string> = {};
  if (match[1]) params.width = match[1];
  if (match[2]) params.height = match[2];
  return params;
}

function fontUrl(base: string, value: unknown, args: { positional: readonly unknown[] }): string {
  const font = value as { family?: unknown; style?: unknown; weight?: unknown } | null;
  if (!font || typeof font !== 'object') return '';
  const format = stringify(args.positional[0]) || 'woff2';
  const family = handleize(stringify(font.family));
  if (family === '') return '';
  const weight = stringify(font.weight) || '400';
  const style = stringify(font.style) || 'normal';
  return join(base, `fonts/${family}_${style}_${weight}.${format}`);
}

function linkToCollection(name: string, url: (value: string) => string) {
  return {
    name,
    returnsHtml: true,
    apply: (_context: unknown, value: unknown, args: { positional: readonly unknown[] }) => {
      const label = stringify(args.positional[0] ?? value);
      return `<a href="${escapeHtml(url(stringify(value)))}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
    },
  };
}

/** The tags currently applied, however the theme passed them. */
function toTagList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringify).filter((tag) => tag !== '');
  const text = stringify(value);
  return text === '' ? [] : text.split('+').filter((tag) => tag !== '');
}

/** A link to the collection filtered by exactly these tags. */
function tagAnchor(tags: readonly string[], label: string): string {
  const path = tags.length === 0
    ? '/collections/all'
    : `/collections/all/${tags.map(handleize).join('+')}`;
  return `<a href="${escapeHtml(path)}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

function customerLink(route: string) {
  return {
    returnsHtml: true,
    apply: (context: { routes: Readonly<Record<string, string>> }, value: unknown) => {
      const href = context.routes[route] ?? '/';
      return `<a href="${escapeHtml(href)}">${stringify(value)}</a>`;
    },
  };
}
