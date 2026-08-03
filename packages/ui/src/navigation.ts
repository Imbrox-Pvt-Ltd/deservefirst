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
  readonly children?: readonly Omit<NavItem, 'children'>[];
}

export interface NavSection {
  readonly id: 'primary' | 'sales-channels' | 'apps';
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

/**
 * The primary sections and their order, matching the captured reference admin.
 * `Growth` and `Finance` are included deliberately — the original architecture
 * URL map omitted both.
 */
export function coreNavigation(handle: string): NavSection[] {
  return [
    {
      id: 'primary',
      label: null,
      items: [
        { id: 'home', label: 'Home', path: storePaths.root(handle), permission: 'store.read' },
        {
          id: 'orders',
          label: 'Orders',
          path: storePaths.orders(handle),
          permission: 'orders.read',
          children: [
            { id: 'drafts', label: 'Drafts', path: storePaths.draftOrders(handle), permission: 'orders.read' },
            {
              id: 'shipping-labels',
              label: 'Shipping labels',
              path: storePaths.shippingLabels(handle),
              permission: 'orders.read',
            },
            {
              id: 'abandoned',
              label: 'Abandoned checkouts',
              path: storePaths.abandonedCheckouts(handle),
              permission: 'orders.read',
            },
          ],
        },
        {
          id: 'products',
          label: 'Products',
          path: storePaths.products(handle),
          permission: 'catalog.read',
          children: [
            {
              id: 'collections',
              label: 'Collections',
              path: storePaths.collections(handle),
              permission: 'catalog.read',
            },
            {
              id: 'inventory',
              label: 'Inventory',
              path: storePaths.inventory(handle),
              permission: 'catalog.read',
            },
            {
              id: 'purchase-orders',
              label: 'Purchase orders',
              path: storePaths.purchaseOrders(handle),
              permission: 'catalog.write',
            },
            {
              id: 'transfers',
              label: 'Transfers',
              path: storePaths.transfers(handle),
              permission: 'catalog.write',
            },
            { id: 'gift-cards', label: 'Gift cards', path: storePaths.giftCards(handle), permission: 'catalog.read' },
          ],
        },
        {
          id: 'customers',
          label: 'Customers',
          path: storePaths.customers(handle),
          permission: 'customers.read',
          children: [
            {
              id: 'segments',
              label: 'Segments',
              path: storePaths.customerSegments(handle),
              permission: 'customers.read',
            },
            {
              id: 'companies',
              label: 'Companies',
              path: storePaths.companies(handle),
              permission: 'customers.read',
            },
          ],
        },
        { id: 'growth', label: 'Growth', path: storePaths.growth(handle), permission: 'growth.read' },
        { id: 'discounts', label: 'Discounts', path: storePaths.discounts(handle), permission: 'discounts.read' },
        { id: 'content', label: 'Content', path: storePaths.content(handle), permission: 'content.read' },
        { id: 'markets', label: 'Markets', path: storePaths.markets(handle), permission: 'markets.read' },
        { id: 'finance', label: 'Finance', path: storePaths.finance(handle), permission: 'finance.read' },
        { id: 'analytics', label: 'Analytics', path: storePaths.analytics(handle), permission: 'analytics.read' },
      ],
    },
    {
      id: 'sales-channels',
      label: 'Sales channels',
      items: [
        {
          id: 'online-store',
          label: 'Online Store',
          path: storePaths.onlineStore(handle),
          permission: 'online-store.read',
        },
      ],
    },
    { id: 'apps', label: 'Apps', items: [] },
  ];
}

/**
 * Merges module-contributed items into the core sections. A module never edits
 * this file; it declares navigation in its manifest and the registry supplies it
 * here (§31.2).
 */
export function composeNavigation(
  handle: string,
  contributed: readonly { section: NavSection['id']; item: NavItem; position: number }[],
  grantedPermissions: ReadonlySet<string>,
): NavSection[] {
  const sections = coreNavigation(handle);

  return sections.map((section) => {
    const extras = contributed
      .filter((entry) => entry.section === section.id)
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.item);

    const items = [...section.items, ...extras].filter((item) =>
      grantedPermissions.has(item.permission),
    );

    return {
      ...section,
      items: items.map((item) => ({
        ...item,
        // A parent may be visible while some children are not.
        ...(item.children
          ? { children: item.children.filter((child) => grantedPermissions.has(child.permission)) }
          : {}),
      })),
    };
  });
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
