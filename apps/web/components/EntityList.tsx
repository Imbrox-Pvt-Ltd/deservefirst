'use client';

/**
 * Web · components/EntityList.tsx
 * One list screen for every entity, driven by the resource definition's declared
 * columns (§13.2). Products, collections and customers all render through this;
 * none of them has a list component of its own.
 *
 * If adding an entity required copying this file, the "one resource definition →
 * every surface" claim would be marketing rather than architecture.
 * Layer: web.
 */

import { Badge, Text } from '@deservefirst/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';

import type { Connection, SavedView } from '@deservefirst/contracts';
import { ListScreen, useListState, type ListColumn } from '@deservefirst/ui';

import { formatMoney, type MoneyDto } from '../lib/types';

/** A column as the resource declares it, before it knows how to render. */
export interface DeclaredColumn {
  readonly field: string;
  readonly label: string;
  readonly defaultVisible: boolean;
}

export interface EntityListProps<T extends { id: string }> {
  readonly title: string;
  readonly handle: string;
  readonly urlSegment: string;
  readonly resourceName: { singular: string; plural: string };
  readonly columns: readonly DeclaredColumn[];
  readonly connection: Connection<T>;
  readonly views: readonly SavedView[];
  readonly createLabel?: string;
  /** Per-entity overrides for fields that need more than a default renderer. */
  readonly renderers?: Readonly<Record<string, (row: T) => ReactNode>>;
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'attention' | undefined> = {
  active: 'success',
  subscribed: 'success',
  draft: 'info',
  invited: 'info',
  pending: 'attention',
  archived: undefined,
  disabled: undefined,
  declined: undefined,
  'not-subscribed': undefined,
  unknown: undefined,
};

/**
 * The default renderer, chosen from the value's own shape. It handles the four
 * cases that cover almost every column — status-like strings, money, booleans
 * and plain values — so a resource only supplies a renderer when it genuinely
 * needs one.
 */
function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—';

  if (typeof value === 'object' && value !== null && 'amount' in value && 'currency' in value) {
    return formatMoney(value as MoneyDto);
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  const text = String(value);
  if (Object.prototype.hasOwnProperty.call(STATUS_TONE, text)) {
    return <Badge tone={STATUS_TONE[text]}>{text.replace(/-/g, ' ')}</Badge>;
  }

  return text;
}

export function EntityList<T extends { id: string }>({
  title,
  handle,
  urlSegment,
  resourceName,
  columns,
  connection,
  views,
  createLabel,
  renderers = {},
}: EntityListProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useListState({
    searchParams: new URLSearchParams(searchParams.toString()),
    pathname,
    navigate: (url, options) =>
      options.replace ? router.replace(url, { scroll: false }) : router.push(url),
  });

  const listColumns = useMemo<ListColumn<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.field,
        title: column.label,
        render: (row) => {
          const custom = renderers[column.field];
          if (custom) return custom(row);
          return renderValue((row as Record<string, unknown>)[column.field]);
        },
      })),
    [columns, renderers],
  );

  const base = `/store/${handle}/${urlSegment}`;

  return (
    <ListScreen<T>
      title={title}
      resourceName={resourceName}
      connection={connection}
      columns={listColumns}
      views={views}
      state={state}
      primaryAction={
        createLabel ? { label: createLabel, onAction: () => router.push(`${base}/new`) } : undefined
      }
      secondaryActions={[{ label: 'Export', onAction: () => state.openDialog('export') }]}
      bulkActions={[
        {
          id: 'edit',
          label: 'Bulk edit',
          onAction: (ids) =>
            router.push(
              `/store/${handle}/bulk/${resourceName.singular}?resource_name=${resourceName.singular}` +
                `&return_to=${encodeURIComponent(`${pathname}?${searchParams.toString()}`)}` +
                `&ids=${ids.join(',')}`,
            ),
        },
        { id: 'delete', label: 'Delete', destructive: true, onAction: () => state.openDialog('delete') },
      ]}
      onRowClick={(row) => router.push(`${base}/${row.id}`)}
      emptyState={
        <Text as="p" tone="subdued">
          No {resourceName.plural} match this view yet.
        </Text>
      }
    />
  );
}
