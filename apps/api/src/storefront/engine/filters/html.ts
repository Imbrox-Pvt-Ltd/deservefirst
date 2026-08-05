/**
 * Storefront · engine/filters/html.ts
 * Filters that build markup.
 *
 * These are the only filters marked `returnsHtml`, which means the engine will
 * not escape what they return — so every theme-supplied value inside them is
 * escaped here, through `attributes()` and `escapeHtml()`. Nothing in this file
 * concatenates a raw value into a tag.
 *
 * `image_tag` earns its complexity: it is what generates the `srcset` that makes
 * a storefront fast on a phone, and getting it right once here is better than
 * every theme author writing the same loop.
 * Layer: engine.
 */

import { attributes, escapeHtml, safeUrl, type AttributeValue } from '../markup';
import { arg, numberArg, stringify, type FilterDefinition, type FilterGroup } from '../types';

/**
 * Named arguments a theme may pass straight onto the tag.
 *
 * Split from the filter's own options — `widths` configures the srcset and is
 * not itself an attribute — so a typo in an option name does not silently
 * become an attribute on the element.
 */
function passthroughAttributes(
  named: Readonly<Record<string, unknown>>,
  consumed: readonly string[],
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(named)) {
    if (consumed.includes(key)) continue;
    out[key] = value as AttributeValue;
  }
  return out;
}

/** Adds or replaces a width parameter on an already-built image URL. */
function atWidth(url: string, width: number): string {
  const [base, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('width', String(width));
  return `${base}?${params.toString()}`;
}

/** `'90, 180, 270'` as a srcset, dropping anything wider than the source. */
function buildSrcset(url: string, widths: unknown, sourceWidth: number | null): string {
  const list = stringify(widths)
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((width) => Number.isFinite(width) && width > 0)
    // Asking the image service to upscale produces a blurry image at a larger
    // file size, which is the opposite of what a srcset is for.
    .filter((width) => sourceWidth === null || width <= sourceWidth);

  return list.map((width) => `${atWidth(url, width)} ${width}w`).join(', ');
}

const imageTag: FilterDefinition = {
  name: 'image_tag',
  returnsHtml: true,
  apply: (_context, value, args) => {
    const url = safeUrl(stringify(value));
    if (url === '') return '';

    const named = args.named;
    const consumed = ['widths', 'preload', 'width', 'height', 'alt', 'src'];

    const sourceWidth = named.width === undefined ? null : numberArg(named.width, 0) || null;
    const srcset = named.widths === undefined ? '' : buildSrcset(url, named.widths, sourceWidth);

    const built = attributes({
      src: url,
      srcset: srcset === '' ? null : srcset,
      width: named.width === undefined ? null : (named.width as AttributeValue),
      height: named.height === undefined ? null : (named.height as AttributeValue),
      // Always present, even when empty: an image with no alt attribute at all
      // is read aloud as its filename, whereas alt="" is skipped.
      alt: stringify(named.alt),
      ...passthroughAttributes(named, consumed),
    });

    // `alt=""` is meaningful and `attributes()` drops empty strings, so it is
    // put back rather than the rule being loosened for everything.
    const withAlt = built.includes(' alt=') ? built : `${built} alt=""`;
    return `<img${withAlt}>`;
  },
};

export const htmlFilters: FilterGroup = {
  name: 'html',
  filters: [
    imageTag,

    {
      name: 'stylesheet_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const href = safeUrl(stringify(value));
        if (href === '') return '';
        const preload = args.named.preload === true || arg(args, 0) === 'preload';
        const link = `<link rel="stylesheet" href="${escapeHtml(href)}"${
          args.named.media ? ` media="${escapeHtml(stringify(args.named.media))}"` : ''
        }>`;
        // The preload goes first, which is the whole point — a preload emitted
        // after the stylesheet it preloads has no effect.
        return preload
          ? `<link rel="preload" href="${escapeHtml(href)}" as="style">${link}`
          : link;
      },
    },

    {
      name: 'script_tag',
      returnsHtml: true,
      apply: (_context, value) => {
        const src = safeUrl(stringify(value));
        return src === '' ? '' : `<script src="${escapeHtml(src)}" defer="defer"></script>`;
      },
    },

    {
      name: 'video_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const media = value as { sources?: unknown; preview_image?: unknown } | null;
        const sources = Array.isArray(media?.sources) ? media.sources : [];
        if (sources.length === 0) return '';

        const consumed = ['image_size', 'poster'];
        const poster = stringify(
          args.named.poster ?? (media?.preview_image as { src?: unknown } | undefined)?.src,
        );

        const inner = sources
          .map((source) => {
            const entry = source as { url?: unknown; mime_type?: unknown };
            const url = safeUrl(stringify(entry.url));
            if (url === '') return '';
            return `<source src="${escapeHtml(url)}" type="${escapeHtml(stringify(entry.mime_type))}">`;
          })
          .join('');

        return `<video${attributes({
          poster: poster === '' ? null : poster,
          playsinline: true,
          ...passthroughAttributes(args.named, consumed),
        })}>${inner}</video>`;
      },
    },

    {
      name: 'external_video_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const media = value as { host?: unknown; external_id?: unknown } | null;
        const host = String(media?.host ?? '').toLowerCase();
        const id = stringify(media?.external_id);
        if (id === '') return '';

        const src =
          host === 'youtube'
            ? `https://www.youtube.com/embed/${encodeURIComponent(id)}`
            : host === 'vimeo'
              ? `https://player.vimeo.com/video/${encodeURIComponent(id)}`
              : '';
        if (src === '') return '';

        return `<iframe${attributes({
          src,
          frameborder: '0',
          allowfullscreen: true,
          ...passthroughAttributes(args.named, ['image_size']),
        })}></iframe>`;
      },
    },

    /**
     * Dispatches on the media type, so a theme can render a gallery item
     * without knowing what kind it is.
     *
     * The reference theme calls this inside a `case media.media_type`, which
     * looks redundant until you notice it only reaches `media_tag` for the
     * types it does not special-case.
     */
    {
      name: 'media_tag',
      returnsHtml: true,
      apply: (context, value, args) => {
        const media = value as { media_type?: unknown } | null;
        const type = String(media?.media_type ?? '');
        const group = htmlFilters.filters;
        const delegate = (name: string) =>
          group.find((filter) => filter.name === name)?.apply(context, value, args) ?? '';

        if (type === 'video') return delegate('video_tag');
        if (type === 'external_video') return delegate('external_video_tag');
        if (type === 'model') return delegate('model_viewer_tag');
        return delegate('image_tag');
      },
    },

    {
      name: 'model_viewer_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const media = value as { sources?: unknown; preview_image?: unknown } | null;
        const sources = Array.isArray(media?.sources) ? media.sources : [];
        const glb = sources.find(
          (source) => String((source as { format?: unknown }).format ?? '') === 'glb',
        ) as { url?: unknown } | undefined;
        const src = safeUrl(stringify(glb?.url));
        if (src === '') return '';

        return `<model-viewer${attributes({
          src,
          poster: stringify((media?.preview_image as { src?: unknown } | undefined)?.src) || null,
          'camera-controls': true,
          ...passthroughAttributes(args.named, ['image_size', 'toggleable']),
        })}></model-viewer>`;
      },
    },

    /**
     * The grey placeholder a theme shows where a merchant has not set an image.
     *
     * Inline SVG rather than a file, because it appears on an empty store's
     * every page and a request per placeholder is a slow first impression.
     */
    {
      name: 'placeholder_svg_tag',
      returnsHtml: true,
      apply: (_context, value, args) => {
        const className = stringify(arg(args, 0) ?? 'placeholder-svg');
        const label = stringify(value);
        return (
          `<svg class="${escapeHtml(className)}" role="img" aria-label="${escapeHtml(label)}" ` +
          `viewBox="0 0 525 525" preserveAspectRatio="xMidYMid slice" focusable="false">` +
          `<rect width="525" height="525" fill="currentColor" opacity="0.08"/>` +
          `</svg>`
        );
      },
    },

    /**
     * A payment-method icon.
     *
     * The name is handleized before it reaches a URL: this value comes from
     * data, and `../../` in a path that becomes a request is worth closing off
     * even when the current caller is a fixed list.
     */
    {
      name: 'payment_type_svg_tag',
      returnsHtml: true,
      apply: (context, value, args) => {
        const type = stringify(value).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (type === '') return '';
        const src = `${context.platformAssetBaseUrl.replace(/\/+$/, '')}/payment-icons/${type}.svg`;
        return `<img${attributes({
          src,
          alt: type,
          ...passthroughAttributes(args.named, []),
        })}>`;
      },
    },

    /**
     * The contents of a theme file, inlined.
     *
     * Themes use it for small critical CSS. It reads through the context's
     * loader rather than the filesystem, so a theme cannot name a path outside
     * its own files — the loader is where that boundary is enforced.
     */
    {
      name: 'inline_asset_content',
      returnsHtml: true,
      apply: (context, value) => context.readAsset?.(stringify(value)) ?? '',
    },
  ],
};
