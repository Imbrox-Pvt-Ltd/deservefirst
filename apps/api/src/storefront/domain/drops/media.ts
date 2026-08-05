/**
 * Storefront · domain/drops/media.ts
 * Media of any kind, and metafields.
 *
 * Together because they share a shape: both are a typed value a theme renders
 * without necessarily knowing the type, which is what `media_tag` and
 * `metafield_tag` exist for. A gallery loops over media and each item might be a
 * photo, a video or a 3D model; a product page loops over metafields and each
 * might be text, a rating or a file.
 *
 * `media_type` and `type` are therefore load-bearing rather than decorative:
 * they are how a theme decides what to render, and a drop that omitted them
 * would force every theme to guess from the shape of the value.
 * Layer: domain (pure).
 */

import { defineDrop, dropList } from './define';

export interface MediaSourceRow {
  readonly url: string;
  readonly mimeType?: string | null;
  readonly format?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface MediaRow {
  readonly id: string;
  /** `image`, `video`, `external_video` or `model`. */
  readonly mediaType: string;
  readonly alt?: string | null;
  readonly position?: number | null;
  readonly previewImageSrc?: string | null;
  readonly previewWidth?: number | null;
  readonly previewHeight?: number | null;
  readonly sources?: readonly MediaSourceRow[] | null;
  /** For external video only. */
  readonly host?: string | null;
  readonly externalId?: string | null;
  /** For a plain image, the image itself. */
  readonly src?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface MetafieldRow {
  readonly namespace: string;
  readonly key: string;
  readonly type: string;
  readonly value: unknown;
}

export const mediaSourceDrop = defineDrop<MediaSourceRow>('media_source', {
  url: (source) => source.url,
  mime_type: (source) => source.mimeType ?? '',
  format: (source) => source.format ?? '',
  width: (source) => source.width ?? null,
  height: (source) => source.height ?? null,
});

export const mediaDrop = defineDrop<MediaRow>('media', {
  id: (media) => media.id,
  /** What this is. Themes branch on it before rendering. */
  media_type: (media) => media.mediaType,
  alt: (media) => media.alt ?? '',
  position: (media) => media.position ?? 1,

  /**
   * A still for every media type, including the ones that are not images.
   *
   * A gallery renders thumbnails before anything plays, so a video without a
   * preview is a blank tile. Falling back to the media's own src covers the
   * plain-image case without the theme branching.
   */
  preview_image: (media) => {
    const src = media.previewImageSrc ?? media.src;
    if (!src) return null;
    return {
      src,
      width: media.previewWidth ?? media.width ?? null,
      height: media.previewHeight ?? media.height ?? null,
      alt: media.alt ?? '',
    };
  },

  sources: (media, context) => dropList(mediaSourceDrop, media.sources ?? [], context),
  host: (media) => media.host ?? null,
  external_id: (media) => media.externalId ?? null,

  src: (media) => media.src ?? null,
  width: (media) => media.width ?? null,
  height: (media) => media.height ?? null,
  aspect_ratio: (media) => {
    const width = media.width ?? media.previewWidth;
    const height = media.height ?? media.previewHeight;
    return width && height ? Number((width / height).toFixed(4)) : null;
  },
});

export const metafieldDrop = defineDrop<MetafieldRow>('metafield', {
  namespace: (field) => field.namespace,
  key: (field) => field.key,
  /** The declared type, which is what `metafield_tag` dispatches on. */
  type: (field) => field.type,
  value: (field) => field.value,
  /**
   * True when there is genuinely nothing here.
   *
   * Themes write `{% unless product.metafields.custom.care.value == blank %}`,
   * and an empty string, an empty array and a missing value all have to answer
   * the same way or the check is unreliable.
   */
  empty: (field) => {
    const { value } = field;
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.length === 0;
    return false;
  },
});
