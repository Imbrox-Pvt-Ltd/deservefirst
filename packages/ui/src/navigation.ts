/**
 * UI · navigation.ts
 * The admin shell's navigation model. Core sections are fixed; module sections
 * are contributed from manifests, so enabling a module makes its nav entry
 * appear and disabling it makes the entry and its routes vanish (§8.2). One
 * toggle, no clutter.
 * Layer: ui (pure data; no React).
 */

import { storePaths } from '@deservefirst/contracts';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly permission: string;
  /** Named from the reference admin's icon set; the shell maps it to a glyph. */
  readonly icon?: string;
  /**
   * True when the reference admin shows this section but no module in this
   * install provides it. The entry still renders — the information architecture
   * is the reference product's, and hiding half of it would misrepresent the
   * shape of the admin — but it resolves to an honest "not in this install"
   * screen rather than a dead link.
   */
  readonly unavailable?: boolean;
  readonly children?: readonly Omit<NavItem, 'children'>[];
}

export interface NavSection {
  readonly id: 'primary' | 'sales-channels' | 'apps';
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

/** Marks a reference section that no module in this install provides yet. */
const soon = <T extends { id: string }>(item: T): T & { unavailable: true } => ({
  ...item,
  unavailable: true,
});

/**
 * The reference admin's information architecture: every primary section, in the
 * captured order, with the sub-items that appear beneath the open one.
 *
 * This is the *shape* of the admin, not a claim about what is built. Sections a
 * module provides are taken over by that module through `composeNavigation`;
 * the rest stay marked `unavailable` and resolve to a placeholder. Declaring the
 * whole structure and letting modules claim their part is what keeps the menu
 * stable as modules land — the alternative, growing the menu one entry at a
 * time, means the navigation is a different shape in every install.
 */
export function coreNavigation(handle: string): NavSection[] {
  return [
    {
      id: 'primary',
      label: null,
      items: [
        { id: 'home', label: 'Home', path: storePaths.root(handle), permission: 'store.read', icon: 'home' },
        {
          id: 'orders',
          label: 'Orders',
          path: storePaths.orders(handle),
          permission: 'orders.read',
          icon: 'orders',
          children: [
            soon({ id: 'drafts', label: 'Drafts', path: storePaths.draftOrders(handle), permission: 'orders.read' }),
          ],
        },
        {
          id: 'products',
          label: 'Products',
          path: storePaths.products(handle),
          permission: 'catalog.read',
          icon: 'products',
          children: [
            { id: 'collections', label: 'Collections', path: storePaths.collections(handle), permission: 'catalog.read' },
            { id: 'inventory', label: 'Inventory', path: storePaths.inventory(handle), permission: 'inventory.read' },
            {
              id: 'purchase-orders',
              label: 'Purchase orders',
              path: storePaths.purchaseOrders(handle),
              permission: 'inventory.read',
            },
            { id: 'transfers', label: 'Transfers', path: storePaths.transfers(handle), permission: 'inventory.read' },
            soon({ id: 'gift-cards', label: 'Gift cards', path: storePaths.giftCards(handle), permission: 'catalog.read' }),
          ],
        },
        {
          id: 'customers',
          label: 'Customers',
          path: storePaths.customers(handle),
          permission: 'customers.read',
          icon: 'customers',
          children: [
            soon({
              id: 'segments',
              label: 'Segments',
              path: storePaths.customerSegments(handle),
              permission: 'customers.read',
            }),
            soon({ id: 'companies', label: 'Companies', path: storePaths.companies(handle), permission: 'customers.read' }),
          ],
        },
        soon({ id: 'growth', label: 'Growth', path: storePaths.growth(handle), permission: 'store.read', icon: 'growth' }),
        soon({
          id: 'discounts',
          label: 'Discounts',
          path: storePaths.discounts(handle),
          permission: 'store.read',
          icon: 'discounts',
        }),
        {
          // "Content" opens the Pages list — which is why Pages is not repeated
          // as a child below. That matches both the captured nav (Metaobjects,
          // Files, Menus, Blog posts) and the captured URL `/store/{h}/pages/new`.
          id: 'content',
          label: 'Content',
          path: storePaths.pages(handle),
          permission: 'content.read',
          icon: 'content',
          children: [
            { id: 'metaobjects', label: 'Metaobjects', path: storePaths.metaobjects(handle), permission: 'content.read' },
            soon({ id: 'files', label: 'Files', path: storePaths.files(handle), permission: 'content.read' }),
            soon({ id: 'menus', label: 'Menus', path: storePaths.navigation(handle), permission: 'content.read' }),
            soon({ id: 'blog-posts', label: 'Blog posts', path: storePaths.blogs(handle), permission: 'content.read' }),
          ],
        },
        soon({ id: 'markets', label: 'Markets', path: storePaths.markets(handle), permission: 'store.read', icon: 'markets' }),
        soon({
          id: 'analytics',
          label: 'Analytics',
          path: storePaths.analytics(handle),
          permission: 'store.read',
          icon: 'analytics',
        }),
      ],
    },
    {
      id: 'sales-channels',
      label: 'Sales channels',
      items: [
        soon({
          id: 'online-store',
          label: 'Online Store',
          path: storePaths.onlineStore(handle),
          permission: 'store.read',
          icon: 'online-store',
        }),
        soon({ id: 'agentic', label: 'Agentic', path: storePaths.agentic(handle), permission: 'store.read', icon: 'agentic' }),
      ],
    },
    { id: 'apps', label: 'Apps', items: [] },
  ];
}

/** A nav entry contributed by a module, and where it belongs. */
export interface ContributedNavItem {
  readonly section: NavSection['id'];
  readonly item: NavItem;
  readonly position: number;
  /** Nests the entry under a core item — see NavigationDeclaration.parentId. */
  readonly parentId?: string;
}

/**
 * Merges module-contributed items into the reference sections. A module never
 * edits this file; it declares navigation in its manifest and the registry
 * supplies it here (§31.2).
 *
 * Entries merge BY ID rather than being appended. A module claiming `inventory`
 * takes over the reference entry — it does not add a second one beside it, which
 * is exactly the bug this replaced: the inventory module contributed three
 * top-level items that already existed as children of Products, so the admin
 * showed both.
 */
export function composeNavigation(
  handle: string,
  contributed: readonly ContributedNavItem[],
  grantedPermissions: ReadonlySet<string>,
): NavSection[] {
  const sections = coreNavigation(handle);

  return sections.map((section) => {
    const items = section.items.map((item) => ({ ...item }));
    const extras = [...contributed.filter((entry) => entry.section === section.id)].sort(
      (a, b) => a.position - b.position,
    );

    for (const entry of extras) {
      const target = entry.parentId
        ? items.find((item) => item.id === entry.parentId)
        : undefined;

      // A parent named but not found: the entry is dropped rather than silently
      // promoted to top level. assertNavigationParents turns this into a boot
      // failure so it never reaches a running admin.
      if (entry.parentId && !target) continue;

      if (target) {
        target.children = mergeById(target.children ?? [], entry.item);
      } else {
        const at = items.findIndex((item) => item.id === entry.item.id);
        if (at === -1) {
          items.push({ ...entry.item });
        } else {
          const current = items[at]!;
          // A module now provides it, so the reference placeholder's
          // `unavailable` is cleared; its children are kept, because those come
          // from other modules contributing under this parent.
          items[at] = {
            ...current,
            ...defined(entry.item),
            children: current.children,
            unavailable: false,
          };
        }
      }
    }

    return {
      ...section,
      items: items
        .filter((item) => grantedPermissions.has(item.permission))
        .map((item) => ({
          ...item,
          // A parent may be visible while some children are not.
          ...(item.children
            ? { children: item.children.filter((child) => grantedPermissions.has(child.permission)) }
            : {}),
        })),
    };
  });
}

/** Replaces the child with this id, keeping its position, or appends it. */
function mergeById(
  children: readonly Omit<NavItem, 'children'>[],
  item: NavItem,
): Omit<NavItem, 'children'>[] {
  const next = children.map((child) => ({ ...child }));
  const at = next.findIndex((child) => child.id === item.id);
  const { children: _ignored, ...flat } = item;
  if (at === -1) next.push(flat);
  else next[at] = { ...next[at], ...defined(flat), unavailable: false };
  return next;
}

/**
 * Drops keys whose value is `undefined` so they do not overwrite what the
 * reference entry already provides.
 *
 * A module contributing `{ id: 'customers', label: 'Customers' }` carries
 * `icon: undefined` once it has been through a DTO, and a plain spread lets that
 * absence erase the reference icon — which is precisely what it did: every
 * module-owned section lost its glyph and rendered at child indentation.
 */
function defined<T extends object>(value: T): T {
  // Typed as T rather than Partial<T>: only keys that were explicitly undefined
  // are dropped, and a required key is never undefined at runtime. Partial<T>
  // would be more literally accurate and would make every spread of the result
  // lose the required fields it is being merged into.
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/**
 * Fails the boot when a module nests navigation under an id that does not exist
 * (§31.7). Capability contracts fail loudly for the same reason: a typo'd
 * `parentId` would otherwise be a menu entry that simply never appears, and a
 * missing menu entry produces a bug report about the *feature* being broken.
 */
export function assertNavigationParents(
  handle: string,
  contributed: readonly ContributedNavItem[],
): void {
  const known = new Set(coreNavigation(handle).flatMap((s) => s.items.map((i) => i.id)));
  const declared = new Set(contributed.map((entry) => entry.item.id));

  for (const entry of contributed) {
    if (!entry.parentId) continue;
    if (known.has(entry.parentId) || declared.has(entry.parentId)) continue;
    throw new Error(
      `navigation entry "${entry.item.id}" declares parentId "${entry.parentId}", ` +
        `which is not a known navigation entry`,
    );
  }
}

/** The settings rail, in the order the reference product renders it. */
export const SETTINGS_NAV: readonly { id: string; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'plan', label: 'Plan' },
  { id: 'billing', label: 'Billing' },
  { id: 'payments', label: 'Payments' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'customer_accounts', label: 'Customer accounts' },
  { id: 'shipping', label: 'Shipping and delivery' },
  { id: 'taxes', label: 'Taxes and duties' },
  { id: 'locations', label: 'Locations' },
  { id: 'markets', label: 'Markets' },
  { id: 'apps', label: 'Apps' },
  { id: 'sales_channels', label: 'Sales channels' },
  { id: 'domains', label: 'Domains' },
  { id: 'customer_events', label: 'Customer events' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'custom_data', label: 'Metafields and metaobjects' },
  { id: 'languages', label: 'Languages' },
  { id: 'privacy', label: 'Customer privacy' },
  { id: 'policies', label: 'Policies' },
];
