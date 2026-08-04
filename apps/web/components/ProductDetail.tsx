'use client';

/**
 * Web · components/ProductDetail.tsx
 * Product detail from the DetailScreen template. The toolkit panels — tags,
 * metafields, SEO, translations, timeline — are rendered from the entity's
 * declaration, not implemented here (§12.1). This file holds the product's own
 * fields and nothing else.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';


import type { ProductDto } from '../lib/types';
import {
  BlockStack,
  Checkbox,
  DetailScreen,
  FieldPair,
  MetafieldsPanel,
  Select,
  SeoPanel,
  TagsPanel,
  Text,
  TextField,
  TimelinePanel,
  TranslationsPanel,
  type DetailSection,
} from '@deservefirst/ui';

/** Panels this entity earned, in the order detailPanelsFor() returns them. */
const PANELS = ['tags', 'metafields', 'seo', 'translations', 'timeline'] as const;

export function ProductDetail({ handle, product }: { handle: string; product: ProductDto }) {
  const router = useRouter();

  const [draft, setDraft] = useState(product);
  const [tags, setTags] = useState<readonly string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [locale, setLocale] = useState('fr-CA');

  // "Dirty" is a comparison against what was loaded, not a flag someone sets —
  // a flag drifts out of sync with reality the moment a field resets.
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(product) || tags.length > 0,
    [draft, product, tags],
  );

  const set = <K extends keyof ProductDto>(key: K, value: ProductDto[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const storefrontUrl = `https://${handle}.example.test/products/${draft.handle}`;

  const sections: DetailSection[] = [
    {
      id: 'basics',
      content: (
        <BlockStack gap="300">
          <TextField
            label="Title"
            autoComplete="off"
            value={draft.title}
            onChange={(value) => set('title', value)}
          />
          <TextField
            label="Description"
            autoComplete="off"
            multiline={5}
            value={draft.description}
            onChange={(value) => set('description', value)}
          />
        </BlockStack>
      ),
    },
    {
      id: 'pricing',
      title: 'Pricing',
      content: (
        <BlockStack gap="300">
          <FieldPair>
            <TextField
              label="Price"
              autoComplete="off"
              prefix={draft.price.currency}
              value={draft.price.amount}
              onChange={(value) => set('price', { ...draft.price, amount: value })}
            />
            <TextField
              label="Compare-at price"
              autoComplete="off"
              prefix={draft.price.currency}
              value={draft.compareAtPrice?.amount ?? ''}
              onChange={(value) =>
                set('compareAtPrice', value ? { amount: value, currency: draft.price.currency } : null)
              }
            />
          </FieldPair>
          <Text as="p" tone="subdued" variant="bodySm">
            Amounts are stored as exact integer minor units in {draft.price.currency}; what you
            type is parsed, never rounded through a float.
          </Text>
        </BlockStack>
      ),
    },
    {
      id: 'organization',
      title: 'Product organization',
      placement: 'aside',
      content: (
        <BlockStack gap="300">
          <TextField
            label="Product type"
            autoComplete="off"
            value={draft.productType ?? ''}
            onChange={(value) => set('productType', value || null)}
          />
          <TextField
            label="Vendor"
            autoComplete="off"
            value={draft.vendor ?? ''}
            onChange={(value) => set('vendor', value || null)}
          />
          <TextField
            label="Handle"
            autoComplete="off"
            helpText="Changing this records a 301 automatically, so existing links keep working."
            value={draft.handle}
            onChange={(value) => set('handle', value)}
          />
        </BlockStack>
      ),
    },
    {
      id: 'status',
      title: 'Status',
      placement: 'aside',
      content: (
        <BlockStack gap="300">
          <Select
            label="Status"
            options={[
              { label: 'Draft', value: 'draft' },
              { label: 'Active', value: 'active' },
              { label: 'Archived', value: 'archived' },
            ]}
            value={draft.status}
            onChange={(value) => set('status', value as ProductDto['status'])}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Publishing is a rule-checked transition: archived products must be unarchived first,
            and a product with no price cannot go live.
          </Text>
          <Checkbox
            label="Online Store"
            checked={draft.publishedChannels.includes('online-store')}
            onChange={(checked) =>
              set(
                'publishedChannels',
                checked
                  ? [...draft.publishedChannels, 'online-store']
                  : draft.publishedChannels.filter((channel) => channel !== 'online-store'),
              )
            }
          />
        </BlockStack>
      ),
    },
  ];

  return (
    <DetailScreen
      title={draft.title}
      subtitle={`${draft.price.currency} · version ${product.version}`}
      backAction={{ onAction: () => router.push(`/store/${handle}/products`) }}
      sections={sections}
      dirty={dirty}
      onSave={() => setDraft(draft)}
      onDiscard={() => {
        setDraft(product);
        setTags([]);
      }}
      secondaryActions={[
        { label: 'Duplicate', onAction: () => {} },
        { label: 'Archive', destructive: true, onAction: () => {} },
      ]}
      slotContent={{
        // Everything below is inherited from the entity declaration — none of it
        // is product-specific code.
        sidebar: PANELS.includes('tags') ? (
          <TagsPanel tags={tags} onChange={setTags} />
        ) : null,
        tabs: (
          <BlockStack gap="400">
            <MetafieldsPanel
              title="Category metafields"
              fields={[
                {
                  definitionId: 'color',
                  label: 'Color',
                  namespace: 'taxonomy',
                  key: 'color',
                  type: 'single_line_text',
                  source: 'category',
                  value: '',
                  choices: ['Navy', 'Geometric', 'Green', 'Striped', 'Grey'],
                  onChange: () => {},
                },
                {
                  definitionId: 'fabric',
                  label: 'Fabric',
                  namespace: 'taxonomy',
                  key: 'fabric',
                  type: 'single_line_text',
                  source: 'category',
                  value: '',
                  choices: ['Bamboo', 'Canvas', 'Cashmere', 'Corduroy'],
                  onChange: () => {},
                },
              ]}
            />

            <SeoPanel
              preview={{
                title: seoTitle || draft.title,
                url: storefrontUrl,
                description: seoDescription || draft.description.replace(/<[^>]*>/g, ' ').trim(),
                warnings: [],
              }}
              title={seoTitle}
              description={seoDescription}
              onTitleChange={setSeoTitle}
              onDescriptionChange={setSeoDescription}
            />

            <TranslationsPanel
              locales={[
                { label: 'French (Canada)', value: 'fr-CA' },
                { label: 'Hindi', value: 'hi' },
              ]}
              activeLocale={locale}
              entries={[
                { field: 'title', label: 'Title', source: draft.title, value: '', outdated: false },
                { field: 'description', label: 'Description', source: 'Source description', value: '', outdated: true },
              ]}
              onLocaleChange={setLocale}
              onChange={() => {}}
            />

            <TimelinePanel
              entries={[
                {
                  id: '1',
                  actorLabel: 'Seed',
                  message: 'created this product',
                  occurredAt: 'just now',
                  kind: 'change',
                },
              ]}
              onComment={() => {}}
            />
          </BlockStack>
        ),
      }}
    />
  );
}
