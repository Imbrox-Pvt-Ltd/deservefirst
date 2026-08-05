/**
 * Storefront · events/index.ts
 * The events this module emits.
 *
 * Named here rather than written as a string at each site, because the
 * consumers of `themePublished` include the page cache — and a rename that
 * silently stopped clearing it would leave every storefront serving the theme
 * a merchant had just replaced, with nothing failing anywhere.
 * Layer: events.
 */

export const STOREFRONT_EVENTS = {
  themePublished: 'storefront.theme.published',
} as const;

export type StorefrontEventType = (typeof STOREFRONT_EVENTS)[keyof typeof STOREFRONT_EVENTS];
