'use client';

/**
 * Web · app/store/[handle]/customers/segments/page.tsx
 * Segments — declared in the navigation, not provided by any module here.
 *
 * This exists as its own file rather than falling through to the store-level
 * catch-all, because the catch-all only sees paths nothing else claims and
 * `/customers/[id]` claims this one. Without it, opening Segments rendered
 * "This customer does not exist in this store" — a section of the admin
 * reported as a missing record, which is both wrong and alarming.
 *
 * Any other unbuilt section nested under a dynamic segment needs the same
 * treatment; a top-level one does not.
 * Layer: web.
 */

import { UnavailableSection } from '@deservefirst/ui';

export default function SegmentsPage() {
  return <UnavailableSection title="Segments" />;
}
