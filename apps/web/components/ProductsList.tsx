'use client';

/**
 * Web · components/ProductsList.tsx
 * The products list, built from the ListScreen template. Note what is NOT here:
 * no filter state, no sort state, no pagination state, no column state. All of
 * it lives in the URL and is read back through useListState (§24.3), which is
 * why this file is mostly a column definition.
 * Layer: web.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import type { Connection, SavedView } from '@deservefirst/contracts';

import { formatMoney, type ProductDto } from '../lib/types';
import {
  Badge,
  ListScreen,
  Text,
  type ListColumn,
  useListState,
} from '@deservefirst/ui';

const STATUS_TONE: Record<string, 'success' | 'info' | undefined> = {
  active: 'success',
  draft: 'info',
  archived: undefined,
};

export function ProductsList({
  handle,
  connection,
  views,
}: {
  handle: string;
  connection: Connection<ProductDto>;
  views: readonly SavedView[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useListState({
    searchParams: new URLSearchParams(searchParams.toString()),
    pathname,
    // `replace` for view tweaks so filter changes do not spam the back button;
    // `push` for real navigation. The hook decides which per action.
    navigate: (url, options) =>
      options.replace ? router.replace(url, { scroll: false }) : router.push(url),
  });

  const columns = useMemo<ListColumn<ProductDto>[]>(
    () => [
      {
        id: 'title',
        title: 'Product',
        sortable: true,
        render: (row) => (
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {row.title}
          </Text>
        ),
      },
      {
        id: 'status',
        title: 'Status',
        render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
      },
      {
        id: 'productType',
        title: 'Product type',
        render: (row) => row.productType ?? '—',
      },
      {
        id: 'vendor',
        title: 'Vendor',
        sortable: true,
        render: (row) => row.vendor ?? '—',
      },
      {
        id: 'price',
        title: 'Price',
        sortable: true,
        // Formatted per the store's own currency, from the wire's exact string.
        render: (row) => formatMoney(row.price),
      },
    ],
    [],
  );

  return (
    <ListScreen<ProductDto>
      title="Products"
      resourceName={{ singular: 'product', plural: 'products' }}
      connection={connection}
      columns={columns}
      views={views}
      state={state}
      primaryAction={{
        label: 'Add product',
        onAction: () => router.push(`/store/${handle}/products/new`),
      }}
      secondaryActions={[
        { label: 'Export', onAction: () => state.openDialog('export') },
        { label: 'Import', onAction: () => state.openDialog('import') },
      ]}
      bulkActions={[
        {
          id: 'edit',
          label: 'Bulk edit',
          // The generic bulk editor: one route serves every entity, parameterised
          // by which fields are editable.
          onAction: (ids) =>
            router.push(
              `/store/${handle}/bulk/product?resource_name=Product&edit=title,status,vendor&return_to=${encodeURIComponent(
                `${pathname}?${searchParams.toString()}`,
              )}&ids=${ids.join(',')}`,
            ),
        },
        { id: 'archive', label: 'Archive', destructive: true, onAction: () => state.openDialog('archive') },
      ]}
      onRowClick={(row) => router.push(`/store/${handle}/products/${row.id}`)}
    />
  );
}
