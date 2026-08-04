'use client';

/**
 * Web · components/RequestDetail.tsx
 * The quoting screen. Each line is priced individually, then the quote is sent
 * as a whole — which is the merchant's actual workflow, not an artefact of the
 * API shape.
 *
 * The available actions come from the request's status rather than being always
 * visible and sometimes failing. A button that is going to be refused should not
 * be offered.
 * Layer: web.
 */

import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
  TextField,
} from '@deservefirst/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { DetailScreen, type DetailSection } from '@deservefirst/ui';

import {
  acceptRequest,
  declineRequest,
  quoteLine,
  removeLine,
  sendQuote,
  submitRequest,
} from '../app/actions/requests';
import { formatMoney, type RequestDto, type RequestLineDto } from '../lib/types';

const STATUS_TONE: Record<RequestDto['status'], 'success' | 'info' | 'attention' | 'critical' | undefined> = {
  draft: 'info',
  submitted: 'attention',
  quoted: 'info',
  accepted: 'success',
  declined: 'critical',
  expired: undefined,
  cancelled: undefined,
};

export function RequestDetail({ handle, request }: { handle: string; request: RequestDto }) {
  const router = useRouter();
  const [current, setCurrent] = useState(request);
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ tone: 'critical' | 'warning' | 'success'; message: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const run = (action: () => Promise<{ ok: boolean; data?: RequestDto; error?: string; conflict?: boolean }>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok && result.data) {
        setCurrent(result.data);
        setDrafts({});
        if (success) setBanner({ tone: 'success', message: success });
        return;
      }
      setBanner({
        tone: result.conflict ? 'warning' : 'critical',
        // A refusal here is usually a rule, not a fault — the service explains why.
        message: result.conflict
          ? `${result.error} Reload to see the current version.`
          : (result.error ?? 'That did not work.'),
      });
    });

  const fullyQuoted = current.lines.length > 0 && current.lines.every((line) => line.quotedPrice);
  const editable = !['accepted', 'declined', 'expired', 'cancelled'].includes(current.status);

  const sections: DetailSection[] = [
    {
      id: 'lines',
      title: `Items (${current.lines.length})`,
      content: (
        <BlockStack gap="300">
          {current.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              currency={current.currency}
              editable={editable}
              busy={pending}
              draft={drafts[line.id] ?? line.quotedPrice?.amount ?? ''}
              onDraftChange={(value) => setDrafts((all) => ({ ...all, [line.id]: value }))}
              onQuote={(amount) =>
                run(() => quoteLine(handle, current.id, line.id, amount, current.currency, current.version))
              }
              onRemove={() => run(() => removeLine(handle, current.id, line.id, current.version))}
            />
          ))}

          {current.lines.length === 0 && (
            <Text as="p" tone="subdued">No items on this request yet.</Text>
          )}

          <InlineStack align="end" gap="200" blockAlign="center">
            <Text as="span" tone="subdued">Subtotal</Text>
            <Text as="span" variant="headingLg">{formatMoney(current.subtotal)}</Text>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">
            Excludes tax and delivery — this platform does not price either yet.
          </Text>
        </BlockStack>
      ),
    },
  ];

  if (current.note) {
    sections.push({
      id: 'note',
      title: 'Buyer note',
      content: <Text as="p">{current.note}</Text>,
    });
  }

  sections.push({
    id: 'buyer',
    title: 'Buyer',
    placement: 'aside',
    content: (
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">{current.contactName ?? 'No name'}</Text>
        <Text as="p" tone="subdued" variant="bodySm">{current.contactEmail ?? 'No email'}</Text>
        {current.submittedAt && (
          <Text as="p" tone="subdued" variant="bodySm">
            Submitted {String(current.submittedAt).slice(0, 10)}
          </Text>
        )}
      </BlockStack>
    ),
  });

  sections.push({
    id: 'status',
    title: 'Status',
    placement: 'aside',
    content: (
      <BlockStack gap="300">
        <InlineStack gap="200">
          <Badge tone={STATUS_TONE[current.status]}>{current.status}</Badge>
        </InlineStack>

        {current.quoteExpiresAt && current.status === 'quoted' && (
          <Text as="p" tone="subdued" variant="bodySm">
            Quote valid until {String(current.quoteExpiresAt).slice(0, 10)}. After that the buyer
            must ask for a new one.
          </Text>
        )}

        {/* Offered only when the transition would actually be allowed. */}
        {current.status === 'draft' && (
          <Button loading={pending} onClick={() => run(() => submitRequest(handle, current.id, current.version), 'Submitted.')}>
            Submit
          </Button>
        )}

        {current.status === 'submitted' && (
          <BlockStack gap="200">
            <Button
              variant="primary"
              disabled={!fullyQuoted || pending}
              loading={pending}
              onClick={() => run(() => sendQuote(handle, current.id, current.version), 'Quote sent.')}
            >
              Send quote
            </Button>
            {!fullyQuoted && (
              <Text as="p" tone="subdued" variant="bodySm">
                Price every line first.
              </Text>
            )}
          </BlockStack>
        )}

        {current.status === 'quoted' && (
          <BlockStack gap="200">
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => acceptRequest(handle, current.id, current.version), 'Accepted.')}
            >
              Record acceptance
            </Button>
            <Button
              tone="critical"
              loading={pending}
              onClick={() => run(() => declineRequest(handle, current.id, 'declined by merchant', current.version))}
            >
              Decline
            </Button>
          </BlockStack>
        )}

        {current.status === 'accepted' && (
          <Text as="p" tone="subdued" variant="bodySm">
            Accepted. Turning this into an order needs checkout and payment, which
            are a later phase.
          </Text>
        )}
      </BlockStack>
    ),
  });

  return (
    <DetailScreen
      title={current.reference}
      subtitle={`${current.currency} · version ${current.version}`}
      backAction={{ onAction: () => router.push(`/store/${handle}/requests`) }}
      sections={sections}
      dirty={false}
      saving={pending}
      onSave={() => {}}
      onDiscard={() => {}}
      slotContent={{
        header: banner ? (
          <Banner tone={banner.tone} onDismiss={() => setBanner(null)}>
            <p>{banner.message}</p>
          </Banner>
        ) : null,
      }}
    />
  );
}

function LineRow({
  line,
  currency,
  editable,
  busy,
  draft,
  onDraftChange,
  onQuote,
  onRemove,
}: {
  line: RequestLineDto;
  currency: string;
  editable: boolean;
  busy: boolean;
  draft: string;
  onDraftChange(value: string): void;
  onQuote(amount: string): void;
  onRemove(): void;
}) {
  const discounted =
    line.quotedPrice && Number(line.quotedPrice.amount) < Number(line.listPrice.amount);

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="050">
            <Text as="p" variant="bodyMd" fontWeight="semibold">{line.title}</Text>
            <Text as="p" tone="subdued" variant="bodySm">
              {line.quantity} × {formatMoney(line.listPrice)} list
              {line.sku ? ` · ${line.sku}` : ''}
            </Text>
          </BlockStack>
          {discounted && <Badge tone="success">Discounted</Badge>}
        </InlineStack>

        {editable && (
          <InlineStack gap="200" blockAlign="end">
            <TextField
              label={`Your price per unit (${currency})`}
              autoComplete="off"
              value={draft}
              onChange={onDraftChange}
            />
            <Button disabled={busy || draft.trim() === ''} onClick={() => onQuote(draft.trim())}>
              {line.quotedPrice ? 'Update' : 'Set price'}
            </Button>
            <Button tone="critical" variant="plain" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          </InlineStack>
        )}

        {line.quotedPrice && (
          <Text as="p" variant="bodySm">
            Quoted {formatMoney(line.quotedPrice)} each ·{' '}
            <Text as="span" fontWeight="semibold">
              {formatMoney({
                // Line total from the exact decimal string, formatted for display
                // only — the server holds the authoritative minor units.
                amount: (Number(line.quotedPrice.amount) * line.quantity).toFixed(2),
                currency,
              })}
            </Text>
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
