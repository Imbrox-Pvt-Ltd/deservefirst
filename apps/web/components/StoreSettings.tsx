'use client';

/**
 * Web · components/StoreSettings.tsx
 * The settings overlay. Rendered above the admin, closing returns to the page
 * behind it — and it still owns a real, deep-linkable URL (§8.5). Fields are
 * generated from module-contributed settings schemas (§31.9): no module adds a
 * settings page, it declares a schema and the runtime renders it.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';


import type { ResolvedSettingDto, SettingDto, SettingSource } from '../lib/types';
import { resetSetting, saveSetting } from '../app/actions/settings';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Checkbox,
  InlineStack,
  Select,
  SettingsCard,
  SettingsScreen,
  Text,
  TextField,
} from '@deservefirst/ui';

export interface StoreSettingsProps {
  readonly handle: string;
  readonly storeName: string;
  readonly organizationName: string;
  readonly storeCount: number;
  readonly section: string;
  readonly contributed: readonly SettingDto[];
  /** Each declared setting's resolved value, and which level supplied it. */
  readonly effective: readonly ResolvedSettingDto[];
}

/** Core settings that exist regardless of which modules are installed. */
const CORE_FIELDS: Record<string, readonly SettingDto[]> = {
  general: [
    { moduleId: 'core', key: 'storeName', label: 'Store name', group: 'general', section: 'Store details', kind: 'text', scope: 'store' },
    { moduleId: 'core', key: 'contactEmail', label: 'Store contact email', group: 'general', section: 'Store details', kind: 'text', scope: 'store' },
    {
      moduleId: 'core', key: 'unitSystem', label: 'Unit system', group: 'general',
      section: 'Store defaults', kind: 'select', scope: 'store', defaultValue: 'metric',
      options: [
        { value: 'metric', label: 'Metric system' },
        { value: 'imperial', label: 'Imperial system' },
      ],
    },
    {
      moduleId: 'core', key: 'timeZone', label: 'Time zone', group: 'general',
      section: 'Store defaults', kind: 'select', scope: 'store', defaultValue: 'UTC',
      description: 'Sets the time for when orders and analytics are recorded.',
      options: [
        { value: 'UTC', label: '(GMT+00:00) UTC' },
        { value: 'America/New_York', label: '(GMT-05:00) Eastern Time' },
        { value: 'Asia/Kolkata', label: '(GMT+05:30) India Standard Time' },
      ],
    },
    { moduleId: 'core', key: 'orderIdPrefix', label: 'Order ID prefix', group: 'general', section: 'Order ID format', kind: 'text', scope: 'store', defaultValue: '#' },
    { moduleId: 'core', key: 'orderIdSuffix', label: 'Order ID suffix', group: 'general', section: 'Order ID format', kind: 'text', scope: 'store' },
  ],
  languages: [
    { moduleId: 'core', key: 'defaultLocale', label: 'Default language', group: 'languages', section: 'Languages', kind: 'select', scope: 'store', defaultValue: 'en-US', options: [{ value: 'en-US', label: 'English (US)' }, { value: 'fr-CA', label: 'French (Canada)' }, { value: 'hi', label: 'Hindi' }] },
  ],
};

export function StoreSettings({
  handle,
  storeName,
  organizationName,
  storeCount,
  section,
  contributed,
  effective,
}: StoreSettingsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string | boolean>>({});

  // Core fields first, then whatever modules contributed into the same group —
  // a module extends an existing group rather than adding a page of its own.
  const fields = [
    ...(CORE_FIELDS[section] ?? []),
    ...contributed.filter((setting) => setting.group === section),
  ];

  const bySection = new Map<string, SettingDto[]>();
  for (const field of fields) {
    const list = bySection.get(field.section) ?? [];
    list.push(field);
    bySection.set(field.section, list);
  }

  const resolved = new Map(effective.map((entry) => [entry.key, entry]));

  /**
   * Local edits win while typing; otherwise the resolved value, whatever level
   * supplied it. Falling back to the DECLARED default would show the module's
   * value while the platform had set another — the field would look wrong and
   * saving it would "change" nothing.
   */
  const valueOf = (field: SettingDto) => {
    if (values[field.key] !== undefined) return values[field.key]!;
    const entry = resolved.get(field.key);
    const value = entry ? entry.value : field.defaultValue;
    return (value ?? '') as string | boolean;
  };

  const set = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

  const commit = (field: SettingDto, value: string | boolean) =>
    startTransition(async () => {
      const result = await saveSetting(handle, field.key, value);
      setError(result.ok ? null : (result.error ?? 'Could not save this setting'));
      if (result.ok) {
        setValues((current) => {
          const next = { ...current };
          delete next[field.key];
          return next;
        });
        router.refresh();
      }
    });

  const reset = (field: SettingDto) =>
    startTransition(async () => {
      const result = await resetSetting(handle, field.key);
      setError(result.ok ? null : (result.error ?? 'Could not reset this setting'));
      if (result.ok) {
        setValues((current) => {
          const next = { ...current };
          delete next[field.key];
          return next;
        });
        router.refresh();
      }
    });

  return (
    <SettingsScreen
      activeSection={section}
      title={sectionTitle(section)}
      storeName={storeName}
      storeCount={storeCount}
      organizationName={organizationName}
      // Closing returns to the admin behind the overlay, not to a blank page.
      onClose={() => router.push(`/store/${handle}`)}
      onNavigate={(next) => router.push(`/store/${handle}/settings/${next}`)}
    >
      {error ? (
        <Banner tone="critical" title="Could not save">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      {bySection.size === 0 ? (
        <SettingsCard title={sectionTitle(section)}>
          <Text as="p" tone="subdued">
            No settings are contributed to this section yet. Modules declare a settings schema
            in their manifest and the platform generates the fields, storage and API from it.
          </Text>
        </SettingsCard>
      ) : (
        [...bySection.entries()].map(([group, groupFields]) => (
          <SettingsCard key={group} title={group}>
            <BlockStack gap="300">
              {groupFields.map((field) => (
                <SettingField
                  key={`${field.moduleId}.${field.key}`}
                  field={field}
                  value={valueOf(field)}
                  resolved={resolved.get(field.key)}
                  pending={pending}
                  onChange={(value) => set(field.key, value)}
                  onCommit={(value) => commit(field, value)}
                  onReset={() => reset(field)}
                />
              ))}
            </BlockStack>
          </SettingsCard>
        ))
      )}
    </SettingsScreen>
  );
}

/**
 * How a value's origin is described.
 *
 * Saying where a value came from is not decoration. Without it, a merchant
 * looking at an inherited value cannot tell it apart from one they chose, and
 * the first time somebody changes a platform default they get a support ticket
 * from every store that assumed the value was theirs.
 */
const SOURCE_NOTE: Record<SettingSource, string> = {
  store: 'Set for this store',
  platform: 'Inherited from the platform default',
  environment: 'Set by this deployment',
  default: 'The module default',
};

function SettingField({
  field,
  value,
  resolved,
  pending,
  onChange,
  onCommit,
  onReset,
}: {
  field: SettingDto;
  value: string | boolean;
  resolved: ResolvedSettingDto | undefined;
  pending: boolean;
  onChange(value: string | boolean): void;
  onCommit(value: string | boolean): void;
  onReset(): void;
}) {
  const contributedBy =
    field.moduleId === 'core' ? undefined : `Contributed by the ${field.moduleId} module`;
  const source = resolved?.source ?? 'default';

  // A field with no resolved entry is not backed by the settings chain at all —
  // one of the core placeholders that still has nowhere to store a value.
  // Labelling it "the module default" would be a lie that reads as working.
  const managed = resolved !== undefined;

  const origin = managed ? (
    <InlineStack gap="200" blockAlign="center">
      <Badge tone={source === 'store' ? 'success' : undefined}>{SOURCE_NOTE[source]}</Badge>
      {source === 'store' ? (
        <Button variant="plain" disabled={pending} onClick={onReset}>
          Reset to inherited
        </Button>
      ) : null}
    </InlineStack>
  ) : (
    <Text as="span" tone="subdued" variant="bodySm">
      Not stored yet — no module declares this setting.
    </Text>
  );

  const help = field.description ?? contributedBy;

  if (field.kind === 'boolean') {
    return (
      <BlockStack gap="150">
        <Checkbox
          label={field.label}
          helpText={help}
          checked={Boolean(value)}
          disabled={pending || !managed}
          // A checkbox has no blur, so the change IS the commit.
          onChange={(next) => {
            onChange(next);
            onCommit(next);
          }}
        />
        {origin}
      </BlockStack>
    );
  }

  if (field.kind === 'select' && field.options) {
    return (
      <BlockStack gap="150">
        <Select
          label={field.label}
          helpText={help}
          options={[...field.options]}
          value={String(value)}
          disabled={pending || !managed}
          onChange={(next) => {
            onChange(next);
            onCommit(next);
          }}
        />
        {origin}
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="150">
      <TextField
        label={field.label}
        helpText={help}
        autoComplete="off"
        type={field.kind === 'number' ? 'number' : 'text'}
        value={String(value)}
        disabled={pending || !managed}
        onChange={onChange}
        // Committed on blur rather than per keystroke: one write per edit, not
        // one per character.
        onBlur={() => managed && onCommit(value)}
      />
      {origin}
    </BlockStack>
  );
}

const TITLES: Record<string, string> = {
  general: 'General',
  plan: 'Plan',
  billing: 'Billing',
  payments: 'Payments',
  checkout: 'Checkout',
  customer_accounts: 'Customer accounts',
  shipping: 'Shipping and delivery',
  taxes: 'Taxes and duties',
  locations: 'Locations',
  markets: 'Markets',
  apps: 'Apps',
  sales_channels: 'Sales channels',
  domains: 'Domains',
  customer_events: 'Customer events',
  notifications: 'Notifications',
  custom_data: 'Metafields and metaobjects',
  languages: 'Languages',
  privacy: 'Customer privacy',
  policies: 'Policies',
  'organization-details': 'Organization',
  'organization-account': 'Users',
};

function sectionTitle(section: string): string {
  return TITLES[section] ?? section;
}
