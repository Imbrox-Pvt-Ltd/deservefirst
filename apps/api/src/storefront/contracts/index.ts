/**
 * Storefront · contracts/index.ts
 * The ONLY surface other modules may import (§14.1).
 * Layer: contracts (pure types).
 */

import type { ResourceDefinition } from '@deservefirst/contracts';

/** A message somebody sent through the storefront's contact form. */
export interface ContactMessageSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly body: string;
  readonly status: 'new' | 'read' | 'replied' | 'spam';
  readonly createdAt: string;
}

/**
 * Declared as a resource so the generic read surface serves it.
 *
 * A list and a get come from this declaration alone — there is no controller
 * for reading messages, and writing one would be a second way into the same
 * rows. Only the status change is module-owned, because changing one is a
 * decision rather than a query.
 */
export const contactMessageResource: ResourceDefinition = {
  name: 'ContactMessage',
  entity: 'ContactMessage',
  pluralName: 'ContactMessages',
  urlSegment: 'contact-messages',
  aggregateRoot: 'ContactMessage',
  fields: [
    { name: 'id', type: 'id', visibility: 'public' },
    { name: 'email', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'name', type: 'string', searchable: true },
    { name: 'body', type: 'text', searchable: true },
    {
      name: 'status',
      type: 'enum',
      values: ['new', 'read', 'replied', 'spam'],
      filterable: true,
      sortable: true,
      indexed: true,
    },
    { name: 'sourcePath', type: 'string' },
    { name: 'createdAt', type: 'datetime', sortable: true, filterable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'public' },
  screens: ['list', 'detail'],
  /**
   * The message itself is a visible column, not a detail-page reveal.
   *
   * A list ordered by metadata with the message hidden is one people scan past;
   * the whole point of this screen is deciding which of these needs an answer,
   * and that decision is made by reading the first line.
   */
  columns: [
    { field: 'email', label: 'From', defaultVisible: true, position: 0 },
    { field: 'body', label: 'Message', defaultVisible: true, position: 1 },
    { field: 'status', label: 'Status', defaultVisible: true, position: 2 },
    { field: 'createdAt', label: 'Received', defaultVisible: true, position: 3 },
  ],
  permissions: {
    read: 'store.messages.read',
    /**
     * Triage is the only write, and there is no delete.
     *
     * A message a merchant believes is spam is MARKED spam rather than removed,
     * so it can be found again when a customer says "but I did write to you".
     */
    write: 'store.messages.read',
    delete: 'store.messages.read',
  },
};
