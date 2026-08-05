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

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle, id } = await params;
  const search = await searchParams;

  try {
    const response = await apiFetch<RequestDto>(`/orders/requests/${id}/detail`);
    /**
     * The demo extension, so the sandbox can be seen working.
     *
     * `?extension=hostile` loads one that misbehaves on purpose — a component
     * outside the vocabulary, a prop carrying markup, and an attempt to reach
     * `document`. It is here rather than in a test because the interesting
     * claim is what a merchant SEES when an extension turns hostile.
     */
    const which = typeof search.extension === 'string' ? search.extension : 'demo';
    const extensionUrl = which === 'none' ? null : `/extensions/${which === 'hostile' ? 'hostile' : 'demo'}.js`;

    return (
      <RequestDetail handle={handle} request={response.data} extensionUrl={extensionUrl} />
    );
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
