/**
 * Orders · api/orders.controller.ts
 * The quoting workflow's HTTP surface.
 *
 * Each transition is its own endpoint rather than a generic "set status",
 * because the transitions carry rules — a quote cannot be sent half-priced, and
 * an expired one cannot be accepted.
 * Layer: api.
 */

import { moneyFromDecimalString, toDecimalString } from '@deservefirst/contracts';

import { controller, type ModuleController, type RouteRequest } from '../../../core/http/controller';
import type { RequestService } from '../application';
import { RequestInvariantError, subtotal, type Request as QuoteRequest } from '../domain';

export interface OrdersServices {
  requestServiceFor(storeId: string): RequestService;
}

/** The wire shape, including lines, which the generic reader does not load. */
const toRequestDto = (record: QuoteRequest) => ({
  id: record.id,
  reference: record.reference,
  customerId: record.customerId,
  contactEmail: record.contactEmail,
  contactName: record.contactName,
  status: record.status,
  currency: record.currency,
  note: record.note,
  quoteExpiresAt: record.quoteExpiresAt,
  submittedAt: record.submittedAt,
  version: record.version,
  subtotal: { amount: toDecimalString(subtotal(record)), currency: record.currency },
  lines: record.lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    title: line.title,
    sku: line.sku,
    quantity: line.quantity,
    listPrice: { amount: toDecimalString(line.listPrice), currency: line.listPrice.currency },
    quotedPrice: line.quotedPrice
      ? { amount: toDecimalString(line.quotedPrice), currency: line.quotedPrice.currency }
      : null,
    note: line.note,
  })),
});

const expectedVersion = (request: RouteRequest): number => Number(request.body.version ?? -1);

const TRANSITIONS = [
  ['submit', 'orders.manage'],
  ['quote', 'orders.quote'],
  ['accept', 'orders.manage'],
  ['decline', 'orders.manage'],
  ['cancel', 'orders.manage'],
] as const;

export function ordersController(services: OrdersServices): ModuleController {
  const requests = (request: RouteRequest) => services.requestServiceFor(request.storeId);

  return controller('orders', [
    {
      method: 'POST',
      path: '/requests',
      permission: 'orders.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toRequestDto(
          await requests(request).create({
            customerId: (body.customerId ?? null) as string | null,
            contactEmail: (body.contactEmail ?? null) as string | null,
            contactName: (body.contactName ?? null) as string | null,
            currency: String(body.currency ?? 'USD'),
            note: (body.note ?? null) as string | null,
          }),
        );
      },
    },
    {
      method: 'GET',
      path: '/requests/:id/detail',
      permission: 'orders.read',
      handle: async (request) => toRequestDto(await requests(request).get(request.params.id!)),
    },
    {
      method: 'POST',
      path: '/requests/:id/lines',
      permission: 'orders.manage',
      handle: async (request) => {
        const { body } = request;
        return toRequestDto(
          await requests(request).addLine(
            request.params.id!,
            {
              productId: String(body.productId ?? ''),
              title: String(body.title ?? ''),
              sku: body.sku === undefined ? null : String(body.sku),
              quantity: Number(body.quantity ?? 1),
              listPrice: parseMoney(body.listPrice),
            },
            expectedVersion(request),
          ),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/requests/:id/lines/:lineId',
      permission: 'orders.manage',
      handle: async (request) =>
        toRequestDto(
          await requests(request).removeLine(
            request.params.id!,
            request.params.lineId!,
            expectedVersion(request),
          ),
        ),
    },
    {
      method: 'POST',
      path: '/requests/:id/lines/:lineId/quote',
      permission: 'orders.quote',
      handle: async (request) =>
        toRequestDto(
          await requests(request).quoteLine(
            request.params.id!,
            request.params.lineId!,
            parseMoney(request.body.price),
            expectedVersion(request),
          ),
        ),
    },

    ...TRANSITIONS.map(([action, permission]) => ({
      method: 'POST' as const,
      path: `/requests/:id/${action}`,
      permission,
      handle: async (request: RouteRequest) => {
        const service = requests(request);
        const id = request.params.id!;
        const version = expectedVersion(request);

        const updated =
          action === 'submit'
            ? await service.submit(id, version)
            : action === 'quote'
              ? await service.sendQuote(id, version)
              : action === 'accept'
                ? await service.accept(id, version)
                : action === 'decline'
                  ? await service.decline(id, String(request.body.reason ?? 'no reason given'), version)
                  : await service.cancel(id, version);

        return toRequestDto(updated);
      },
    })),
  ]);
}

function parseMoney(value: unknown) {
  const candidate = value as { amount?: unknown; currency?: unknown } | undefined;
  if (!candidate || typeof candidate.amount !== 'string' || typeof candidate.currency !== 'string') {
    throw new RequestInvariantError('price', 'must be { amount: "19.99", currency: "USD" }');
  }
  return moneyFromDecimalString(candidate.amount, candidate.currency);
}
