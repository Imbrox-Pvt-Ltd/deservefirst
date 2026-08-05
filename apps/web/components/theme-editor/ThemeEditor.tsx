'use client';

/**
 * Web · components/theme-editor/ThemeEditor.tsx
 * The theme editor: sections on the left, the store in the middle, settings on the right.
 *
 * Three panes because that is the shape of the job — what is on this page, what
 * it looks like, and what this piece is configured to do. A merchant reorders on
 * the left and watches the middle change.
 *
 * The preview is a real render of the draft, in an iframe pointed at the
 * storefront. Not a mock-up and not a client-side approximation: it goes through
 * the same engine, filters and drops a customer's page would, so what a merchant
 * approves is what ships. A preview built from a different code path is a
 * preview that lies eventually.
 *
 * Every mutation goes to the server, which owns validation — the controls make
 * an invalid value hard to reach, and the server makes it impossible. State
 * lives in the URL where it identifies what is being edited (§24), so a merchant
 * can send a colleague a link to the section they are looking at.
 * Layer: web.
 */

import { useCallback, useMemo, useState, useTransition } from 'react';

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Select,
  Spinner,
  Text,
} from '@deservefirst/ui';

import {
  applyThemeEdit,
  discardThemeDraft,
  publishTheme,
} from '../../app/actions/theme-editor';
import { SettingInput, type SettingDefinition } from './SettingInput';

export interface EditorSection {
  readonly id: string;
  readonly type: string;
  readonly settings: Record<string, unknown>;
  readonly blocks: readonly { id: string; type: string; settings: Record<string, unknown> }[];
  readonly disabled: boolean;
}

export interface SectionSchemaSummary {
  readonly name: string;
  readonly settings?: readonly SettingDefinition[];
  readonly blocks?: readonly { type: string; name?: string; settings?: readonly SettingDefinition[] }[];
  readonly max_blocks?: number;
}

export interface AddableSection {
  readonly type: string;
  readonly name: string;
}

export interface ThemeEditorProps {
  readonly storeHandle: string;
  readonly themeId: string;
  readonly templatePath: string;
  readonly templates: readonly string[];
  readonly sections: readonly EditorSection[];
  readonly version: number;
  readonly schemas: Readonly<Record<string, SectionSchemaSummary>>;
  readonly addable: readonly AddableSection[];
  readonly previewUrl: string;
  /** Sections whose schema could not be read, so the merchant is told which. */
  readonly unusable?: readonly { type: string; reason: string }[];
  readonly hasUnsavedChanges: boolean;
}

type EditAction = Record<string, unknown> & { kind: string };

export function ThemeEditor(props: ThemeEditorProps) {
  const [sections, setSections] = useState(props.sections);
  const [version, setVersion] = useState(props.version);
  const [selectedId, setSelectedId] = useState<string | null>(props.sections[0]?.id ?? null);
  const [dirty, setDirty] = useState(props.hasUnsavedChanges);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * The preview is reloaded by changing its `key`, which remounts the iframe.
   *
   * Cruder than posting a message into it, and right for now: the draft lives
   * on the server, so a fresh load is guaranteed to show exactly what was
   * saved. A message-based update would have to replicate the render.
   */
  const [previewNonce, setPreviewNonce] = useState(0);

  const selected = useMemo(
    () => sections.find((section) => section.id === selectedId) ?? null,
    [sections, selectedId],
  );
  const schema = selected ? props.schemas[selected.type] : undefined;

  const send = useCallback(
    (action: EditAction) => {
      setError(null);
      startTransition(async () => {
        const result = await applyThemeEdit(
          props.themeId,
          props.templatePath,
          action,
          version,
        );

        if (!result.ok) {
          /**
           * A conflict is not an error to shrug at.
           *
           * Somebody else saved while this editor was open, so the version this
           * change was made against no longer exists. Reloading is the only
           * honest resolution — merging silently would discard one of them.
           */
          if (result.code === 'conflict') setConflict(true);
          setError(result.error ?? 'That change could not be applied.');
          return;
        }

        const next = result.data as { sections: EditorSection[]; version: number };
        setSections(next.sections);
        setVersion(next.version);
        setDirty(true);
        setPreviewNonce((value) => value + 1);
      });
    },
    [props.themeId, props.templatePath, version],
  );

  if (conflict) {
    return (
      <Box padding="400">
        <Banner
          tone="warning"
          title="Someone else edited this template"
          action={{ content: 'Reload the editor', onAction: () => window.location.reload() }}
        >
          <Text as="p">
            Your changes were not applied, so nothing has been lost — but this template moved on
            while you had it open. Reload to see their version before making yours again.
          </Text>
        </Banner>
      </Box>
    );
  }

  return (
    <BlockStack gap="0">
      {error ? (
        <Box padding="300">
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="p">{error}</Text>
          </Banner>
        </Box>
      ) : null}

      {(props.unusable?.length ?? 0) > 0 ? (
        <Box padding="300">
          <Banner tone="warning" title="Some sections could not be read">
            <Text as="p">
              {props.unusable?.map((entry) => entry.type).join(', ')} — their schema is not valid
              JSON, so they cannot be configured here. The rest of the theme is unaffected.
            </Text>
          </Banner>
        </Box>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 280px) 1fr minmax(280px, 360px)',
          gap: 0,
          height: 'calc(100vh - 56px)',
        }}
      >
        {/* ---------------------------------------------------- left: sections */}
        <Box borderInlineEndWidth="025" borderColor="border" overflowY="scroll" padding="300">
          <BlockStack gap="300">
            <Select
              label="Template"
              options={props.templates.map((path) => ({ value: path, label: readableTemplate(path) }))}
              value={props.templatePath}
              onChange={(path) => {
                window.location.search = new URLSearchParams({
                  theme: props.themeId,
                  template: path,
                }).toString();
              }}
            />

            <Divider />

            <BlockStack gap="100">
              {sections.map((section, index) => (
                <SectionRow
                  key={section.id}
                  section={section}
                  schemaName={props.schemas[section.type]?.name ?? section.type}
                  selected={section.id === selectedId}
                  first={index === 0}
                  last={index === sections.length - 1}
                  busy={pending}
                  onSelect={() => setSelectedId(section.id)}
                  onMove={(direction) =>
                    send({
                      kind: 'move_section',
                      sectionId: section.id,
                      toIndex: index + direction,
                    })
                  }
                  onToggle={() =>
                    send({
                      kind: 'toggle_section',
                      sectionId: section.id,
                      disabled: !section.disabled,
                    })
                  }
                  onRemove={() => {
                    if (section.id === selectedId) setSelectedId(null);
                    send({ kind: 'remove_section', sectionId: section.id });
                  }}
                />
              ))}
            </BlockStack>

            <AddSection addable={props.addable} busy={pending} onAdd={(type) => send({ kind: 'add_section', sectionType: type })} />
          </BlockStack>
        </Box>

        {/* ------------------------------------------------- middle: the store */}
        <Box background="bg-surface-secondary" padding="200">
          <div style={{ position: 'relative', height: '100%' }}>
            {pending ? (
              <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }}>
                <Spinner accessibilityLabel="Updating the preview" size="small" />
              </div>
            ) : null}
            <iframe
              key={previewNonce}
              src={props.previewUrl}
              title="Storefront preview"
              style={{
                width: '100%',
                height: '100%',
                border: '1px solid #e3e3e3',
                borderRadius: 8,
                background: '#fff',
              }}
              /**
               * Sandboxed. The preview renders a merchant's theme, which is
               * third-party code — `allow-same-origin` is omitted so it cannot
               * reach the editor's own storage or session, and scripts are
               * allowed because a theme's own JavaScript is most of what a
               * merchant is previewing.
               */
              sandbox="allow-scripts allow-forms"
            />
          </div>
        </Box>

        {/* ------------------------------------------------- right: settings */}
        <Box borderInlineStartWidth="025" borderColor="border" overflowY="scroll" padding="300">
          {!selected ? (
            <Text as="p" tone="subdued">
              Choose a section on the left to configure it.
            </Text>
          ) : (
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {schema?.name ?? selected.type}
                </Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  {selected.id}
                </Text>
              </BlockStack>

              {!schema ? (
                <Banner tone="warning">
                  <Text as="p">
                    This theme has no schema for <code>{selected.type}</code>, so there is nothing to
                    configure.
                  </Text>
                </Banner>
              ) : (
                <BlockStack gap="300">
                  {(schema.settings ?? []).map((setting, index) => (
                    <SettingInput
                      key={setting.id ?? `sidebar-${index}`}
                      setting={setting}
                      value={setting.id ? selected.settings[setting.id] : undefined}
                      disabled={pending}
                      onChange={(next) =>
                        setting.id &&
                        send({
                          kind: 'update_settings',
                          sectionId: selected.id,
                          settings: { [setting.id]: next },
                        })
                      }
                    />
                  ))}
                </BlockStack>
              )}

              {schema?.blocks?.length ? (
                <Blocks
                  section={selected}
                  schema={schema}
                  busy={pending}
                  onSend={send}
                />
              ) : null}
            </BlockStack>
          )}
        </Box>
      </div>

      {dirty ? (
        <Box padding="300" background="bg-surface-secondary" borderBlockStartWidth="025" borderColor="border">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" tone="subdued">
              Unsaved changes. Customers still see the published theme.
            </Text>
            <InlineStack gap="200">
              <Button
                onClick={() =>
                  startTransition(async () => {
                    const result = await discardThemeDraft(props.themeId, props.templatePath);
                    if (result.ok) window.location.reload();
                    else setError(result.error ?? 'Those changes could not be discarded.');
                  })
                }
              >
                Discard
              </Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await publishTheme(props.themeId);
                    if (result.ok) window.location.reload();
                    else
                      setError(
                        result.error ?? 'Publishing failed. Your changes are still saved as a draft.',
                      );
                  })
                }
              >
                Publish
              </Button>
            </InlineStack>
          </InlineStack>
        </Box>
      ) : null}
    </BlockStack>
  );
}

function SectionRow({
  section,
  schemaName,
  selected,
  first,
  last,
  busy,
  onSelect,
  onMove,
  onToggle,
  onRemove,
}: {
  section: EditorSection;
  schemaName: string;
  selected: boolean;
  first: boolean;
  last: boolean;
  busy: boolean;
  onSelect: () => void;
  onMove: (direction: number) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <Box
      padding="200"
      borderRadius="200"
      background={selected ? 'bg-surface-selected' : undefined}
    >
      <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
        <button
          type="button"
          onClick={onSelect}
          style={{
            all: 'unset',
            cursor: 'pointer',
            flex: 1,
            minWidth: 0,
            opacity: section.disabled ? 0.5 : 1,
          }}
        >
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            <Text as="span" variant="bodyMd" truncate>
              {schemaName}
            </Text>
            {section.disabled ? <Badge>Hidden</Badge> : null}
          </InlineStack>
        </button>

        <InlineStack gap="050" wrap={false}>
          {/*
            Buttons rather than drag-and-drop, deliberately for now. They are
            keyboard-reachable and work on a touch screen, and a half-built drag
            interaction that drops a section in the wrong place is worse than a
            pair of arrows that always work.
          */}
          <Button size="micro" disabled={first || busy} onClick={() => onMove(-1)} accessibilityLabel={`Move ${schemaName} up`}>
            ↑
          </Button>
          <Button size="micro" disabled={last || busy} onClick={() => onMove(1)} accessibilityLabel={`Move ${schemaName} down`}>
            ↓
          </Button>
          <Button size="micro" disabled={busy} onClick={onToggle} accessibilityLabel={section.disabled ? 'Show' : 'Hide'}>
            {section.disabled ? '◯' : '●'}
          </Button>
          <Button size="micro" tone="critical" disabled={busy} onClick={onRemove} accessibilityLabel={`Remove ${schemaName}`}>
            ×
          </Button>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}

function AddSection({
  addable,
  busy,
  onAdd,
}: {
  addable: readonly AddableSection[];
  busy: boolean;
  onAdd: (type: string) => void;
}) {
  const [choice, setChoice] = useState('');

  if (addable.length === 0) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        This theme offers no sections for this template.
      </Text>
    );
  }

  return (
    <BlockStack gap="200">
      <Divider />
      <Select
        label="Add a section"
        options={[{ value: '', label: `Choose from ${addable.length}…` }, ...addable.map((entry) => ({
          value: entry.type,
          label: entry.name,
        }))]}
        value={choice}
        onChange={setChoice}
        disabled={busy}
      />
      <Button
        disabled={choice === '' || busy}
        onClick={() => {
          onAdd(choice);
          setChoice('');
        }}
      >
        Add
      </Button>
    </BlockStack>
  );
}

function Blocks({
  section,
  schema,
  busy,
  onSend,
}: {
  section: EditorSection;
  schema: SectionSchemaSummary;
  busy: boolean;
  onSend: (action: EditAction) => void;
}) {
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const block = section.blocks.find((entry) => entry.id === selectedBlock) ?? null;
  const definition = block ? schema.blocks?.find((entry) => entry.type === block.type) : undefined;

  const full =
    schema.max_blocks !== undefined && section.blocks.length >= schema.max_blocks;

  return (
    <BlockStack gap="300">
      <Divider />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h3" variant="headingSm">
          Blocks
        </Text>
        <Text as="span" tone="subdued" variant="bodySm">
          {section.blocks.length}
          {schema.max_blocks !== undefined ? ` / ${schema.max_blocks}` : ''}
        </Text>
      </InlineStack>

      <BlockStack gap="100">
        {section.blocks.map((entry, index) => (
          <InlineStack key={entry.id} align="space-between" blockAlign="center" wrap={false}>
            <button
              type="button"
              onClick={() => setSelectedBlock(entry.id === selectedBlock ? null : entry.id)}
              style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
            >
              <Text as="span" variant="bodySm" truncate>
                {schema.blocks?.find((b) => b.type === entry.type)?.name ?? entry.type}
              </Text>
            </button>
            <InlineStack gap="050" wrap={false}>
              <Button size="micro" disabled={index === 0 || busy}
                onClick={() => onSend({ kind: 'move_block', sectionId: section.id, blockId: entry.id, toIndex: index - 1 })}
                accessibilityLabel="Move block up">↑</Button>
              <Button size="micro" disabled={index === section.blocks.length - 1 || busy}
                onClick={() => onSend({ kind: 'move_block', sectionId: section.id, blockId: entry.id, toIndex: index + 1 })}
                accessibilityLabel="Move block down">↓</Button>
              <Button size="micro" tone="critical" disabled={busy}
                onClick={() => onSend({ kind: 'remove_block', sectionId: section.id, blockId: entry.id })}
                accessibilityLabel="Remove block">×</Button>
            </InlineStack>
          </InlineStack>
        ))}
      </BlockStack>

      {block && definition?.settings?.length ? (
        <Card>
          <BlockStack gap="300">
            {definition.settings.map((setting, index) => (
              <SettingInput
                key={setting.id ?? `block-sidebar-${index}`}
                setting={setting}
                value={setting.id ? block.settings[setting.id] : undefined}
                disabled={busy}
                onChange={(next) =>
                  setting.id &&
                  onSend({
                    kind: 'update_block_settings',
                    sectionId: section.id,
                    blockId: block.id,
                    settings: { [setting.id]: next },
                  })
                }
              />
            ))}
          </BlockStack>
        </Card>
      ) : null}

      {/* The theme's own ceiling, shown rather than discovered by a refusal. */}
      {full ? (
        <Text as="p" tone="subdued" variant="bodySm">
          This section takes {schema.max_blocks} blocks, which is all of them.
        </Text>
      ) : (
        <Select
          label="Add a block"
          labelHidden
          options={[
            { value: '', label: 'Add a block…' },
            ...(schema.blocks ?? [])
              .filter((entry) => !entry.type.startsWith('@'))
              .map((entry) => ({ value: entry.type, label: entry.name ?? entry.type })),
          ]}
          value=""
          disabled={busy}
          onChange={(type) =>
            type && onSend({ kind: 'add_block', sectionId: section.id, blockType: type })
          }
        />
      )}
    </BlockStack>
  );
}

/** `templates/product.wholesale.json` → `Product · wholesale`. */
function readableTemplate(path: string): string {
  const file = path.split('/').pop() ?? path;
  const [name, suffix] = file.replace(/\.(json|liquid)$/, '').split('.');
  const title = (name ?? '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return suffix ? `${title} · ${suffix}` : title;
}
