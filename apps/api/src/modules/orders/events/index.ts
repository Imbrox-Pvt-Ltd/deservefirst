/**
 * Orders · events/index.ts
 * Events this module emits. Note what is absent: nothing about payment or
 * fulfilment, because this phase has neither (ADR 0001 D10).
 * Layer: events.
 */

export const ORDER_EVENTS = {
  requestSubmitted: 'orders.request.submitted',
  requestQuoted: 'orders.request.quoted',
  requestAccepted: 'orders.request.accepted',
  requestDeclined: 'orders.request.declined',
} as const;

export type OrderEventType = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];
