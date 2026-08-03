/**
 * UI · templates/use-list-state.ts
 * Binds list state to the URL (§24.3). Filters, sort, cursor, tab, selection and
 * open dialog are read FROM the URL and written back to it — never held only in
 * component state. That is what makes every view shareable, bookmarkable and
 * correct under back/forward.
 * Layer: ui.
 */

import { useCallback, useMemo } from 'react';

import {
  type FilterToken,
  type ListQuery,
  parseListQuery,
  serializeListQuery,
  type SortSpec,
} from '@deservefirst/contracts';

/**
 * The router operations this hook needs. Injected rather than imported so the
 * templates stay framework-agnostic and testable without a router.
 */
export interface ListRouter {
  readonly searchParams: URLSearchParams;
  readonly pathname: string;
  /** `replace` for view tweaks, `push` for real navigation — see below. */
  navigate(url: string, options: { replace: boolean }): void;
}

export interface ListState {
  readonly query: ListQuery;
  setText(text: string): void;
  setFilter(token: FilterToken): void;
  removeFilter(field: string): void;
  clearFilters(): void;
  setSort(sort: SortSpec | null): void;
  setColumns(columns: readonly string[]): void;
  selectView(savedViewId: string | null): void;
  nextPage(cursor: string): void;
  previousPage(cursor: string): void;
  peek(id: string | null): void;
  openDialog(dialog: string | null): void;
}

export function useListState(router: ListRouter): ListState {
  const query = useMemo(() => parseListQuery(router.searchParams), [router.searchParams]);

  const apply = useCallback(
    (next: ListQuery, options: { replace: boolean }) => {
      const params = serializeListQuery(next);
      const search = params.toString();
      router.navigate(search ? `${router.pathname}?${search}` : router.pathname, options);
    },
    [router],
  );

  /**
   * Changing a filter resets pagination — keeping a cursor from the previous
   * result set would page through rows that no longer match.
   */
  const applyFilterChange = useCallback(
    (next: ListQuery) => apply({ ...next, cursor: null, before: null }, { replace: true }),
    [apply],
  );

  return {
    query,

    setText: (text) => applyFilterChange({ ...query, text }),

    setFilter: (token) =>
      applyFilterChange({
        ...query,
        filters: [...query.filters.filter((filter) => filter.field !== token.field), token],
      }),

    removeFilter: (field) =>
      applyFilterChange({
        ...query,
        filters: query.filters.filter((filter) => filter.field !== field),
      }),

    clearFilters: () => applyFilterChange({ ...query, filters: [], text: '' }),

    setSort: (sort) => applyFilterChange({ ...query, sort }),

    setColumns: (columns) => apply({ ...query, columns }, { replace: true }),

    // Switching tab is real navigation: the merchant expects Back to return to
    // the previous tab rather than skipping the whole list.
    selectView: (savedViewId) =>
      apply(
        { ...query, savedViewId, cursor: null, before: null, selectedId: null, dialog: null },
        { replace: false },
      ),

    nextPage: (cursor) => apply({ ...query, cursor, before: null }, { replace: false }),
    previousPage: (cursor) => apply({ ...query, before: cursor, cursor: null }, { replace: false }),

    peek: (id) => apply({ ...query, selectedId: id }, { replace: true }),

    // A dialog is a destination the merchant can share or reload into.
    openDialog: (dialog) => apply({ ...query, dialog }, { replace: false }),
  };
}
