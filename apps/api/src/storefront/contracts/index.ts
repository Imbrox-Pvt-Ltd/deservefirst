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

/**
 * A connected hostname, as the admin reads it.
 *
 * `verificationToken` is deliberately NOT a field here. The list screen reads
 * this resource, and a token on its own is a value nobody can act on — the
 * instruction a merchant needs is the whole DNS record, which
 * `GET /domains` assembles. Exposing the raw token would put a secret-looking
 * string in an export for no benefit.
 */
export const storeDomainResource: ResourceDefinition = {
  name: 'StoreDomain',
  entity: 'StoreDomain',
  pluralName: 'StoreDomains',
  urlSegment: 'domains',
  aggregateRoot: 'StoreDomain',
  fields: [
    { name: 'id', type: 'id', visibility: 'public' },
    { name: 'host', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'role', type: 'enum', values: ['primary', 'alias'], filterable: true, sortable: true },
    {
      name: 'status',
      type: 'enum',
      values: ['pending', 'verified', 'failed'],
      filterable: true,
      sortable: true,
      indexed: true,
    },
    /** Whether traffic actually arrives. Diagnostic, never a gate on serving. */
    { name: 'reachesUs', type: 'boolean', filterable: true },
    { name: 'verifiedAt', type: 'datetime', sortable: true, filterable: true },
    { name: 'lastCheckedAt', type: 'datetime', sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true, filterable: true },
  ],
  /**
   * No generic REST surface, deliberately — `domains.controller.ts` is the only
   * way in.
   *
   * Every other resource on the platform is happy with the generic list, and
   * this one is not, because a domain row is useless on its own: what a
   * merchant needs is the DNS records to paste at their registrar, and those
   * are DERIVED from the host and the token rather than stored. A generic list
   * would return rows nobody can act on, sitting beside a controller that
   * returns rows they can — two ways into the same data that would eventually
   * disagree about which is authoritative.
   *
   * The resource still earns its place: it defines the entity the ListScreen
   * renders and the fields it may sort and filter on.
   */
  api: { graphql: false, rest: false, visibility: 'internal' },
  screens: ['list'],
  /**
   * Reading and writing take the SAME permission, and that is deliberate.
   *
   * Knowing which hostnames a store answers on is not sensitive; being able to
   * add one decides where its customers land. There is no useful role that
   * reads this list and must not change it, and splitting them would invent a
   * distinction nobody asked for.
   */
  permissions: {
    read: 'store.domains.manage',
    write: 'store.domains.manage',
  },
};
