'use client';

/**
 * Web · components/PartnerTeam.tsx
 * Who works at the agency, and what their seat is worth.
 *
 * The role a person holds here decides what they can do in EVERY client store,
 * capped by what each merchant granted — so this list is the blast radius of a
 * mis-set role, not a directory. The screen says so, because the alternative is
 * finding out through a client.
 * Layer: web.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from '@deservefirst/ui';

import { inviteStaff, removeStaff } from '../app/actions/partners';
import type { PartnerStaffDto } from '../lib/types';

const ROLE_MEANS: Record<PartnerStaffDto['role'], string> = {
  owner: 'Everything, including who works here',
  admin: 'Client work, and asking merchants for access',
  member: 'Read-only in every client store',
};

export interface PartnerTeamProps {
  readonly partnerId: string;
  readonly staff: readonly PartnerStaffDto[];
}

export function PartnerTeam({ partnerId, staff }: PartnerTeamProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'The request failed');
        return;
      }
      setUserId('');
      router.refresh();
    });

  const listed = staff.filter((member) => member.status !== 'removed');

  return (
    <Page title="Team">
    <BlockStack gap="400">
      {error ? (
        <Banner tone="critical" title="Could not complete that">
          <Text as="p">{error}</Text>
        </Banner>
      ) : null}

      <Card>
        <IndexTable
          resourceName={{ singular: 'person', plural: 'people' }}
          itemCount={listed.length}
          selectable={false}
          headings={[{ title: 'Person' }, { title: 'Role' }, { title: 'Can reach' }, { title: '' }]}
        >
          {listed.map((member, index) => (
            <IndexTable.Row id={member.id} key={member.id} position={index}>
              <IndexTable.Cell>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="medium">
                    {member.userId}
                  </Text>
                  {member.status === 'invited' ? <Badge tone="attention">Invited</Badge> : null}
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span">{member.role}</Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" tone="subdued">
                  {ROLE_MEANS[member.role]}
                </Text>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {member.role === 'owner' ? (
                  // Not a missing button: the owner is transferred, never
                  // removed, and saying so beats a button that always fails.
                  <Text as="span" tone="subdued" variant="bodySm">
                    Transfer ownership to change
                  </Text>
                ) : (
                  <Button
                    variant="plain"
                    tone="critical"
                    disabled={pending}
                    onClick={() => run(() => removeStaff(partnerId, member.id))}
                  >
                    Remove
                  </Button>
                )}
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Add someone
          </Text>
          <Text as="p" tone="subdued">
            Their role here applies in every client store, up to whatever each merchant granted the
            agency — never beyond it.
          </Text>
          <TextField
            label="User ID"
            value={userId}
            onChange={setUserId}
            autoComplete="off"
            helpText="They need an account already."
          />
          <Select
            label="Role"
            value={role}
            onChange={(value) => setRole(value as 'admin' | 'member')}
            options={[
              { value: 'member', label: `Member — ${ROLE_MEANS.member.toLowerCase()}` },
              { value: 'admin', label: `Admin — ${ROLE_MEANS.admin.toLowerCase()}` },
            ]}
          />
          <InlineStack>
            <Button
              variant="primary"
              disabled={pending || !userId.trim()}
              onClick={() => run(() => inviteStaff(partnerId, { userId: userId.trim(), role }))}
            >
              Add
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </BlockStack>
    </Page>
  );
}
