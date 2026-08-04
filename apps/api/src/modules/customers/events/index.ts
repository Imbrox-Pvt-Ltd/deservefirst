/**
 * Customers · events/index.ts
 * The typed, versioned events this module emits. Other modules consume these
 * through contracts/ and never reach into the customer tables (§14.4).
 * Layer: events.
 */

export const CUSTOMER_EVENTS = {
  created: 'customers.customer.created',
  updated: 'customers.customer.updated',
  consentChanged: 'customers.customer.consent-changed',
  segmentCreated: 'customers.segment.created',
} as const;

export type CustomerEventType = (typeof CUSTOMER_EVENTS)[keyof typeof CUSTOMER_EVENTS];
