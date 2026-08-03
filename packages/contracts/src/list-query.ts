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

export const LIST_QUERY_PARAMS = {
  savedView: 'savedViewId',
  query: 'query',
  order: 'order',
  columns: 'selectedColumns',
  cursor: 'after',
  before: 'before',
  limit: 'limit',
  /** Row peek / side panel — a view-state of the list, not a destination. */
  selected: 'selected',
  /** Transient dialog flag, so even a delete confirm is deep-linkable. */
  dialog: 'dialog',
} as const;

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
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 250;

export const EMPTY_LIST_QUERY: ListQuery = {
  savedViewId: null,
  text: '',
  filters: [],
  sort: null,
  columns: [],
  cursor: null,
  before: null,
  limit: DEFAULT_PAGE_SIZE,
  selectedId: null,
  dialog: null,
};

const TOKEN_PATTERN = /(\w[\w.]*)(:>=|:<=|:>|:<|:!|:)("([^"]*)"|\S*)/g;

/**
 * Splits a raw search string into typed filter tokens plus free text. Unmatched
 * remainder is treated as full-text search, which is what users expect when they
 * type a bare word into the box.
 */
export function parseFilterQuery(raw: string): { text: string; filters: FilterToken[] } {
  const filters: FilterToken[] = [];
  let text = raw;

  for (const match of raw.matchAll(TOKEN_PATTERN)) {
    const [whole, field, operator, rawValue, quoted] = match;
    if (!field || !operator) continue;
    filters.push({
      field,
      operator: operator as FilterOperator,
      value: (quoted ?? rawValue ?? '').trim(),
    });
    text = text.replace(whole, '');
  }

  return { text: text.replace(/\s+/g, ' ').trim(), filters };
}

export function serializeFilterQuery(text: string, filters: readonly FilterToken[]): string {
  const tokens = filters.map((filter) => {
    const needsQuotes = /\s/.test(filter.value);
    const value = needsQuotes ? `"${filter.value}"` : filter.value;
    return `${filter.field}${filter.operator}${value}`;
  });
  return [...tokens, text].filter(Boolean).join(' ').trim();
}

function parseSort(raw: string | null): SortSpec | null {
  if (!raw) return null;
  const [field, direction] = raw.trim().split(/\s+/);
  if (!field) return null;
  return { field, direction: direction === 'desc' ? 'desc' : 'asc' };
}

export function serializeSort(sort: SortSpec | null): string | null {
  return sort ? `${sort.field} ${sort.direction}` : null;
}

/** Reads list state out of a URL. The URL is the single source of truth (§24.3). */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawQuery = params.get(LIST_QUERY_PARAMS.query) ?? '';
  const { text, filters } = parseFilterQuery(rawQuery);
  const rawColumns = params.get(LIST_QUERY_PARAMS.columns);
  const rawLimit = params.get(LIST_QUERY_PARAMS.limit);
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_PAGE_SIZE;

  return {
    savedViewId: params.get(LIST_QUERY_PARAMS.savedView),
    text,
    filters,
    sort: parseSort(params.get(LIST_QUERY_PARAMS.order)),
    columns: rawColumns ? rawColumns.split(',').filter(Boolean) : [],
    cursor: params.get(LIST_QUERY_PARAMS.cursor),
    before: params.get(LIST_QUERY_PARAMS.before),
    limit: Number.isNaN(limit) ? DEFAULT_PAGE_SIZE : Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
    selectedId: params.get(LIST_QUERY_PARAMS.selected),
    dialog: params.get(LIST_QUERY_PARAMS.dialog),
  };
}

/**
 * Writes list state back to a URL. Empty values are omitted rather than emitted
 * blank, so a default view has a clean, shareable URL.
 */
export function serializeListQuery(query: ListQuery): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
  };

  set(LIST_QUERY_PARAMS.savedView, query.savedViewId);
  set(LIST_QUERY_PARAMS.query, serializeFilterQuery(query.text, query.filters));
  set(LIST_QUERY_PARAMS.order, serializeSort(query.sort));
  set(LIST_QUERY_PARAMS.columns, query.columns.length ? query.columns.join(',') : null);
  set(LIST_QUERY_PARAMS.cursor, query.cursor);
  set(LIST_QUERY_PARAMS.before, query.before);
  if (query.limit !== DEFAULT_PAGE_SIZE) set(LIST_QUERY_PARAMS.limit, String(query.limit));
  set(LIST_QUERY_PARAMS.selected, query.selectedId);
  set(LIST_QUERY_PARAMS.dialog, query.dialog);

  return params;
}

/**
 * Parameter names that may never appear in a URL schema (§24.4). URLs are logged,
 * cached and shared — shareable is not the same as leaky. Fitness-enforced.
 */
export const FORBIDDEN_URL_PARAMS: readonly string[] = [
  'token', 'access_token', 'refresh_token', 'password', 'secret',
  'api_key', 'apikey', 'authorization', 'session', 'ssn', 'card', 'cvv',
];

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
