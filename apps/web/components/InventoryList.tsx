'use client';

/**
 * Web · components/InventoryList.tsx
 * Stock by location, with the count editable in place.
 *
 * This is the one list that is not the generic EntityList, and deliberately so:
 * every other list navigates to a detail screen to change something, but a
 * stocktake means touching twenty rows in a row. Sending someone to a detail
 * page and back for each one is how a merchant ends up doing it in a spreadsheet
 * instead.
 *
 * The location lives in the URL (`?location_id=`), like every other piece of
 * list state (§24.3) — so a count of one warehouse can be bookmarked and shared.
 * Layer: web.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';

import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { adjustStock, recountStock } from '../app/actions/inventory';
import type { InventoryLevelDto, LocationDto } from '../lib/types';

export interface InventoryListProps {
  readonly handle: string;
  readonly locations: readonly LocationDto[];
  readonly levels: readonly InventoryLevelDto[];
  readonly locationId: string | null;
}

export function InventoryList({ handle, locations, levels, locationId }: InventoryListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setLocation = (next: string) => {
    const query = new URLSearchParams(searchParams.toString());
    if (next) query.set('location_id', next);
    else query.delete('location_id');
    router.push(query.toString() ? `${pathname}?${query}` : pathname);
  };

  const shown = locationId ? levels.filter((level) => level.locationId === locationId) : levels;

  return (
    <Page
      title="Inventory"
      subtitle={
        locations.length === 0
          ? 'No locations yet — add one in Settings before counting stock.'
          : undefined
      }
    >
      <BlockStack gap="400">
        <Card>
          <Box padding="400">
            <InlineStack gap="300" blockAlign="end">
              <Box minWidth="260px">
                <Select
                  label="Location"
                  options={[
                    { label: 'All locations', value: '' },
                    ...locations.map((location) => ({ label: location.name, value: location.id })),
                  ]}
                  value={locationId ?? ''}
                  onChange={setLocation}
                />
              </Box>
              <Text as="p" tone="subdued">
                {shown.length} {shown.length === 1 ? 'item' : 'items'}
              </Text>
            </InlineStack>
          </Box>
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <div style={ROW_GRID}>
              <Text as="span" variant="headingSm">Product</Text>
              <Text as="span" variant="headingSm">SKU</Text>
              <Text as="span" variant="headingSm">Incoming</Text>
              <Text as="span" variant="headingSm">Committed</Text>
              <Text as="span" variant="headingSm">Available</Text>
              <Text as="span" variant="headingSm">On hand</Text>
            </div>
          </Box>

          {shown.length === 0 ? (
            <Box padding="500">
              <Text as="p" tone="subdued">
                No stock recorded here yet. Receiving a purchase order or a transfer creates the
                first count.
              </Text>
            </Box>
          ) : (
            shown.map((level) => (
              <LevelRow
                key={level.id}
                handle={handle}
                level={level}
                locationName={locations.find((entry) => entry.id === level.locationId)?.name ?? '—'}
                showLocation={!locationId}
              />
            ))
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}

function LevelRow({
  handle,
  level,
  locationName,
  showLocation,
}: {
  handle: string;
  level: InventoryLevelDto;
  locationName: string;
  showLocation: boolean;
}) {
  const [count, setCount] = useState(String(level.onHand));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = count.trim() !== String(level.onHand);

  const save = () => {
    const onHand = Number(count);
    if (!Number.isInteger(onHand)) {
      setError('Whole units only');
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await recountStock(handle, {
        locationId: level.locationId,
        productId: level.productId,
        variantId: level.variantId,
        onHand,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not save');
        setCount(String(level.onHand));
      }
    });
  };

  const move = (delta: number) => {
    setError(null);
    startTransition(async () => {
      const result = await adjustStock(handle, {
        locationId: level.locationId,
        productId: level.productId,
        variantId: level.variantId,
        delta,
        // A nudge from the list is a correction, not a sale or a receipt. Naming
        // it honestly matters more than picking a friendlier-sounding reason.
        reason: 'correction',
        title: level.title,
      });
      if (!result.ok) setError(result.error ?? 'Could not adjust');
      else setCount(String(result.data?.onHand ?? level.onHand));
    });
  };

  return (
    <Box padding="400" borderBlockEndWidth="025" borderColor="border">
      <div style={ROW_GRID}>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">{level.title}</Text>
          {showLocation ? (
            <Text as="span" tone="subdued" variant="bodySm">{locationName}</Text>
          ) : null}
          {error ? <Text as="span" tone="critical" variant="bodySm">{error}</Text> : null}
        </BlockStack>

        <Text as="span" tone="subdued">{level.sku ?? '—'}</Text>
        <Text as="span">{level.incoming}</Text>
        <Text as="span">{level.committed}</Text>

        {/* Negative on hand is kept as evidence, but nothing is sellable. */}
        {level.onHand < 0 ? (
          <Badge tone="critical">{`0 · owes ${Math.abs(level.onHand)}`}</Badge>
        ) : (
          <Text as="span">{level.available}</Text>
        )}

        <InlineStack gap="150" blockAlign="center" wrap={false}>
          <Button size="slim" disabled={pending} onClick={() => move(-1)} accessibilityLabel="Remove one">
            −
          </Button>
          <Box minWidth="72px">
            <TextField
              label="On hand"
              labelHidden
              type="number"
              value={count}
              autoComplete="off"
              disabled={pending}
              onChange={setCount}
              onBlur={() => dirty && save()}
            />
          </Box>
          <Button size="slim" disabled={pending} onClick={() => move(1)} accessibilityLabel="Add one">
            +
          </Button>
        </InlineStack>
      </div>
    </Box>
  );
}

/**
 * The column track, shared by the header and every row so they line up.
 *
 * A grid rather than an InlineStack of percentage-width boxes: those percentages
 * are of the CONTENT box, so the stepper never fitted and wrapped onto its own
 * line under the product name.
 */
const ROW_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 3fr) 1fr 1fr 1fr 1fr 200px',
  gap: 16,
  alignItems: 'center',
};
