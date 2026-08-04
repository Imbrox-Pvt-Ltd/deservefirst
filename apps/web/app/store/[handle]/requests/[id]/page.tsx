/**
 * Web · app/store/[handle]/requests/[id]/page.tsx
 * The quoting screen. Fetches the request with its lines — the generic reader
 * deliberately does not load lines for the list, so the detail uses the module's
 * own endpoint.
 * Layer: web.
 */

import { ErrorState } from '../../../../../components/ErrorState';
import { RequestDetail } from '../../../../../components/RequestDetail';
import { apiFetch, isNotFound } from '../../../../../lib/api';
import type { RequestDto } from '../../../../../lib/types';

const STORE_IDS: Record<string, string> = {
  'acme-us': 'seed-store-us',
  'acme-in': 'seed-store-in',
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const storeId = STORE_IDS[handle] ?? 'seed-store-us';

  try {
    const response = await apiFetch<RequestDto>(`/orders/requests/${id}/detail`, {
      storeId,
      permissions: ['orders.read', 'orders.manage', 'orders.quote'],
    });
    return <RequestDetail handle={handle} request={response.data} />;
  } catch (error) {
    const notFound = isNotFound(error);
    return (
      <ErrorState
        pageTitle="Request"
        backUrl={`/store/${handle}/requests`}
        tone={notFound ? 'warning' : 'critical'}
        title={notFound ? 'Request not found' : 'Could not load request'}
        message={
          notFound
            ? 'This request does not exist in this store.'
            : error instanceof Error
              ? error.message
              : 'Unknown error'
        }
      />
    );
  }
}
