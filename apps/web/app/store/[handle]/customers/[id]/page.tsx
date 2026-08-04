/**
 * Web · app/store/[handle]/customers/[id]/page.tsx
 * Customer detail. Uses the module's own endpoint so the display name and
 * consent state arrive already resolved.
 * Layer: web.
 */

import { CustomerDetail } from '../../../../../components/CustomerDetail';
import { ErrorState } from '../../../../../components/ErrorState';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { CustomerDto } from '../../../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  try {
    const response = await apiFetch<CustomerDto>(`/customers/customers/${id}/detail`, {
      storeId,
      permissions: ['customers.read', 'customers.manage'],
    });
    return <CustomerDetail handle={handle} customer={response.data} />;
  } catch (error) {
    const notFound = isNotFound(error);
    return (
      <ErrorState
        pageTitle="Customer"
        backUrl={`/store/${handle}/customers`}
        tone={notFound ? 'warning' : 'critical'}
        title={notFound ? 'Customer not found' : 'Could not load customer'}
        message={
          notFound
            ? 'This customer does not exist in this store.'
            : error instanceof Error
              ? error.message
              : 'Unknown error'
        }
      />
    );
  }
}
