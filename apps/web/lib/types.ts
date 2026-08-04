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
