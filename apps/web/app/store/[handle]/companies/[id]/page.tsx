/**
 * Web · app/store/[handle]/companies/[id]/page.tsx
 * One company: locations, terms and the people who may act for it.
 * Layer: web.
 */

import { notFound } from 'next/navigation';

import { CompanyDetail } from '../../../../../components/CompanyDetail';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { CompanyDto, CustomerDto } from '../../../../../lib/types';

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;

  try {
    const [company, customers] = await Promise.all([
      apiFetch<CompanyDto>(`/customers/companies/${id}/detail`),
      // The people who could be made contacts. Capped, and the cap is visible in
      // the select rather than pretended away — a very large customer base wants
      // a search here, not a longer list.
      apiFetch<CustomerDto[]>('/customers/customers?limit=250'),
    ]);

    return (
      <CompanyDetail handle={handle} company={company.data} customers={customers.data} />
    );
  } catch (error) {
    if (isNotFound(error)) notFound();
    return (
      <ErrorState
        pageTitle="Company"
        title="Could not load this company"
        message={error instanceof Error ? error.message : 'Unknown error'}
        hint="Is the API running? pnpm --filter @deservefirst/api start"
      />
    );
  }
}
