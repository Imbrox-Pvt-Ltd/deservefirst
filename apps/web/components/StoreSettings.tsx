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
import { useState } from 'react';


import type { SettingDto } from '../lib/types';
import {
  BlockStack,
  Checkbox,
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
}: StoreSettingsProps) {
  const router = useRouter();
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

  const valueOf = (field: SettingDto) =>
    values[field.key] ?? (field.defaultValue as string | boolean | undefined) ?? '';

  const set = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));

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
                  onChange={(value) => set(field.key, value)}
                />
              ))}
            </BlockStack>
          </SettingsCard>
        ))
      )}
    </SettingsScreen>
  );
}

function SettingField({
  field,
  value,
  onChange,
}: {
  field: SettingDto;
  value: string | boolean;
  onChange(value: string | boolean): void;
}) {
  const contributedBy =
    field.moduleId === 'core' ? undefined : `Contributed by the ${field.moduleId} module`;

  if (field.kind === 'boolean') {
    return (
      <Checkbox
        label={field.label}
        helpText={field.description ?? contributedBy}
        checked={Boolean(value)}
        onChange={onChange}
      />
    );
  }

  if (field.kind === 'select' && field.options) {
    return (
      <Select
        label={field.label}
        helpText={field.description ?? contributedBy}
        options={[...field.options]}
        value={String(value)}
        onChange={onChange}
      />
    );
  }

  return (
    <TextField
      label={field.label}
      helpText={field.description ?? contributedBy}
      autoComplete="off"
      type={field.kind === 'number' ? 'number' : 'text'}
      value={String(value)}
      onChange={onChange}
    />
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
