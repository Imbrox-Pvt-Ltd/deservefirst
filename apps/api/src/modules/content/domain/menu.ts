/**
 * Content · domain/menu.ts
 * Storefront menus: the merchant's own navigation.
 *
 * A menu is a tree, and trees are where the interesting failures live. Three
 * of them are worth stating as rules rather than discovering in production:
 * a cycle makes rendering non-terminating, unbounded depth makes a menu nobody
 * can use on a phone, and an item pointing at a record that has been deleted
 * renders a dead link on the storefront rather than in the admin where somebody
 * would notice.
 * Layer: domain (pure).
 */

import { ContentInvariantError } from './content';

/** What a menu item points at. Mirrors the reference product's link types. */
export type MenuItemTarget =
  | 'home'
  | 'collection'
  | 'product'
  | 'page'
  | 'blog'
  | 'policy'
  | 'search'
  | 'http';

export interface MenuItem {
  readonly id: string;
  readonly title: string;
  readonly target: MenuItemTarget;
  /** The resolved path or absolute URL. Built from the target and its subject. */
  readonly url: string;
  /** The record this points at, when it points at one of ours. */
  readonly subjectId: string | null;
  readonly children: readonly MenuItem[];
}

export interface Menu {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly items: readonly MenuItem[];
  readonly version: number;
}

/**
 * How deep a menu may nest.
 *
 * Three, because that is what the reference product allows and what a drop-down
 * can actually show. This is a product decision rather than a technical limit,
 * and writing it as a constant keeps it arguable.
 */
export const MAX_MENU_DEPTH = 3;

export function assertMenuValid(menu: Menu): void {
  if (menu.title.trim().length === 0) {
    throw new ContentInvariantError('title', 'is required');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(menu.handle)) {
    throw new ContentInvariantError('handle', 'must be lowercase letters, digits and hyphens');
  }

  const seen = new Set<string>();
  assertItemsValid(menu.items, 1, seen);
}

function assertItemsValid(items: readonly MenuItem[], depth: number, seen: Set<string>): void {
  // Nothing at this level is not a violation of the depth limit. Checking
  // before this returned rejected a perfectly legal three-level menu, because
  // the deepest item still recurses once into its own empty children.
  if (items.length === 0) return;

  if (depth > MAX_MENU_DEPTH) {
    throw new ContentInvariantError(
      'items',
      `a menu can nest ${MAX_MENU_DEPTH} levels deep; this one goes further`,
    );
  }

  for (const item of items) {
    if (item.title.trim().length === 0) {
      throw new ContentInvariantError('items', 'every menu item needs a title');
    }

    // A repeated id means the same item appears twice in the tree, which is
    // how a cycle is represented once the tree has been flattened and rebuilt.
    if (seen.has(item.id)) {
      throw new ContentInvariantError('items', `"${item.title}" appears more than once in this menu`);
    }
    seen.add(item.id);

    if (item.target === 'http') {
      assertExternalUrl(item.url);
    } else if (!item.url.startsWith('/')) {
      throw new ContentInvariantError(
        'items',
        `"${item.title}" links inside the store, so its URL must start with "/"`,
      );
    }

    // Everything except home, search and an external link points AT something.
    const needsSubject = !['home', 'search', 'http'].includes(item.target);
    if (needsSubject && item.subjectId === null) {
      throw new ContentInvariantError(
        'items',
        `"${item.title}" points at a ${item.target} but does not say which one`,
      );
    }

    assertItemsValid(item.children, depth + 1, seen);
  }
}

function assertExternalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ContentInvariantError('items', `"${url}" is not a valid link`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    // `javascript:` in a menu item is stored XSS on the storefront.
    throw new ContentInvariantError('items', 'an external link must be http or https');
  }
}

/** Every item in the tree, depth first — for counting and for link checking. */
export function flatten(items: readonly MenuItem[]): readonly MenuItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

/**
 * Menu items whose subject no longer exists.
 *
 * Returned rather than removed. A merchant who deleted a page probably wants to
 * know their menu now points nowhere; silently dropping the item hides the
 * consequence and they find out from a customer.
 */
export function brokenLinks(
  menu: Menu,
  exists: (target: MenuItemTarget, subjectId: string) => boolean,
): readonly MenuItem[] {
  return flatten(menu.items).filter(
    (item) => item.subjectId !== null && !exists(item.target, item.subjectId),
  );
}
