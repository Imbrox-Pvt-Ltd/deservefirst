/**
 * Customers · contracts/index.ts
 * The only surface other modules may import. Orders needs to reference a
 * customer; it gets this shape and nothing else — no repository, no service, and
 * above all no direct access to the customer tables (§14.1).
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

/**
 * How another module sees a customer. Consent state is included because any
 * module that messages a shopper must be able to check it without asking.
 */
export interface CustomerSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly emailConsent: 'subscribed' | 'not-subscribed' | 'pending' | 'unknown';
  readonly locale: string;
}

export interface CustomerCreatedPayload {
  readonly customerId: string;
  readonly email: string | null;
}

export interface ConsentChangedPayload {
  readonly customerId: string;
  readonly channel: 'email' | 'sms';
  readonly from: string;
  readonly to: string;
}

export const customerResource: ResourceDefinition = {
  name: 'Customer',
  entity: 'Customer',
  pluralName: 'Customers',
  urlSegment: 'customers',
  aggregateRoot: 'Customer',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'firstName', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'lastName', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'email', type: 'string', indexed: true, filterable: true, sortable: true, searchable: true },
    { name: 'phone', type: 'string', filterable: true, searchable: true },
    { name: 'state', type: 'enum', values: ['disabled', 'invited', 'active', 'declined'], filterable: true, sortable: true },
    { name: 'emailConsent', type: 'enum', values: ['subscribed', 'not-subscribed', 'pending', 'unknown'], filterable: true },
    { name: 'smsConsent', type: 'enum', values: ['subscribed', 'not-subscribed', 'pending', 'unknown'], filterable: true },
    { name: 'locale', type: 'string', filterable: true },
    { name: 'taxExempt', type: 'boolean', filterable: true },
    { name: 'ordersCount', type: 'integer', filterable: true, sortable: true },
    { name: 'totalSpent', type: 'money', filterable: true, sortable: true },
    { name: 'defaultAddress', type: 'json' },
    // A private note about a shopper is staff-only and must never reach a
    // storefront or a public API.
    { name: 'note', type: 'text', visibility: 'private' },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'firstName', label: 'Customer name', defaultVisible: true, position: 0 },
    { field: 'emailConsent', label: 'Email subscription', defaultVisible: true, position: 1 },
    { field: 'ordersCount', label: 'Orders', defaultVisible: true, position: 2 },
    { field: 'totalSpent', label: 'Amount spent', defaultVisible: true, position: 3 },
    { field: 'state', label: 'Account status', defaultVisible: false, position: 4 },
  ],
  permissions: {
    read: 'customers.read',
    write: 'customers.manage',
    delete: 'customers.manage',
  },
};

export const segmentResource: ResourceDefinition = {
  name: 'Segment',
  entity: 'Segment',
  pluralName: 'Segments',
  urlSegment: 'segments',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'match', type: 'enum', values: ['all', 'any'] },
    { name: 'conditions', type: 'json' },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'customers.read', write: 'customers.manage' },
};
