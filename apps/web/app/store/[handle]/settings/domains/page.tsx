/**
 * Web · app/store/[handle]/settings/domains/page.tsx
 * The domains a store answers on.
 *
 * Its own route rather than a section of the generic settings screen, because
 * this is not a form of values — it is a list of things each with their own
 * state, their own DNS records and their own actions. Fitting that into a
 * settings schema would mean inventing a field type for "domain with a
 * verification workflow", which is a screen wearing a schema as a disguise.
 * Layer: web.
 */

import { branding } from '@deservefirst/config';

import { DomainSettings, type DomainDto } from '../../../../../components/DomainSettings';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch } from '../../../../../lib/api';

export default async function DomainsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  try {
    const response = await apiFetch<{ domains: DomainDto[] }>('/storefront/domains');

    return (
      <DomainSettings
        handle={handle}
        domains={response.data.domains}
        /**
         * Derived rather than fetched: the storefront subdomain IS the handle
         * plus the platform suffix, and asking the API for a value we can
         * compute would be a request whose answer we already hold.
         */
        platformHost={`${handle}.${branding.domains.storefront}`}
      />
    );
  } catch (error) {
    return (
      <ErrorState
        pageTitle="Domains"
        title="Could not load domains"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
