'use client';

/**
 * Web · components/CompanyDetail.tsx
 * A company: who it is, where it buys from and on what terms, and which people
 * may act for it.
 *
 * Contacts show the person's name and link to their own customer record, because
 * that is what a contact IS — a relationship, not a copy. Removing one here ends
 * the relationship and leaves the person exactly as they were.
 * Layer: web.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

import { saveCompanyContacts, saveCompanyLocations, setCompanyStatus } from '../app/actions/companies';
import type { CompanyContactDto, CompanyDto, CompanyLocationDto, CustomerDto } from '../lib/types';

const TERMS = [
  { label: 'Due on receipt', value: 'due-on-receipt' },
  { label: 'Net 15', value: 'net-15' },
  { label: 'Net 30', value: 'net-30' },
  { label: 'Net 60', value: 'net-60' },
  { label: 'Prepaid', value: 'prepaid' },
];

const ROLES = [
  { label: 'Can order', value: 'ordering' },
  { label: 'Can view only', value: 'viewing' },
  { label: 'Administrator', value: 'admin' },
];

const STATUS_TONE = { active: 'success', 'on-hold': 'attention', closed: undefined } as const;

export interface CompanyDetailProps {
  readonly handle: string;
  readonly company: CompanyDto;
  /** Everyone who could be made a contact. */
  readonly customers: readonly CustomerDto[];
}

export function CompanyDetail({ handle, company, customers }: CompanyDetailProps) {
  const router = useRouter();
  const [locations, setLocations] = useState<CompanyLocationDto[]>([...company.locations]);
  const [contacts, setContacts] = useState<CompanyContactDto[]>([...company.contacts]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (customerId: string) =>
    customers.find((customer) => customer.id === customerId)?.displayName ?? customerId;

  const report = (result: { ok: boolean; error?: string }) => {
    if (result.ok) {
      setError(null);
      router.refresh();
    } else {
      setError(result.error ?? 'Could not save');
    }
  };

  const run = (work: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => report(await work()));

  const locationsDirty = JSON.stringify(locations) !== JSON.stringify(company.locations);
  const contactsDirty = JSON.stringify(contacts) !== JSON.stringify(company.contacts);

  return (
    <Page
      title={company.name}
      titleMetadata={<Badge tone={STATUS_TONE[company.status]}>{company.status}</Badge>}
      subtitle={company.externalId ? `Their reference: ${company.externalId}` : undefined}
      backAction={{ content: 'Companies', onAction: () => router.push(`/store/${handle}/companies`) }}
      secondaryActions={
        company.status === 'closed'
          ? []
          : [
              {
                content: company.status === 'active' ? 'Put on hold' : 'Resume trading',
                onAction: () =>
                  run(() =>
                    setCompanyStatus(
                      handle,
                      company.id,
                      company.version,
                      company.status === 'active' ? 'on-hold' : 'active',
                    ),
                  ),
              },
              {
                content: 'Close account',
                destructive: true,
                onAction: () => run(() => setCompanyStatus(handle, company.id, company.version, 'closed')),
              },
            ]
      }
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not save">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {company.status === 'on-hold' ? (
          <Banner tone="warning" title="On hold">
            <Text as="p">
              Nobody at this company can place an order while it is on hold. The relationship and
              its terms are kept — resuming picks up exactly where it left off.
            </Text>
          </Banner>
        ) : null}

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="h2" variant="headingSm">Locations</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Terms belong to a location, not the company — sites of the same group genuinely
                  differ.
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                {locationsDirty ? (
                  <Button
                    size="slim"
                    variant="primary"
                    loading={pending}
                    onClick={() => run(() => saveCompanyLocations(handle, company.id, company.version, locations))}
                  >
                    Save locations
                  </Button>
                ) : null}
                <Button
                  size="slim"
                  disabled={pending}
                  onClick={() =>
                    setLocations((current) => [
                      ...current,
                      {
                        id: `new-${current.length + 1}`,
                        name: '',
                        addressLine1: null,
                        city: null,
                        countryCode: 'US',
                        paymentTerms: 'due-on-receipt',
                        creditLimitMinor: null,
                        isDefault: current.length === 0,
                      },
                    ])
                  }
                >
                  Add location
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>

          {locations.map((location, index) => (
            <Box key={location.id} padding="400" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="end" wrap={false}>
                  <Box minWidth="220px">
                    <TextField
                      label="Name"
                      value={location.name}
                      autoComplete="off"
                      disabled={pending}
                      onChange={(value) =>
                        setLocations((c) => c.map((l, at) => (at === index ? { ...l, name: value } : l)))
                      }
                    />
                  </Box>
                  <Box minWidth="110px">
                    <TextField
                      label="Country"
                      value={location.countryCode}
                      autoComplete="off"
                      maxLength={2}
                      disabled={pending}
                      onChange={(value) =>
                        setLocations((c) =>
                          c.map((l, at) => (at === index ? { ...l, countryCode: value.toUpperCase() } : l)),
                        )
                      }
                    />
                  </Box>
                  <Box minWidth="180px">
                    <Select
                      label="Payment terms"
                      options={TERMS}
                      value={location.paymentTerms}
                      disabled={pending}
                      onChange={(value) =>
                        setLocations((c) =>
                          c.map((l, at) => (at === index ? { ...l, paymentTerms: value as never } : l)),
                        )
                      }
                    />
                  </Box>
                </InlineStack>

                <InlineStack gap="300" blockAlign="center">
                  <Button
                    size="slim"
                    disabled={pending || location.isDefault}
                    onClick={() =>
                      // Exactly one default, always: setting one clears the rest
                      // rather than leaving the aggregate to refuse the save.
                      setLocations((c) => c.map((l, at) => ({ ...l, isDefault: at === index })))
                    }
                  >
                    {location.isDefault ? 'Default location' : 'Make default'}
                  </Button>
                  <Button
                    variant="plain"
                    tone="critical"
                    disabled={pending || locations.length === 1}
                    onClick={() => setLocations((c) => c.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </Card>

        <Card padding="0">
          <Box padding="400" borderBlockEndWidth="025" borderColor="border">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Contacts</Text>
              <InlineStack gap="200">
                {contactsDirty ? (
                  <Button
                    size="slim"
                    variant="primary"
                    loading={pending}
                    onClick={() => run(() => saveCompanyContacts(handle, company.id, company.version, contacts))}
                  >
                    Save contacts
                  </Button>
                ) : null}
                <Button
                  size="slim"
                  disabled={pending || customers.length === 0}
                  onClick={() => {
                    const taken = new Set(contacts.map((contact) => contact.customerId));
                    const next = customers.find((customer) => !taken.has(customer.id));
                    if (!next) return;
                    setContacts((current) => [
                      ...current,
                      {
                        id: `new-${current.length + 1}`,
                        customerId: next.id,
                        role: 'viewing',
                        locationIds: [],
                        isPrimary: current.length === 0,
                      },
                    ]);
                  }}
                >
                  Add contact
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>

          {contacts.length === 0 ? (
            <Box padding="500">
              <Text as="p" tone="subdued">Nobody can act for this company yet.</Text>
            </Box>
          ) : (
            contacts.map((contact, index) => (
              <Box key={contact.id} padding="400" borderBlockEndWidth="025" borderColor="border">
                <InlineStack gap="300" blockAlign="end" wrap={false}>
                  <Box minWidth="240px">
                    <Select
                      label="Person"
                      options={customers.map((customer) => ({
                        label: customer.displayName,
                        value: customer.id,
                      }))}
                      value={contact.customerId}
                      disabled={pending}
                      onChange={(value) =>
                        setContacts((c) =>
                          c.map((x, at) => (at === index ? { ...x, customerId: value } : x)),
                        )
                      }
                    />
                  </Box>
                  <Box minWidth="180px">
                    <Select
                      label="Role"
                      options={ROLES}
                      value={contact.role}
                      disabled={pending}
                      onChange={(value) =>
                        setContacts((c) => c.map((x, at) => (at === index ? { ...x, role: value as never } : x)))
                      }
                    />
                  </Box>
                  <Button
                    variant="plain"
                    disabled={pending}
                    onClick={() =>
                      router.push(`/store/${handle}/customers/${contact.customerId}`)
                    }
                  >
                    Open {nameOf(contact.customerId)}
                  </Button>
                  <Button
                    variant="plain"
                    tone="critical"
                    disabled={pending}
                    onClick={() => setContacts((c) => c.filter((_, at) => at !== index))}
                  >
                    Remove
                  </Button>
                </InlineStack>
              </Box>
            ))
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
