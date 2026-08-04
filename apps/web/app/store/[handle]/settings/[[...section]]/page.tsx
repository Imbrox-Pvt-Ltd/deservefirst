/**
 * Web · app/store/[handle]/settings/[[...section]]/page.tsx
 * The settings overlay, deep-linkable per section (§8.5). An optional catch-all
 * so `/settings` and `/settings/general` both resolve, and every one of the 19
 * sections has its own shareable URL.
 * Layer: web.
 */

import { redirect } from 'next/navigation';

import { apiFetch } from '../../../../../lib/api';
import { currentSession } from '../../../../../lib/stores';
import { StoreSettings } from '../../../../../components/StoreSettings';
import type {
  ResolvedSettingDto,
  SettingDto,
  WebhookDeliveryDto,
  PartnerAccessDto,
  WebhookEventDto,
  WebhookSubscriptionDto,
} from '../../../../../lib/types';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ handle: string; section?: string[] }>;
}) {
  const { handle, section } = await params;
  const active = section?.[0] ?? 'general';

  const session = await currentSession();
  if (!session) redirect('/login');

  const store = session.stores.find((entry) => entry.handle === handle);
  // A handle this operator has no membership for is a 404 to them, not a
  // silent fallback to whichever store happens to be first.
  if (!store) redirect('/');

  let contributed: SettingDto[] = [];
  let effective: ResolvedSettingDto[] = [];
  try {
    // Two reads with different jobs: the registry says what a setting IS —
    // label, kind, options — and the resolver says what its value is here and
    // which level supplied it. Neither can answer the other's question.
    const [declared, resolved] = await Promise.all([
      apiFetch<SettingDto[]>('/platform/settings'),
      apiFetch<ResolvedSettingDto[]>('/platform/effective-settings'),
    ]);
    contributed = declared.data;
    effective = resolved.data;
  } catch {
    // The settings screen must still open when the API is down; an empty form
    // is better than a stack trace where the settings should be.
    contributed = [];
    effective = [];
  }

  // Fetched only for the section that shows them. Every section paying for the
  // delivery log is three wasted round trips on the eighteen that never use it.
  let subscriptions: WebhookSubscriptionDto[] = [];
  let deliveries: WebhookDeliveryDto[] = [];
  let eventTypes: string[] = [];
  if (active === 'notifications') {
    try {
      const [subs, dels, events] = await Promise.all([
        apiFetch<WebhookSubscriptionDto[]>('/platform/webhooks'),
        apiFetch<WebhookDeliveryDto[]>('/platform/webhook-deliveries'),
        apiFetch<WebhookEventDto[]>('/platform/webhook-events'),
      ]);
      subscriptions = subs.data;
      deliveries = dels.data;
      eventTypes = events.data.map((event) => event.type);
    } catch {
      subscriptions = [];
      deliveries = [];
      eventTypes = [];
    }
  }

  // Same reasoning as the webhook reads: fetched only for the section that
  // shows them, so eighteen other sections do not pay for it.
  let partnerAccess: PartnerAccessDto[] = [];
  let grantable: { key: string; label: string }[] = [];
  if (active === 'organization-account') {
    // Read separately rather than together: one Promise.all around both means
    // a failure fetching the checkbox list also erases the list of partners
    // holding keys to the store, which is the more important of the two.
    try {
      partnerAccess = (await apiFetch<PartnerAccessDto[]>('/auth/partner-access')).data;
    } catch {
      partnerAccess = [];
    }
    try {
      grantable = (await apiFetch<{ key: string; label: string }[]>('/auth/grantable-permissions')).data;
    } catch {
      grantable = [];
    }
  }

  return (
    <StoreSettings
      handle={handle}
      storeName={store.name}
      organizationName="Acme Group"
      storeCount={session.stores.length}
      section={active}
      contributed={contributed}
      effective={effective}
      subscriptions={subscriptions}
      deliveries={deliveries}
      eventTypes={eventTypes}
      canManage={session.permissions.includes('store.webhooks.manage')}
      partnerAccess={partnerAccess}
      grantable={grantable}
      canManagePartners={session.permissions.includes('store.partners.manage')}
    />
  );
}
