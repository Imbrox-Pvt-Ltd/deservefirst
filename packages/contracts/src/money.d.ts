/**
 * Contracts · money.ts
 * The Money value object (§15.2). Every monetary value on the platform is integer
 * minor units plus an ISO-4217 code — never a float, never a bare number. No
 * module implements its own currency maths; a fitness rule flags any that tries.
 * Layer: contracts (pure, no I/O).
 */
/** ISO-4217 alphabetic code, e.g. "USD", "INR", "JPY". */
export type CurrencyCode = string & {
    readonly __brand: 'CurrencyCode';
};
export interface Money {
    /** Amount in the currency's smallest unit: cents, paise, yen. */
    readonly amountMinor: bigint;
    readonly currency: CurrencyCode;
}
export declare function currencyExponent(currency: CurrencyCode): number;
export declare function money(amountMinor: bigint | number, currency: string): Money;
/**
 * Parses a decimal string ("19.99") into minor units without ever touching a
 * float — string arithmetic only, because 19.99 is not representable in binary.
 */
export declare function moneyFromDecimalString(value: string, currency: string): Money;
export declare function addMoney(a: Money, b: Money): Money;
export declare function subtractMoney(a: Money, b: Money): Money;
/** Multiplies by an integer quantity. Fractional rates need an explicit rounding mode. */
export declare function multiplyMoney(value: Money, quantity: number): Money;
export type RoundingMode = 'half-up' | 'half-even' | 'down';
/**
 * Applies a fractional rate (tax, discount, FX) with an explicit rounding mode.
 * Rounding is never implicit — that is how cent-drift bugs are born.
 */
export declare function applyRate(value: Money, rate: number, mode?: RoundingMode): Money;
export declare function isZero(value: Money): boolean;
export declare function compareMoney(a: Money, b: Money): -1 | 0 | 1;
/**
 * Renders as a plain decimal string for storage or transport. Presentation
 * formatting (symbols, grouping, locale) belongs to the i18n service, not here.
 */
export declare function toDecimalString(value: Money): string;
//# sourceMappingURL=money.d.ts.map