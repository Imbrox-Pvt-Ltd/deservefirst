/**
 * UI · templates/ListScreen.tsx
 * The list template every entity inherits (§8.3, §12.6). Saved-view tabs,
 * filter-token search, sort, column customisation, bulk selection and cursor
 * pagination — implemented once here, so a module author never builds a list.
 * All state lives in the URL (§24.3).
 * Layer: ui.
 */

import type { ReactNode } from 'react';

import {
  Badge,
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  EmptySearchResult,
  IndexFilters,
  IndexTable,
  Page,
  Pagination,
  Text,
  useIndexResourceState,
  useSetIndexFiltersMode,
} from '@shopify/polaris';

import type { Connection, SavedView } from '@deservefirst/contracts';

import type { ListState } from './use-list-state';

export interface ListColumn<T> {
  readonly id: string;
  readonly title: string;
  readonly render: (row: T) => ReactNode;
  readonly sortable?: boolean;
}

export interface BulkAction {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  onAction(selectedIds: readonly string[], allSelected: boolean): void;
}

export interface ListScreenProps<T extends { id: string }> {
  readonly title: string;
  readonly resourceName: { singular: string; plural: string };
  readonly connection: Connection<T>;
  readonly columns: readonly ListColumn<T>[];
  readonly views: readonly SavedView[];
  readonly state: ListState;
  readonly loading?: boolean;
  readonly bulkActions?: readonly BulkAction[];
  readonly primaryAction?: { label: string; onAction(): void };
  readonly secondaryActions?: readonly { label: string; onAction(): void }[];
  readonly onRowClick?: (row: T) => void;
  readonly emptyState?: ReactNode;
}

export function ListScreen<T extends { id: string }>({
  title,
  resourceName,
  connection,
  columns,
  views,
  state,
  loading = false,
  bulkActions = [],
  primaryAction,
  secondaryActions = [],
  onRowClick,
  emptyState,
}: ListScreenProps<T>) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const rows = connection.nodes;

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState([...rows]);

  const activeView = state.query.savedViewId;
  const selectedTab = Math.max(
    0,
    views.findIndex((view) => view.id === activeView),
  );

  const visibleColumns =
    state.query.columns.length > 0
      ? columns.filter((column) => state.query.columns.includes(column.id))
      : columns;

  const appliedFilters = state.query.filters.map((filter) => ({
    key: filter.field,
    label: `${filter.field}: ${filter.value}`,
    onRemove: () => state.removeFilter(filter.field),
  }));

  return (
    <Page
      title={title}
      primaryAction={primaryAction ? { content: primaryAction.label, onAction: primaryAction.onAction } : undefined}
      secondaryActions={secondaryActions.map((action) => ({
        content: action.label,
        onAction: action.onAction,
      }))}
    >
      <BlockStack gap="400">
        <Card padding="0">
          <IndexFilters
            queryValue={state.query.text}
            queryPlaceholder={`Search ${resourceName.plural}`}
            onQueryChange={(value) => state.setText(value)}
            onQueryClear={() => state.setText('')}
            onClearAll={() => state.clearFilters()}
            filters={[]}
            appliedFilters={appliedFilters}
            tabs={views.map((view) => ({
              id: view.id,
              content: view.name,
              onAction: () => state.selectView(view.id),
            }))}
            selected={selectedTab}
            onSelect={(index) => state.selectView(views[index]?.id ?? null)}
            mode={mode}
            setMode={setMode}
            loading={loading}
            cancelAction={{ onAction: () => state.clearFilters(), disabled: false, loading: false }}
          />

          <IndexTable
            resourceName={resourceName}
            itemCount={rows.length}
            selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
            onSelectionChange={handleSelectionChange}
            headings={
              visibleColumns.map((column) => ({ title: column.title })) as [
                { title: string },
                ...{ title: string }[],
              ]
            }
            promotedBulkActions={bulkActions
              .filter((action) => !action.destructive)
              .map((action) => ({
                content: action.label,
                onAction: () => action.onAction(selectedResources, allResourcesSelected === true),
              }))}
            bulkActions={bulkActions
              .filter((action) => action.destructive)
              .map((action) => ({
                content: action.label,
                destructive: true,
                onAction: () => action.onAction(selectedResources, allResourcesSelected === true),
              }))}
            emptyState={
              emptyState ?? (
                <EmptySearchResult
                  title={`No ${resourceName.plural} found`}
                  description="Try changing the filters or search term"
                  withIllustration
                />
              )
            }
          >
            {rows.map((row, index) => (
              <IndexTable.Row
                id={row.id}
                key={row.id}
                position={index}
                selected={selectedResources.includes(row.id)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {visibleColumns.map((column) => (
                  <IndexTable.Cell key={column.id}>{column.render(row)}</IndexTable.Cell>
                ))}
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

        {/* Cursor pagination — never page numbers, which cannot be stable. */}
        <Pagination
          hasPrevious={connection.pageInfo.hasPreviousPage}
          hasNext={connection.pageInfo.hasNextPage}
          onPrevious={() =>
            connection.pageInfo.startCursor && state.previousPage(connection.pageInfo.startCursor)
          }
          onNext={() => connection.pageInfo.endCursor && state.nextPage(connection.pageInfo.endCursor)}
        />
      </BlockStack>
    </Page>
  );
}

/** Status pill shared by every list, so a badge means the same thing everywhere. */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'success' : status === 'draft' ? 'info' : status === 'archived' ? undefined : undefined;
  return <Badge tone={tone}>{status}</Badge>;
}

export function ColumnPicker({
  columns,
  selected,
  onChange,
}: {
  columns: readonly { id: string; title: string }[];
  selected: readonly string[];
  onChange(next: readonly string[]): void;
}) {
  const isVisible = (id: string) => selected.length === 0 || selected.includes(id);
  return (
    <ButtonGroup>
      {columns.map((column) => (
        <Button
          key={column.id}
          pressed={isVisible(column.id)}
          onClick={() =>
            onChange(
              isVisible(column.id)
                ? (selected.length === 0 ? columns.map((c) => c.id) : selected).filter((id) => id !== column.id)
                : [...selected, column.id],
            )
          }
        >
          {column.title}
        </Button>
      ))}
      <Text as="span" tone="subdued" variant="bodySm">
        Columns
      </Text>
    </ButtonGroup>
  );
}
