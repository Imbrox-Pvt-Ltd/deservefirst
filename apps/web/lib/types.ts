/**
 * Web · lib/types.ts
 * Wire shapes shared by the admin screens. These mirror the API's response
 * envelope; domain types come from @deservefirst/contracts rather than being
 * redefined here.
 * Layer: web/lib.
 */

export interface ApiResponse<T> {
  readonly data: T | null;
  readonly meta: {
    readonly requestId: string;
    readonly pagination?: {
      readonly hasNextPage: boolean;
      readonly hasPreviousPage: boolean;
      readonly startCursor: string | null;
      readonly endCursor: string | null;
      readonly totalCount?: number;
    };
  };
  readonly errors: readonly {
    readonly code: string;
    readonly title: string;
    readonly detail: string;
    readonly status: number;
  }[];
}

/** Money crosses the wire as a decimal string — JSON has no exact decimal type. */
export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export interface ProductDto {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'draft' | 'active' | 'archived';
  readonly vendor: string | null;
  readonly productType: string | null;
  readonly price: MoneyDto;
  readonly compareAtPrice: MoneyDto | null;
  readonly publishedChannels: readonly string[];
  readonly version: number;
}

export interface NavigationDto {
  readonly moduleId: string;
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly section: 'primary' | 'sales-channels' | 'apps' | 'settings';
  readonly position: number;
  readonly permission: string;
  /** Nests the entry under a core section — see NavigationDeclaration.parentId. */
  readonly parentId?: string;
  readonly icon?: string;
}

export interface SettingDto {
  readonly moduleId: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly group: string;
  readonly section: string;
  readonly kind: string;
  readonly scope: 'organization' | 'store' | 'user';
  readonly defaultValue?: unknown;
  readonly options?: readonly { value: string; label: string }[];
}

/** Formats a wire Money for display. Presentation only — never for arithmetic. */
export function formatMoney(money: MoneyDto, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(Number(money.amount));
}

export interface RequestLineDto {
  readonly id: string;
  readonly productId: string;
  readonly title: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly listPrice: MoneyDto;
  /** Null until the merchant has priced this line. */
  readonly quotedPrice: MoneyDto | null;
  readonly note: string | null;
}

export interface RequestDto {
  readonly id: string;
  readonly reference: string;
  readonly customerId: string | null;
  readonly contactEmail: string | null;
  readonly contactName: string | null;
  readonly status: 'draft' | 'submitted' | 'quoted' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  readonly currency: string;
  readonly note: string | null;
  readonly quoteExpiresAt: string | null;
  readonly submittedAt: string | null;
  readonly version: number;
  /** Quoted where quoted, list otherwise. Deliberately not a total: no tax. */
  readonly subtotal: MoneyDto;
  readonly lines: readonly RequestLineDto[];
}

export interface LocationDto {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly countryCode: string;
  readonly fulfilsOrders: boolean;
  readonly archivedAt: string | null;
  readonly version: number;
}

export interface InventoryLevelDto {
  readonly id: string;
  readonly locationId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string;
  readonly sku: string | null;
  readonly onHand: number;
  readonly committed: number;
  readonly incoming: number;
  /** Derived from on hand and committed — never negative, even when on hand is. */
  readonly available: number;
  readonly version: number;
}

export interface AdjustmentDto {
  readonly id: string;
  readonly locationId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly delta: number;
  readonly reason: string;
  readonly reference: string | null;
  readonly occurredAt: string;
}

export interface PurchaseOrderLineDto {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string;
  readonly ordered: number;
  readonly received: number;
}

export interface PurchaseOrderDto {
  readonly id: string;
  readonly reference: string;
  readonly supplierName: string;
  readonly destinationLocationId: string;
  readonly status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
  readonly expectedAt: string | null;
  readonly lines: readonly PurchaseOrderLineDto[];
  readonly version: number;
}

export interface TransferLineDto {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly title: string;
  readonly quantity: number;
  readonly receivedQuantity: number;
}

export interface TransferDto {
  readonly id: string;
  readonly reference: string;
  readonly originLocationId: string;
  readonly destinationLocationId: string;
  readonly status: 'draft' | 'in-transit' | 'received' | 'cancelled';
  readonly lines: readonly TransferLineDto[];
  /** Units that have left the origin but not arrived — owned by neither. */
  readonly inTransit: number;
  readonly version: number;
}

export interface ConditionDto {
  readonly field: string;
  readonly operator: string;
  readonly value: string;
}

export interface CollectionDto {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly description: string;
  readonly type: 'manual' | 'automated';
  readonly match: 'all' | 'any';
  readonly conditions: readonly ConditionDto[];
  /** Applied after inclusion and always winning — see the rule engine. */
  readonly exclusions: readonly ConditionDto[];
  readonly productIds: readonly string[];
  readonly sortOrder: string;
  readonly version: number;
}

export interface CustomerDto {
  readonly id: string;
  readonly displayName: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly state: string;
  /** Only "subscribed" permits marketing — see the customers module. */
  readonly emailConsent: string;
  readonly smsConsent: string;
  readonly locale: string;
  readonly taxExempt: boolean;
  readonly ordersCount: number;
  readonly totalSpent: MoneyDto;
  readonly version: number;
}

export interface PageDto {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly body: string;
  readonly status: 'draft' | 'published';
  readonly templateSuffix: string | null;
  readonly publishedAt: string | null;
  readonly version: number;
}

export type MetaobjectFieldType =
  | 'single_line_text' | 'multi_line_text' | 'rich_text' | 'integer' | 'decimal'
  | 'boolean' | 'date' | 'url' | 'file_reference' | 'metaobject_reference';

export interface MetaobjectFieldDto {
  readonly key: string;
  readonly name: string;
  readonly type: MetaobjectFieldType;
  readonly required: boolean;
  readonly description: string | null;
}

export interface MetaobjectDefinitionDto {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly MetaobjectFieldDto[];
  /** The field whose value names an entry in lists. */
  readonly displayNameKey: string | null;
  readonly version: number;
}

export interface MetaobjectEntryDto {
  readonly id: string;
  readonly definitionId: string;
  readonly handle: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly status: 'draft' | 'published';
  /** Resolved server-side: the naming rule belongs with the definition. */
  readonly displayName: string;
  readonly version: number;
}
