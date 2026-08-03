/**
 * Core · entity-toolkit/saved-views.ts
 * Saved views and tags (§12.1, §12.6). A saved view is a named filter+sort+column
 * set — the tabs above every list. Because all of it lives in the URL, a view is
 * just a stored URL fragment, which is why sharing one works with no extra
 * machinery.
 * Layer: core.
 */

import {
  type ListQuery,
  parseListQuery,
  type SavedView,
  serializeListQuery,
  type StoreId,
  type UserId,
} from '@deservefirst/contracts';

export interface SavedViewRecord extends SavedView {
  readonly storeId: StoreId;
  readonly ownerId: UserId | null;
  readonly system: boolean;
}

/** Every list opens with an "All" tab that no one can delete or reorder away. */
export function defaultView(storeId: StoreId, entity: string): SavedViewRecord {
  return {
    id: `system:${entity}:all`,
    storeId,
    entity,
    name: 'All',
    query: '',
    sort: null,
    columns: [],
    shared: true,
    position: 0,
    ownerId: null,
    system: true,
  };
}

/** Turns a saved view back into list state — the same state the URL carries. */
export function viewToListQuery(view: SavedView): ListQuery {
  const params = new URLSearchParams();
  if (view.query) params.set('query', view.query);
  if (view.sort) params.set('order', `${view.sort.field} ${view.sort.direction}`);
  if (view.columns.length > 0) params.set('selectedColumns', view.columns.join(','));
  params.set('savedViewId', view.id);
  return parseListQuery(params);
}

/** The URL a view's tab links to. */
export function viewToPath(basePath: string, view: SavedView): string {
  const params = serializeListQuery(viewToListQuery(view));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Whether the current list state differs from the view it claims to be — this is
 * what drives the "Save" button appearing beside the tab.
 */
export function isViewDirty(view: SavedView, current: ListQuery): boolean {
  const base = viewToListQuery(view);
  return (
    serializeListQuery({ ...base, savedViewId: null }).toString() !==
    serializeListQuery({ ...current, savedViewId: null, cursor: null, before: null, selectedId: null, dialog: null }).toString()
  );
}

/**
 * Views visible to a user: shared ones plus their own. Ordering is explicit
 * rather than by creation date, because tab order is a merchant preference.
 */
export function visibleViews(
  views: readonly SavedViewRecord[],
  userId: UserId | null,
): SavedViewRecord[] {
  return views
    .filter((view) => view.shared || (userId !== null && view.ownerId === userId))
    .sort((a, b) => a.position - b.position);
}

// --- tags -------------------------------------------------------------------

export interface TagAssignment {
  readonly storeId: StoreId;
  readonly ownerEntity: string;
  readonly ownerId: string;
  readonly tag: string;
}

/**
 * Tags are free-form but normalised, so "Sale", "sale" and " sale " are one tag
 * rather than three that filter differently.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').slice(0, 255);
}

export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
