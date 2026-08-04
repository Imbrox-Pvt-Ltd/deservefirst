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

export interface ProductVariantDto {
  readonly id: string;
  readonly sku: string | null;
  /** Keyed by option name; meaningless without the product's optionNames order. */
  readonly optionValues: Readonly<Record<string, string>>;
  readonly price: MoneyDto;
  readonly inventoryQuantity: number;
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
  readonly optionNames: readonly string[];
  readonly variants: readonly ProductVariantDto[];
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

/** Where a resolved value came from — see the settings resolution chain. */
export type SettingSource = 'store' | 'platform' | 'environment' | 'default';

export interface ResolvedSettingDto {
  readonly key: string;
  readonly value: unknown;
  readonly source: SettingSource;
  /** What it would fall back to if this store's value were cleared. */
  readonly inherited: unknown;
}

export interface DashboardWidgetDto {
  readonly id: string;
  readonly moduleId: string;
  readonly label: string;
  readonly description: string | null;
  readonly size: 'small' | 'medium' | 'large' | 'full';
  readonly format: 'number' | 'money' | 'percent' | 'duration';
  readonly href: string | null;
  readonly value: number | null;
  /** Set when the value could not be produced — the card says so rather than lying. */
  readonly unavailable: string | null;
}

export interface SegmentConditionDto {
  readonly field: string;
  readonly operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan';
  readonly value: string;
}

export interface SegmentDto {
  readonly id: string;
  readonly name: string;
  readonly match: 'all' | 'any';
  readonly conditions: readonly SegmentConditionDto[];
  readonly version: number;
  /** Computed on read — a segment stores the question, never the answer. */
  readonly count?: number;
  readonly capped?: boolean;
}

export interface CompanyLocationDto {
  readonly id: string;
  readonly name: string;
  readonly addressLine1: string | null;
  readonly city: string | null;
  readonly countryCode: string;
  readonly paymentTerms: 'due-on-receipt' | 'net-15' | 'net-30' | 'net-60' | 'prepaid';
  /** Exact minor units as a string; money never crosses as a float. */
  readonly creditLimitMinor: string | null;
  readonly isDefault: boolean;
}

export interface CompanyContactDto {
  readonly id: string;
  /** A link to the person's own customer record, never a copy of it. */
  readonly customerId: string;
  readonly role: 'ordering' | 'viewing' | 'admin';
  readonly locationIds: readonly string[];
  readonly isPrimary: boolean;
}

export interface CompanyDto {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly status: 'active' | 'on-hold' | 'closed';
  readonly note: string | null;
  readonly locations: readonly CompanyLocationDto[];
  readonly contacts: readonly CompanyContactDto[];
  readonly version: number;
}

export interface WebhookSubscriptionDto {
  readonly id: string;
  readonly eventType: string;
  readonly url: string;
  readonly status: 'active' | 'paused' | 'disabled';
  readonly consecutiveFailures: number;
  readonly disabledReason: string | null;
  readonly version: number;
  /** Present only on the create response — see the actions file. */
  readonly secret?: string;
}

export interface WebhookDeliveryDto {
  readonly id: string;
  readonly subscriptionId: string;
  /** Stable across retries, so a receiver can deduplicate on it. */
  readonly eventId: string;
  readonly eventType: string;
  readonly status: 'pending' | 'delivered' | 'failed' | 'dead';
  readonly attempts: number;
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: string | null;
  readonly deliveredAt: string | null;
}

export interface WebhookEventDto {
  readonly type: string;
  readonly label: string;
  readonly description: string | null;
  readonly moduleId: string;
}

export interface PartnerAccessDto {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly status: 'pending' | 'active' | 'revoked';
  readonly accessLevel: 'full' | 'limited';
  readonly permissions: readonly string[];
  /** True for a store the partner built — access without a decision. */
  readonly createdByPartner: boolean;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly revokedReason: string | null;
}

export interface PartnerSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'suspended' | 'closed';
  readonly role: 'owner' | 'admin' | 'member';
}

export interface PartnerStoreDto {
  readonly id: string;
  readonly storeId: string;
  /** Null when the store has been deleted out from under the link. */
  readonly storeName: string | null;
  readonly storeHandle: string | null;
  readonly status: 'pending' | 'active' | 'revoked';
  readonly accessLevel: 'full' | 'limited';
  readonly permissions: readonly string[];
  readonly createdByPartner: boolean;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly revokedReason: string | null;
}

export interface PartnerStaffDto {
  readonly id: string;
  readonly userId: string;
  readonly role: 'owner' | 'admin' | 'member';
  readonly status: 'active' | 'invited' | 'removed';
}

export interface AppScopeDto {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly family: string;
  readonly feature: string;
  readonly access: 'read' | 'write';
  readonly grants: readonly string[];
  readonly restricted: boolean;
}

export interface InstalledAppDto {
  readonly id: string;
  readonly appId: string;
  readonly appName: string;
  readonly appHandle: string;
  readonly status: 'installed' | 'uninstalled';
  readonly grantedScopes: readonly string[];
  /** Each granted scope resolved to what it actually opens. */
  readonly scopeDetail: readonly Omit<AppScopeDto, 'grants' | 'family'>[];
  readonly installedAt: string;
  readonly uninstalledAt: string | null;
}

export interface PartnerAppDto {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly status: 'draft' | 'published' | 'suspended';
  readonly distribution: 'public' | 'custom';
  readonly appUrl: string | null;
  readonly redirectUris: readonly string[];
  readonly requestedScopes: readonly string[];
  readonly clientId: string;
  readonly version: number;
}

export interface AppConsentDto {
  readonly clientId: string;
  readonly appName: string;
  readonly appHandle: string;
  readonly appUrl: string | null;
  readonly redirectUri: string;
  readonly scopes: readonly {
    readonly key: string;
    readonly label: string;
    readonly description: string;
    readonly feature: string;
    readonly access: 'read' | 'write';
    readonly restricted: boolean;
  }[];
  readonly alreadyInstalled: boolean;
  /** Carried through the screen untouched and handed back to the app. */
  readonly state: string | null;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
}
