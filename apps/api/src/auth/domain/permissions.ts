/**
 * Auth · domain/permissions.ts
 * The permission catalogue, organised by role category. A role first picks a
 * category — organization, store, point-of-sale or partner — and that decides
 * which permissions may be granted at all. The spec's flat `Role.permissions[]`
 * (§4.2) had no such dimension; the reference product does, and without it an
 * organization role can be handed register-drawer permissions that mean nothing.
 * Layer: domain (pure).
 */

import type { PermissionGroup, RoleCategory } from '@deservefirst/contracts';

export interface PermissionDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly categories: readonly RoleCategory[];
  /**
   * Permissions that can expose or move money, and are therefore candidates for
   * requiring a second approver (§ the approval primitive).
   */
  readonly sensitive?: boolean;
}

const define = (
  group: string,
  categories: readonly RoleCategory[],
  entries: readonly [key: string, label: string, description: string, sensitive?: boolean][],
): PermissionDefinition[] =>
  entries.map(([key, label, description, sensitive]) => ({
    key,
    label,
    description,
    group,
    categories,
    ...(sensitive ? { sensitive: true } : {}),
  }));

/**
 * Platform-owned permissions. Module permissions are contributed by manifests
 * and merged in at boot — this is the fixed core, not the whole set.
 */
export const CORE_PERMISSIONS: readonly PermissionDefinition[] = [
  ...define('Organization', ['organization'], [
    ['organization.read', 'View organization', 'See organization details and the store list.'],
    ['organization.manage', 'Manage organization', 'Rename the organization and change its settings.'],
    ['organization.users.read', 'View users', 'See who has access to the organization.'],
    ['organization.users.manage', 'Manage users', 'Invite, edit and remove users.', true],
    ['organization.roles.manage', 'Manage roles', 'Create and edit custom roles and their permissions.', true],
    ['organization.security.manage', 'Manage security policy', 'Require secure sign-in and set session rules.', true],
    ['organization.entities.manage', 'Manage business entities', 'Add and archive legal entities.', true],
  ]),

  ...define('Stores', ['organization'], [
    ['stores.read', 'View stores', 'See the stores in this organization.'],
    ['stores.create', 'Create stores', 'Create development and live stores.'],
    ['stores.transfer', 'Transfer stores', 'Hand a store to a client or another organization.', true],
    ['stores.close', 'Close stores', 'Pause or close a store.', true],
  ]),

  ...define('Store', ['store', 'organization'], [
    ['store.read', 'View store', 'Open the store admin.'],
    ['store.settings.read', 'View settings', 'See store settings.'],
    ['store.settings.manage', 'Manage settings', 'Change store settings.'],
    ['store.activity.read', 'View activity', 'See the store activity and audit log.'],
    ['store.staff.manage', 'Manage staff', 'Invite and remove staff on this store.', true],
  ]),

  ...define('Finance', ['organization', 'store'], [
    ['finance.read', 'View financials', 'See payouts, balances and financial reports.', true],
    ['finance.credits.manage', 'Manage credits and refunds', 'Issue credits and approve refunds.', true],
  ]),

  ...define('Marketing and referrals', ['organization', 'partner'], [
    ['referrals.read', 'View referrals', 'See referral activity and status.'],
    ['referrals.manage', 'Manage referrals', 'Submit and manage referrals and leads.'],
  ]),

  ...define('Distribution', ['partner'], [
    ['distribution.listings.manage', 'Manage directory listings', 'Submit and maintain partner directory listings.'],
  ]),

  ...define('App store', ['partner', 'organization'], [
    ['apps.submit', 'Submit apps', 'Submit an app for review.'],
    ['apps.listing.manage', 'Manage app listing', 'Edit an app’s public listing.'],
  ]),

  ...define('Theme store', ['partner', 'organization'], [
    ['themes.submit', 'Submit themes', 'Submit a theme for review.'],
    ['themes.listing.manage', 'Manage theme listing', 'Edit a theme’s public listing.'],
  ]),

  // Point of sale draws from an entirely separate tree — a register permission
  // is meaningless on an organization role, which is exactly why categories exist.
  ...define('Checkout', ['point-of-sale'], [
    ['pos.checkout.discount.line', 'Apply line discounts', 'Discount a single line item.'],
    ['pos.checkout.discount.cart', 'Apply cart discounts', 'Discount the whole cart.'],
    ['pos.checkout.price.override', 'Override prices', 'Change an item’s price at the register.', true],
    ['pos.checkout.tax.exempt', 'Mark tax exempt', 'Remove tax from a sale.', true],
    ['pos.checkout.custom_sale', 'Create custom sales', 'Ring up an item that is not in the catalog.'],
  ]),

  ...define('Register', ['point-of-sale'], [
    ['pos.register.open', 'Open register', 'Start a register session.'],
    ['pos.register.close', 'Close register', 'End a register session and count the drawer.'],
    ['pos.register.cash.add', 'Add cash', 'Add cash to the drawer.', true],
    ['pos.register.cash.remove', 'Remove cash', 'Remove cash from the drawer.', true],
    ['pos.register.reprint', 'Reprint receipts', 'Reprint a receipt.'],
    ['pos.register.reports', 'View register reports', 'See till and shift reports.'],
  ]),

  ...define('Orders', ['point-of-sale', 'store'], [
    ['orders.read', 'View orders', 'See orders and their details.'],
    ['orders.edit', 'Edit orders', 'Change an order after it is placed.'],
    ['orders.cancel', 'Cancel orders', 'Cancel an order.', true],
    ['orders.refund', 'Refund orders', 'Issue a refund.', true],
    ['orders.fulfill', 'Fulfil orders', 'Mark items fulfilled and print labels.'],
  ]),

  ...define('Customers', ['point-of-sale', 'store'], [
    ['customers.read', 'View customers', 'See customer records.'],
    ['customers.manage', 'Manage customers', 'Create and edit customers.'],
    ['customers.pii.read', 'View personal details', 'See full contact and address details.', true],
    ['customers.export', 'Export customers', 'Export customer data.', true],
  ]),

  ...define('Inventory', ['point-of-sale', 'store'], [
    ['inventory.adjust', 'Adjust inventory', 'Change on-hand quantities.'],
  ]),

  ...define('Apps', ['point-of-sale', 'store', 'organization'], [
    ['apps.read', 'View apps', 'See installed apps.'],
    ['apps.manage', 'Manage apps', 'Install, configure and remove apps.', true],
  ]),

  ...define('Analytics', ['point-of-sale', 'store', 'organization'], [
    ['analytics.read', 'View analytics', 'See reports and dashboards.'],
  ]),
];

const BY_KEY = new Map(CORE_PERMISSIONS.map((permission) => [permission.key, permission]));

export function findPermission(key: string): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

/** Permissions grantable under a category, grouped for the role editor's UI. */
export function permissionGroupsFor(
  category: RoleCategory,
  contributed: readonly PermissionDefinition[] = [],
): PermissionGroup[] {
  const all = [...CORE_PERMISSIONS, ...contributed].filter((permission) =>
    permission.categories.includes(category),
  );

  const grouped = new Map<string, string[]>();
  for (const permission of all) {
    const list = grouped.get(permission.group) ?? [];
    list.push(permission.key);
    grouped.set(permission.group, list);
  }

  return [...grouped.entries()].map(([group, permissions]) => ({
    key: group.toLowerCase().replace(/\s+/g, '-'),
    label: group,
    category,
    permissions,
  }));
}

export class PermissionCategoryError extends Error {
  readonly status = 422;
  constructor(
    readonly permission: string,
    readonly category: RoleCategory,
  ) {
    super(`Permission "${permission}" cannot be granted on a ${category} role.`);
    this.name = 'PermissionCategoryError';
  }
}

/**
 * Rejects a role that grants permissions outside its category. Without this the
 * role editor would happily save a store role holding register permissions that
 * silently never apply — which reads as a platform bug to the merchant.
 */
export function assertPermissionsAllowed(
  category: RoleCategory,
  permissions: readonly string[],
  contributed: readonly PermissionDefinition[] = [],
): void {
  const catalogue = new Map(
    [...CORE_PERMISSIONS, ...contributed].map((permission) => [permission.key, permission]),
  );

  for (const key of permissions) {
    const definition = catalogue.get(key);
    if (!definition) {
      throw new PermissionCategoryError(key, category);
    }
    if (!definition.categories.includes(category)) {
      throw new PermissionCategoryError(key, category);
    }
  }
}

/** Whether an action needs a second authorised actor before it proceeds. */
export function requiresApproval(
  permission: string,
  contributed: readonly PermissionDefinition[] = [],
): boolean {
  const definition =
    BY_KEY.get(permission) ?? contributed.find((entry) => entry.key === permission);
  return Boolean(definition?.sensitive);
}

/** The system roles every organization starts with (§4.3). */
export const SYSTEM_ROLES: readonly {
  key: string;
  name: string;
  category: RoleCategory;
  permissions: readonly string[];
  grantsApproval: boolean;
}[] = [
  {
    key: 'owner',
    name: 'Organization owner',
    category: 'organization',
    permissions: CORE_PERMISSIONS.filter((permission) =>
      permission.categories.includes('organization'),
    ).map((permission) => permission.key),
    grantsApproval: true,
  },
  {
    key: 'store-admin',
    name: 'Store administrator',
    category: 'store',
    permissions: CORE_PERMISSIONS.filter((permission) => permission.categories.includes('store')).map(
      (permission) => permission.key,
    ),
    grantsApproval: true,
  },
  {
    key: 'staff',
    name: 'Staff',
    category: 'store',
    permissions: ['store.read', 'orders.read', 'customers.read', 'analytics.read'],
    grantsApproval: false,
  },
];
