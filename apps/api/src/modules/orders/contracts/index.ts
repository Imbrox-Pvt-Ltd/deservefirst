/**
 * Orders · contracts/index.ts
 * The only surface other modules may import.
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

export interface RequestSummary {
  readonly id: string;
  readonly reference: string;
  readonly customerId: string | null;
  readonly status: 'draft' | 'submitted' | 'quoted' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  readonly lineCount: number;
  readonly currency: string;
}

export interface RequestSubmittedPayload {
  readonly requestId: string;
  readonly reference: string;
  readonly customerId: string | null;
  readonly lineCount: number;
}

export interface RequestAcceptedPayload {
  readonly requestId: string;
  readonly reference: string;
  /** Phase 2 turns this into an order; until then it is a signal, not a sale. */
  readonly subtotalAmountMinor: string;
  readonly currency: string;
}

export const requestResource: ResourceDefinition = {
  name: 'Request',
  entity: 'Request',
  pluralName: 'Requests',
  urlSegment: 'requests',
  aggregateRoot: 'Request',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'reference', type: 'string', unique: true, indexed: true, filterable: true, sortable: true, searchable: true },
    { name: 'customerId', type: 'reference', references: 'Customer', indexed: true, filterable: true },
    { name: 'contactEmail', type: 'string', filterable: true, searchable: true },
    { name: 'contactName', type: 'string', searchable: true },
    {
      name: 'status',
      type: 'enum',
      values: ['draft', 'submitted', 'quoted', 'accepted', 'declined', 'expired', 'cancelled'],
      filterable: true,
      sortable: true,
      indexed: true,
    },
    { name: 'currency', type: 'string', filterable: true },
    { name: 'lineCount', type: 'integer', filterable: true, sortable: true },
    { name: 'subtotal', type: 'money', filterable: true, sortable: true },
    { name: 'note', type: 'text' },
    // Staff-only: what the merchant thinks about this request is not the
    // buyer's business.
    { name: 'internalNote', type: 'text', visibility: 'private' },
    { name: 'quoteExpiresAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'submittedAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'respondedAt', type: 'datetime', sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
    { name: 'updatedAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail', 'create'],
  columns: [
    { field: 'reference', label: 'Request', defaultVisible: true, position: 0 },
    { field: 'contactName', label: 'Customer', defaultVisible: true, position: 1 },
    { field: 'status', label: 'Status', defaultVisible: true, position: 2 },
    { field: 'lineCount', label: 'Items', defaultVisible: true, position: 3 },
    { field: 'subtotal', label: 'Subtotal', defaultVisible: true, position: 4 },
    { field: 'submittedAt', label: 'Submitted', defaultVisible: false, position: 5 },
  ],
  permissions: { read: 'orders.read', write: 'orders.manage', delete: 'orders.manage' },
};
