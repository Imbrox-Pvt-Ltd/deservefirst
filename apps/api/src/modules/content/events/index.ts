/**
 * Content · events/index.ts
 * Events this module emits. Publication matters to SEO, which listens to keep
 * the sitemap current (§34.1).
 * Layer: events.
 */

export const CONTENT_EVENTS = {
  pagePublished: 'content.page.published',
  pageUnpublished: 'content.page.unpublished',
  definitionCreated: 'content.definition.created',
} as const;

export type ContentEventType = (typeof CONTENT_EVENTS)[keyof typeof CONTENT_EVENTS];
