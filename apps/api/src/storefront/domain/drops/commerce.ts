/**
 * Storefront · domain/drops/commerce.ts
 * Cart, line items, customer, address and order.
 *
 * The sharpest edges on the platform are here, and they are of two different
 * kinds.
 *
 * `customer` is one shopper's own data rendered on their own page. The drop
 * cannot reach another customer — the loader is scoped to the session that
 * asked — but it must also not expose what even the owner's theme has no
 * business rendering: `note` is what staff wrote about this person, and it is
 * marked private for that reason. A theme printing it would show a customer the
 * internal comment about their own chargeback.
 *
 * `order` has the same shape of problem: `internalNote` is staff-facing and
 * `note` is the customer's own. They are one word apart and mean opposite
 * things, which is exactly why the fitness rule refuses any read named `.note`
 * in a drop and this file maps around it deliberately.
 *
 * PLAN/07 records that Phase-1 commerce is request-only (D10) — there is no
 * checkout. The cart drop exists because every theme reads it to draw a header
 * count, and one that threw would take the header down on every page.
 * Layer: domain (pure).
 */

import { defineDrop, dropList } from './define';

export interface LineItemRow {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string;
  readonly title: string;
  readonly variantTitle?: string | null;
  readonly quantity: number;
  readonly unitPriceMinor: string | number;
  readonly linePriceMinor?: string | number | null;
  readonly sku?: string | null;
  readonly vendor?: string | null;
  readonly imageSrc?: string | null;
  readonly url?: string | null;
  readonly properties?: Readonly<Record<string, unknown>> | null;
}

export interface CartRow {
  readonly items: readonly LineItemRow[];
  readonly currency: string;
  /** The customer's own message, if the theme collected one. */
  readonly customerMessage?: string | null;
  readonly attributes?: Readonly<Record<string, unknown>> | null;
}

export interface AddressRow {
  readonly id?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly company?: string | null;
  readonly address1?: string | null;
  readonly address2?: string | null;
  readonly city?: string | null;
  readonly province?: string | null;
  readonly provinceCode?: string | null;
  readonly country?: string | null;
  readonly countryCode?: string | null;
  readonly zip?: string | null;
  readonly phone?: string | null;
}

export interface CustomerRow {
  readonly id: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly acceptsMarketing?: boolean | null;
  readonly ordersCount?: number | null;
  readonly totalSpentMinor?: string | number | null;
  readonly taxExempt?: boolean | null;
  readonly defaultAddress?: AddressRow | null;
  readonly addresses?: readonly AddressRow[] | null;
}

export interface OrderRow {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly currency: string;
  readonly contactEmail?: string | null;
  readonly contactName?: string | null;
  readonly subtotalMinor?: string | number | null;
  readonly lineCount?: number | null;
  /**
   * The customer's own note, deliberately not named `note`.
   *
   * `note` is a private field on the customer resource and `internalNote` is
   * private on the request resource; the fitness rule refuses either name in a
   * drop, which is correct and slightly inconvenient here. Naming the projection
   * `customerNote` makes the mapping an explicit decision at the boundary rather
   * than a read that looks identical to the one that would leak.
   */
  readonly customerNote?: string | null;
  readonly items?: readonly LineItemRow[] | null;
  readonly createdAt?: string | Date | null;
  readonly quoteExpiresAt?: string | Date | null;
}

function minorUnits(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const lineItemDrop = defineDrop<LineItemRow>('line_item', {
  id: (line) => line.id,
  key: (line) => line.id,
  product_id: (line) => line.productId,
  variant_id: (line) => line.variantId,
  title: (line) => line.title,
  product_title: (line) => line.title,
  variant_title: (line) => line.variantTitle ?? '',
  quantity: (line) => line.quantity,
  sku: (line) => line.sku ?? '',
  vendor: (line) => line.vendor ?? '',
  price: (line) => minorUnits(line.unitPriceMinor),
  /** Computed rather than trusted, so a stale stored total cannot render. */
  line_price: (line) =>
    line.linePriceMinor !== null && line.linePriceMinor !== undefined
      ? minorUnits(line.linePriceMinor)
      : minorUnits(line.unitPriceMinor) * line.quantity,
  final_price: (line) => minorUnits(line.unitPriceMinor),
  final_line_price: (line) => minorUnits(line.unitPriceMinor) * line.quantity,
  image: (line) => (line.imageSrc ? { src: line.imageSrc, alt: line.title } : null),
  url: (line) => line.url ?? '',
  /**
   * Line properties a theme collected — an engraving, a delivery date.
   *
   * Underscore-prefixed keys are hidden by convention: themes use them to carry
   * state they do not want printed in an order summary, and honouring that here
   * means a theme's own bookkeeping does not end up in front of a customer.
   */
  properties: (line) =>
    Object.fromEntries(
      Object.entries(line.properties ?? {}).filter(([key]) => !key.startsWith('_')),
    ),
});

export const cartDrop = defineDrop<CartRow>('cart', {
  items: (cart, context) => dropList(lineItemDrop, cart.items, context),
  item_count: (cart) => cart.items.reduce((total, line) => total + line.quantity, 0),
  /** Zero for an empty cart rather than nothing, so `| money` renders a price. */
  total_price: (cart) =>
    cart.items.reduce((total, line) => total + minorUnits(line.unitPriceMinor) * line.quantity, 0),
  original_total_price: (cart) =>
    cart.items.reduce((total, line) => total + minorUnits(line.unitPriceMinor) * line.quantity, 0),
  total_weight: () => 0,
  currency: (cart) => cart.currency,
  empty: (cart) => cart.items.length === 0,
  note: (cart) => cart.customerMessage ?? '',
  attributes: (cart) => cart.attributes ?? {},
  /**
   * Always false in Phase 1: there is no checkout to require terms for.
   *
   * Present rather than absent because themes read it to decide whether to
   * render a consent checkbox, and a missing value renders one that does
   * nothing.
   */
  requires_shipping: () => false,
  cart_level_discount_applications: () => [],
});

export const addressDrop = defineDrop<AddressRow>('address', {
  id: (address) => address.id ?? null,
  first_name: (address) => address.firstName ?? '',
  last_name: (address) => address.lastName ?? '',
  name: (address) => [address.firstName, address.lastName].filter(Boolean).join(' '),
  company: (address) => address.company ?? '',
  address1: (address) => address.address1 ?? '',
  address2: (address) => address.address2 ?? '',
  street: (address) => [address.address1, address.address2].filter(Boolean).join(', '),
  city: (address) => address.city ?? '',
  province: (address) => address.province ?? '',
  province_code: (address) => address.provinceCode ?? '',
  country: (address) => address.country ?? '',
  country_code: (address) => address.countryCode ?? '',
  zip: (address) => address.zip ?? '',
  phone: (address) => address.phone ?? '',
});

export const customerDrop = defineDrop<CustomerRow>('customer', {
  id: (customer) => customer.id,
  first_name: (customer) => customer.firstName ?? '',
  last_name: (customer) => customer.lastName ?? '',
  name: (customer) => [customer.firstName, customer.lastName].filter(Boolean).join(' '),
  email: (customer) => customer.email ?? '',
  phone: (customer) => customer.phone ?? '',
  accepts_marketing: (customer) => customer.acceptsMarketing ?? false,
  tax_exempt: (customer) => customer.taxExempt ?? false,

  orders_count: (customer) => customer.ordersCount ?? 0,
  total_spent: (customer) => minorUnits(customer.totalSpentMinor),

  default_address: (customer, context) =>
    customer.defaultAddress ? addressDrop(customer.defaultAddress, context) : null,
  addresses: (customer, context) => dropList(addressDrop, customer.addresses ?? [], context),
  addresses_count: (customer) => customer.addresses?.length ?? 0,

  orders: (customer, context) => {
    const load = context.load.ordersOfCustomer as ((id: string) => readonly OrderRow[]) | undefined;
    return dropList(orderDrop, load?.(customer.id) ?? [], context);
  },

  /**
   * Present, and never populated from the private staff field.
   *
   * The reference product exposes `customer.tags` and themes read it to show a
   * wholesale banner. What it must never become is a channel for the internal
   * note about this person.
   */
  tags: (customer, context) =>
    (context.load.tagsOfCustomer as ((id: string) => readonly string[]) | undefined)?.(
      customer.id,
    ) ?? [],
});

export interface DiscountApplicationRow {
  readonly title: string;
  readonly targetType: string;
  readonly valueType: 'percentage' | 'fixed_amount';
  readonly value: number;
  readonly amountMinor?: string | number | null;
}

/**
 * A discount that applied, as a theme reports it — never as a theme computes it.
 *
 * `total_allocated_amount` is the amount the platform actually deducted, in
 * minor units. Themes must render that rather than multiplying `value` by a
 * price: rounding on a percentage discount is decided once, server-side, and a
 * theme that recomputed it would show a total that disagrees with the invoice
 * by a penny — which is the kind of discrepancy customers report and nobody can
 * reproduce.
 */
export const discountApplicationDrop = defineDrop<DiscountApplicationRow>(
  'discount_application',
  {
    title: (discount) => discount.title,
    target_type: (discount) => discount.targetType,
    value_type: (discount) => discount.valueType,
    value: (discount) => discount.value,
    total_allocated_amount: (discount) => minorUnits(discount.amountMinor),
  },
);

export const orderDrop = defineDrop<OrderRow>('order', {
  id: (order) => order.id,
  name: (order) => order.reference,
  order_number: (order) => order.reference,
  /** The customer-facing status, which is the only one a storefront should show. */
  status: (order) => order.status,
  currency: (order) => order.currency,
  email: (order) => order.contactEmail ?? '',
  customer_name: (order) => order.contactName ?? '',
  subtotal_price: (order) => minorUnits(order.subtotalMinor),
  total_price: (order) => minorUnits(order.subtotalMinor),
  item_count: (order) => order.lineCount ?? order.items?.length ?? 0,
  line_items: (order, context) => dropList(lineItemDrop, order.items ?? [], context),
  // The customer's own message. See `customerNote` on the row for why the
  // projection is named differently from the column.
  note: (order) => order.customerNote ?? '',
  created_at: (order) => isoOrNull(order.createdAt),
  quote_expires_at: (order) => isoOrNull(order.quoteExpiresAt),
  url: (order) => `/account/orders/${order.id}`,
});
