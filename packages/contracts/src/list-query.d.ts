/**
 * Contracts · list-query.ts
 * The canonical list-state contract (§12.6) and its URL encoding (§8.5, §24.3).
 * Every ListScreen on the platform reads its state from here and writes it back
 * to the URL, so any filtered view is shareable, bookmarkable and restorable.
 * Layer: contracts (pure, no framework).
 *
 * The encoding is taken verbatim from the reference product, e.g.
 *   /store/{h}/products?savedViewId=2172477178142
 *                      &query=vendor%3A"Hydrogen+Vendor"
 *                      &order=created_at+desc
 *                      &selectedColumns=IMAGE%2CTITLE
 * Note: the reference product's own settings screens use a second, inconsistent
 * spelling (search/sort/selectedTab/start/end). We deliberately standardise on
 * the one below everywhere — one convention, no exceptions.
 */
export declare const LIST_QUERY_PARAMS: {
    readonly savedView: "savedViewId";
    readonly query: "query";
    readonly order: "order";
    readonly columns: "selectedColumns";
    readonly cursor: "after";
    readonly before: "before";
    readonly limit: "limit";
    /** Row peek / side panel — a view-state of the list, not a destination. */
    readonly selected: "selected";
    /** Transient dialog flag, so even a delete confirm is deep-linkable. */
    readonly dialog: "dialog";
};
export type SortDirection = 'asc' | 'desc';
export interface SortSpec {
    readonly field: string;
    readonly direction: SortDirection;
}
/**
 * One clause of the filter-token syntax: `status:active`, `tag:sale`,
 * `created_at:>2026-01-01`, `vendor:"Hydrogen Vendor"`.
 */
export interface FilterToken {
    readonly field: string;
    readonly operator: FilterOperator;
    readonly value: string;
}
export type FilterOperator = ':' | ':>' | ':<' | ':>=' | ':<=' | ':!';
export interface ListQuery {
    readonly savedViewId: string | null;
    /** Free-text remainder after filter tokens are extracted. */
    readonly text: string;
    readonly filters: readonly FilterToken[];
    readonly sort: SortSpec | null;
    readonly columns: readonly string[];
    readonly cursor: string | null;
    readonly before: string | null;
    readonly limit: number;
    readonly selectedId: string | null;
    readonly dialog: string | null;
}
/** Page size defaults and ceiling (§30.3): default 50, hard max 250. */
export declare const DEFAULT_PAGE_SIZE = 50;
export declare const MAX_PAGE_SIZE = 250;
export declare const EMPTY_LIST_QUERY: ListQuery;
/**
 * Splits a raw search string into typed filter tokens plus free text. Unmatched
 * remainder is treated as full-text search, which is what users expect when they
 * type a bare word into the box.
 */
export declare function parseFilterQuery(raw: string): {
    text: string;
    filters: FilterToken[];
};
export declare function serializeFilterQuery(text: string, filters: readonly FilterToken[]): string;
export declare function serializeSort(sort: SortSpec | null): string | null;
/** Reads list state out of a URL. The URL is the single source of truth (§24.3). */
export declare function parseListQuery(params: URLSearchParams): ListQuery;
/**
 * Writes list state back to a URL. Empty values are omitted rather than emitted
 * blank, so a default view has a clean, shareable URL.
 */
export declare function serializeListQuery(query: ListQuery): URLSearchParams;
/**
 * Parameter names that may never appear in a URL schema (§24.4). URLs are logged,
 * cached and shared — shareable is not the same as leaky. Fitness-enforced.
 */
export declare const FORBIDDEN_URL_PARAMS: readonly string[];
/** A saved view is a named filter+sort+column set — per-user or shared (§12.6). */
export interface SavedView {
    readonly id: string;
    readonly entity: string;
    readonly name: string;
    readonly query: string;
    readonly sort: SortSpec | null;
    readonly columns: readonly string[];
    readonly shared: boolean;
    readonly position: number;
}
/** Relay-style page result — cursor pagination everywhere, never offset (§13.6). */
export interface Connection<T> {
    readonly nodes: readonly T[];
    readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly hasPreviousPage: boolean;
        readonly startCursor: string | null;
        readonly endCursor: string | null;
    };
    readonly totalCount?: number;
}
//# sourceMappingURL=list-query.d.ts.map