'use client';

/**
 * Web · components/CollectionDetail.tsx
 * The condition builder. Exclusions are a separate, clearly-labelled set rather
 * than a "not" operator inside the inclusion list — because "everything tagged
 * sale, except clearance" is how a merchant thinks about it, and burying the
 * except inside the same list makes the precedence invisible.
 * Layer: web.
 */

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { DetailScreen, type DetailSection } from '@deservefirst/ui';

import { saveCollectionDetails, saveCollectionRules } from '../app/actions/collections';
import type { CollectionDto, ConditionDto } from '../lib/types';

const FIELDS = [
  { label: 'Product title', value: 'title' },
  { label: 'Product type', value: 'type' },
  { label: 'Vendor', value: 'vendor' },
  { label: 'Tag', value: 'tag' },
  { label: 'Price', value: 'price' },
  { label: 'Compare-at price', value: 'compareAtPrice' },
  { label: 'Inventory quantity', value: 'inventoryQuantity' },
];

const TEXT_OPERATORS = [
  { label: 'is equal to', value: 'equals' },
  { label: 'is not equal to', value: 'notEquals' },
  { label: 'contains', value: 'contains' },
  { label: 'does not contain', value: 'notContains' },
  { label: 'starts with', value: 'startsWith' },
  { label: 'ends with', value: 'endsWith' },
];

const NUMERIC_OPERATORS = [
  { label: 'is equal to', value: 'equals' },
  { label: 'is not equal to', value: 'notEquals' },
  { label: 'is greater than', value: 'greaterThan' },
  { label: 'is less than', value: 'lessThan' },
];

const NUMERIC_FIELDS = new Set(['price', 'compareAtPrice', 'inventoryQuantity']);

/** Tags are a set, so substring operators would mislead. */
const TAG_OPERATORS = TEXT_OPERATORS.filter((operator) =>
  ['equals', 'notEquals'].includes(operator.value),
);

function operatorsFor(field: string) {
  if (NUMERIC_FIELDS.has(field)) return NUMERIC_OPERATORS;
  if (field === 'tag') return TAG_OPERATORS;
  return TEXT_OPERATORS;
}

const blank: ConditionDto = { field: 'tag', operator: 'equals', value: '' };

export function CollectionDetail({ handle, collection }: { handle: string; collection: CollectionDto }) {
  const router = useRouter();
  const [saved, setSaved] = useState(collection);
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description);
  const [match, setMatch] = useState(collection.match);
  const [conditions, setConditions] = useState<ConditionDto[]>([...collection.conditions]);
  const [exclusions, setExclusions] = useState<ConditionDto[]>([...collection.exclusions]);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ tone: 'critical' | 'warning' | 'success'; message: string } | null>(null);

  const detailsDirty = title !== saved.title || description !== saved.description;
  const rulesDirty =
    match !== saved.match ||
    JSON.stringify(conditions) !== JSON.stringify(saved.conditions) ||
    JSON.stringify(exclusions) !== JSON.stringify(saved.exclusions);

  const apply = (result: { ok: boolean; data?: CollectionDto; error?: string; conflict?: boolean }, message: string) => {
    if (result.ok && result.data) {
      setSaved(result.data);
      setConditions([...result.data.conditions]);
      setExclusions([...result.data.exclusions]);
      setMatch(result.data.match);
      setBanner({ tone: 'success', message });
      return;
    }
    setBanner({
      tone: result.conflict ? 'warning' : 'critical',
      message: result.conflict
        ? `${result.error} Reload to see the current version.`
        : (result.error ?? 'Could not save.'),
    });
  };

  const save = () =>
    startTransition(async () => {
      if (detailsDirty) {
        const result = await saveCollectionDetails(handle, {
          id: saved.id,
          version: saved.version,
          title,
          description,
        });
        if (!result.ok) return apply(result, '');
        setSaved(result.data!);
      }

      if (rulesDirty) {
        const current = detailsDirty ? saved.version + 1 : saved.version;
        const result = await saveCollectionRules(handle, {
          id: saved.id,
          version: current,
          match,
          // Empty rows are a UI artefact of adding a condition before filling it;
          // sending them would fail validation for something the merchant has not
          // finished typing.
          conditions: conditions.filter((condition) => condition.value.trim() !== ''),
          exclusions: exclusions.filter((condition) => condition.value.trim() !== ''),
        });
        return apply(result, 'Saved.');
      }

      setBanner({ tone: 'success', message: 'Saved.' });
    });

  const sections: DetailSection[] = [
    {
      id: 'basics',
      content: (
        <BlockStack gap="300">
          <TextField label="Title" autoComplete="off" value={title} onChange={setTitle} />
          <TextField
            label="Description"
            autoComplete="off"
            multiline={4}
            value={description}
            onChange={setDescription}
          />
        </BlockStack>
      ),
    },
    {
      id: 'conditions',
      title: 'Products must match',
      content: (
        <BlockStack gap="300">
          <Select
            label=""
            labelHidden
            options={[
              { label: 'all conditions', value: 'all' },
              { label: 'any condition', value: 'any' },
            ]}
            value={match}
            onChange={(value) => setMatch(value as 'all' | 'any')}
          />

          {conditions.map((condition, index) => (
            <ConditionRow
              key={`condition-${index}`}
              condition={condition}
              onChange={(next) =>
                setConditions((all) => all.map((entry, i) => (i === index ? next : entry)))
              }
              onRemove={() => setConditions((all) => all.filter((_, i) => i !== index))}
            />
          ))}

          <InlineStack>
            <Button onClick={() => setConditions((all) => [...all, { ...blank }])}>
              Add condition
            </Button>
          </InlineStack>

          {conditions.length === 0 && (
            <Text as="p" tone="subdued" variant="bodySm">
              With no conditions this stays a manual collection — you choose its products directly.
            </Text>
          )}
        </BlockStack>
      ),
    },
  ];

  if (conditions.length > 0) {
    sections.push({
      id: 'exclusions',
      title: 'But exclude products matching',
      content: (
        <BlockStack gap="300">
          <Text as="p" tone="subdued" variant="bodySm">
            An exclusion always wins. A product matching an exclusion is out, however many
            conditions above it matched.
          </Text>

          {exclusions.map((condition, index) => (
            <ConditionRow
              key={`exclusion-${index}`}
              condition={condition}
              onChange={(next) =>
                setExclusions((all) => all.map((entry, i) => (i === index ? next : entry)))
              }
              onRemove={() => setExclusions((all) => all.filter((_, i) => i !== index))}
            />
          ))}

          <InlineStack>
            <Button onClick={() => setExclusions((all) => [...all, { ...blank }])}>
              Add exclusion
            </Button>
          </InlineStack>
        </BlockStack>
      ),
    });
  }

  sections.push({
    id: 'type',
    title: 'Collection type',
    placement: 'aside',
    content: (
      <BlockStack gap="200">
        <InlineStack>
          <Badge tone={saved.type === 'automated' ? 'info' : undefined}>{saved.type}</Badge>
        </InlineStack>
        <Text as="p" tone="subdued" variant="bodySm">
          {saved.type === 'automated'
            ? 'Members come from the conditions. Adding a product directly is refused — membership would have two sources of truth.'
            : 'You choose the members. Adding a condition makes this collection automated.'}
        </Text>
      </BlockStack>
    ),
  });

  return (
    <DetailScreen
      title={saved.title}
      subtitle={`/${saved.handle} · version ${saved.version}`}
      backAction={{ onAction: () => router.push(`/store/${handle}/collections`) }}
      sections={sections}
      dirty={detailsDirty || rulesDirty}
      saving={pending}
      onSave={save}
      onDiscard={() => {
        setTitle(saved.title);
        setDescription(saved.description);
        setMatch(saved.match);
        setConditions([...saved.conditions]);
        setExclusions([...saved.exclusions]);
        setBanner(null);
      }}
      slotContent={{
        header: banner ? (
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            <p>{banner.message}</p>
          </Banner>
        ) : null,
      }}
    />
  );
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: ConditionDto;
  onChange(next: ConditionDto): void;
  onRemove(): void;
}) {
  const operators = operatorsFor(condition.field);
  const numeric = NUMERIC_FIELDS.has(condition.field);

  return (
    <Card>
      <InlineStack gap="200" blockAlign="end" wrap>
        <Select
          label="Field"
          options={FIELDS}
          value={condition.field}
          onChange={(field) => {
            // Switching field can invalidate the operator — "greater than" does
            // not apply to a vendor name — so reset rather than save something
            // the API will refuse.
            const allowed = operatorsFor(field);
            const operator = allowed.some((entry) => entry.value === condition.operator)
              ? condition.operator
              : allowed[0]!.value;
            onChange({ ...condition, field, operator });
          }}
        />
        <Select
          label="Condition"
          options={operators}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
        />
        <TextField
          label="Value"
          autoComplete="off"
          type={numeric ? 'number' : 'text'}
          helpText={numeric ? 'In minor units — 1000 means 10.00' : undefined}
          value={condition.value}
          onChange={(value) => onChange({ ...condition, value })}
        />
        <Button tone="critical" variant="plain" onClick={onRemove}>
          Remove
        </Button>
      </InlineStack>
    </Card>
  );
}
