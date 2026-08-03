"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORBIDDEN_URL_PARAMS = exports.EMPTY_LIST_QUERY = exports.MAX_PAGE_SIZE = exports.DEFAULT_PAGE_SIZE = exports.LIST_QUERY_PARAMS = void 0;
exports.parseFilterQuery = parseFilterQuery;
exports.serializeFilterQuery = serializeFilterQuery;
exports.serializeSort = serializeSort;
exports.parseListQuery = parseListQuery;
exports.serializeListQuery = serializeListQuery;
exports.LIST_QUERY_PARAMS = {
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
};
/** Page size defaults and ceiling (§30.3): default 50, hard max 250. */
exports.DEFAULT_PAGE_SIZE = 50;
exports.MAX_PAGE_SIZE = 250;
exports.EMPTY_LIST_QUERY = {
    savedViewId: null,
    text: '',
    filters: [],
    sort: null,
    columns: [],
    cursor: null,
    before: null,
    limit: exports.DEFAULT_PAGE_SIZE,
    selectedId: null,
    dialog: null,
};
const TOKEN_PATTERN = /(\w[\w.]*)(:>=|:<=|:>|:<|:!|:)("([^"]*)"|\S*)/g;
/**
 * Splits a raw search string into typed filter tokens plus free text. Unmatched
 * remainder is treated as full-text search, which is what users expect when they
 * type a bare word into the box.
 */
function parseFilterQuery(raw) {
    const filters = [];
    let text = raw;
    for (const match of raw.matchAll(TOKEN_PATTERN)) {
        const [whole, field, operator, rawValue, quoted] = match;
        if (!field || !operator)
            continue;
        filters.push({
            field,
            operator: operator,
            value: (quoted ?? rawValue ?? '').trim(),
        });
        text = text.replace(whole, '');
    }
    return { text: text.replace(/\s+/g, ' ').trim(), filters };
}
function serializeFilterQuery(text, filters) {
    const tokens = filters.map((filter) => {
        const needsQuotes = /\s/.test(filter.value);
        const value = needsQuotes ? `"${filter.value}"` : filter.value;
        return `${filter.field}${filter.operator}${value}`;
    });
    return [...tokens, text].filter(Boolean).join(' ').trim();
}
function parseSort(raw) {
    if (!raw)
        return null;
    const [field, direction] = raw.trim().split(/\s+/);
    if (!field)
        return null;
    return { field, direction: direction === 'desc' ? 'desc' : 'asc' };
}
function serializeSort(sort) {
    return sort ? `${sort.field} ${sort.direction}` : null;
}
/** Reads list state out of a URL. The URL is the single source of truth (§24.3). */
function parseListQuery(params) {
    const rawQuery = params.get(exports.LIST_QUERY_PARAMS.query) ?? '';
    const { text, filters } = parseFilterQuery(rawQuery);
    const rawColumns = params.get(exports.LIST_QUERY_PARAMS.columns);
    const rawLimit = params.get(exports.LIST_QUERY_PARAMS.limit);
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : exports.DEFAULT_PAGE_SIZE;
    return {
        savedViewId: params.get(exports.LIST_QUERY_PARAMS.savedView),
        text,
        filters,
        sort: parseSort(params.get(exports.LIST_QUERY_PARAMS.order)),
        columns: rawColumns ? rawColumns.split(',').filter(Boolean) : [],
        cursor: params.get(exports.LIST_QUERY_PARAMS.cursor),
        before: params.get(exports.LIST_QUERY_PARAMS.before),
        limit: Number.isNaN(limit) ? exports.DEFAULT_PAGE_SIZE : Math.min(Math.max(limit, 1), exports.MAX_PAGE_SIZE),
        selectedId: params.get(exports.LIST_QUERY_PARAMS.selected),
        dialog: params.get(exports.LIST_QUERY_PARAMS.dialog),
    };
}
/**
 * Writes list state back to a URL. Empty values are omitted rather than emitted
 * blank, so a default view has a clean, shareable URL.
 */
function serializeListQuery(query) {
    const params = new URLSearchParams();
    const set = (key, value) => {
        if (value)
            params.set(key, value);
    };
    set(exports.LIST_QUERY_PARAMS.savedView, query.savedViewId);
    set(exports.LIST_QUERY_PARAMS.query, serializeFilterQuery(query.text, query.filters));
    set(exports.LIST_QUERY_PARAMS.order, serializeSort(query.sort));
    set(exports.LIST_QUERY_PARAMS.columns, query.columns.length ? query.columns.join(',') : null);
    set(exports.LIST_QUERY_PARAMS.cursor, query.cursor);
    set(exports.LIST_QUERY_PARAMS.before, query.before);
    if (query.limit !== exports.DEFAULT_PAGE_SIZE)
        set(exports.LIST_QUERY_PARAMS.limit, String(query.limit));
    set(exports.LIST_QUERY_PARAMS.selected, query.selectedId);
    set(exports.LIST_QUERY_PARAMS.dialog, query.dialog);
    return params;
}
/**
 * Parameter names that may never appear in a URL schema (§24.4). URLs are logged,
 * cached and shared — shareable is not the same as leaky. Fitness-enforced.
 */
exports.FORBIDDEN_URL_PARAMS = [
    'token', 'access_token', 'refresh_token', 'password', 'secret',
    'api_key', 'apikey', 'authorization', 'session', 'ssn', 'card', 'cvv',
];
//# sourceMappingURL=list-query.js.map