'use client';

/**
 * Web · components/MenuEditor.tsx
 * Editing a menu's tree.
 *
 * The domain refuses a menu that nests too deep, repeats an item or carries a
 * `javascript:` link. This screen makes those refusals unreachable instead of
 * merely survivable: "Add sub-item" disappears at the depth limit rather than
 * failing on save, and every new item gets a fresh id so a duplicate cannot be
 * constructed by hand. A form whose only guard is the server's is a form that
 * teaches people to guess.
 *
 * The whole tree is saved at once, with the version it was loaded at. A menu is
 * a single thing a merchant reasons about — moving an item and renaming another
 * is one edit, not two — and per-item saves would let half of it land.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
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

import { saveMenu } from '../app/actions/content-editing';
import type { MenuDto, MenuItemDto } from '../lib/types';

/** Mirrors MAX_MENU_DEPTH in the domain — see the note in `addChild`. */
const MAX_DEPTH = 3;

const TARGETS: { value: MenuItemDto['target']; label: string }[] = [
  { value: 'home', label: 'Home page' },
  { value: 'collection', label: 'Collection' },
  { value: 'product', label: 'Product' },
  { value: 'page', label: 'Page' },
  { value: 'blog', label: 'Blog' },
  { value: 'policy', label: 'Policy' },
  { value: 'search', label: 'Search' },
  { value: 'http', label: 'External link' },
];

/** Targets that point at one of our records, so they need a subject id. */
const NEEDS_SUBJECT = new Set(['collection', 'product', 'page', 'blog', 'policy']);

function blankItem(): MenuItemDto {
  return {
    // A fresh id every time. The domain refuses a tree where one id appears
    // twice, because that is what a cycle looks like once flattened — and the
    // only way to build one from this screen would be to reuse an id.
    id: `mi-${Math.random().toString(36).slice(2, 10)}`,
    title: '',
    target: 'home',
    url: '/',
    subjectId: null,
    children: [],
  };
}

/** Immutably replaces one item anywhere in the tree, found by id. */
function edit(
  items: readonly MenuItemDto[],
  id: string,
  change: (item: MenuItemDto) => MenuItemDto | null,
): MenuItemDto[] {
  return items.flatMap((item) => {
    if (item.id === id) {
      const next = change(item);
      return next ? [next] : [];
    }
    return [{ ...item, children: edit(item.children, id, change) }];
  });
}

export function MenuEditor({ handle, menu }: { handle: string; menu: MenuDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(menu.title);
  const [items, setItems] = useState<readonly MenuItemDto[]>(menu.items);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = title !== menu.title || JSON.stringify(items) !== JSON.stringify(menu.items);

  const save = () =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const result = await saveMenu(handle, menu.id, menu.version, { title, items });
      if (!result.ok) {
        setError(result.error ?? 'Could not save this menu');
        return;
      }
      setSaved(true);
      router.refresh();
    });

  const renderItem = (item: MenuItemDto, depth: number) => (
    <Box
      key={item.id}
      paddingInlineStart={depth > 1 ? '600' : undefined}
      borderColor={depth > 1 ? 'border' : undefined}
      borderInlineStartWidth={depth > 1 ? '025' : undefined}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" fontWeight="medium">
              {item.title || 'Untitled item'}
            </Text>
            <Badge>{TARGETS.find((t) => t.value === item.target)?.label ?? item.target}</Badge>
          </InlineStack>
          <Button
            variant="plain"
            tone="critical"
            onClick={() => setItems((tree) => edit(tree, item.id, () => null))}
          >
            Remove
          </Button>
        </InlineStack>

        <TextField
          label="Title"
          value={item.title}
          autoComplete="off"
          onChange={(value) =>
            setItems((tree) => edit(tree, item.id, (entry) => ({ ...entry, title: value })))
          }
        />

        <Select
          label="Links to"
          value={item.target}
          options={TARGETS}
          onChange={(value) =>
            setItems((tree) =>
              edit(tree, item.id, (entry) => ({
                ...entry,
                target: value as MenuItemDto['target'],
                // Clearing the subject when the kind changes: a product id left
                // behind on a link that now points at a page is a dead link the
                // merchant cannot see.
                subjectId: NEEDS_SUBJECT.has(value) ? entry.subjectId : null,
              })),
            )
          }
        />

        <TextField
          label={item.target === 'http' ? 'URL' : 'Path'}
          value={item.url}
          autoComplete="off"
          helpText={
            item.target === 'http'
              ? 'Must be http or https.'
              : 'A path inside your store, starting with /'
          }
          onChange={(value) =>
            setItems((tree) => edit(tree, item.id, (entry) => ({ ...entry, url: value })))
          }
        />

        {NEEDS_SUBJECT.has(item.target) ? (
          <TextField
            label="Links to which one"
            value={item.subjectId ?? ''}
            autoComplete="off"
            helpText="The id of the record this points at."
            onChange={(value) =>
              setItems((tree) =>
                edit(tree, item.id, (entry) => ({ ...entry, subjectId: value || null })),
              )
            }
          />
        ) : null}

        {item.children.map((child) => renderItem(child, depth + 1))}

        {/*
          * Hidden at the limit rather than shown and refused. The domain caps
          * nesting at three, and a button that always fails is worse than no
          * button — it teaches a merchant the screen is unreliable.
          */}
        {depth < MAX_DEPTH ? (
          <InlineStack>
            <Button
              variant="plain"
              onClick={() =>
                setItems((tree) =>
                  edit(tree, item.id, (entry) => ({
                    ...entry,
                    children: [...entry.children, blankItem()],
                  })),
                )
              }
            >
              Add sub-item
            </Button>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Box>
  );

  return (
    <Page
      title={menu.title}
      backAction={{ content: 'Menus', url: `/store/${handle}/navigation` }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {saved && !dirty ? (
          <Banner tone="success" title="Saved">
            <Text as="p">Your storefront navigation is updated.</Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <TextField label="Menu title" value={title} onChange={setTitle} autoComplete="off" />
            <Text as="p" tone="subdued" variant="bodySm">
              Handle: <code>{menu.handle}</code> — themes reference the menu by this, so it cannot
              be changed.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Items
            </Text>

            {items.length === 0 ? (
              <Text as="p" tone="subdued">
                This menu is empty, so nothing shows in your storefront navigation.
              </Text>
            ) : (
              items.map((item) => renderItem(item, 1))
            )}

            <InlineStack>
              <Button onClick={() => setItems((tree) => [...tree, blankItem()])}>Add item</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineStack gap="200">
          <Button variant="primary" disabled={pending || !dirty} onClick={save}>
            Save menu
          </Button>
          {dirty ? (
            <Button
              variant="plain"
              disabled={pending}
              onClick={() => {
                setTitle(menu.title);
                setItems(menu.items);
                setError(null);
              }}
            >
              Discard changes
            </Button>
          ) : null}
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
