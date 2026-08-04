/**
 * Auth · auth.manifest.ts
 * The identity module's manifest. Note the entity scopes: a User is platform-wide
 * and an Organization spans stores, so neither carries a store_id. Declaring that
 * honestly is what keeps the isolation guard enforcing a real boundary rather
 * than a fiction (ADR 0001 D8).
 * Layer: manifest (declaration only; no logic).
 */

import type { ModuleManifest, ResourceDefinition } from '@deservefirst/contracts';

const userResource: ResourceDefinition = {
  name: 'User',
  entity: 'User',
  pluralName: 'Users',
  urlSegment: 'users',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'email', type: 'string', required: true, unique: true, indexed: true, filterable: true, sortable: true, searchable: true },
    { name: 'firstName', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'lastName', type: 'string', filterable: true, sortable: true, searchable: true },
    { name: 'status', type: 'enum', values: ['active', 'suspended', 'closed'], filterable: true, sortable: true },
    { name: 'secondaryEmail', type: 'string', visibility: 'private' },
    { name: 'emailVerifiedAt', type: 'datetime', sortable: true },
    { name: 'mfaEnabled', type: 'boolean', filterable: true },
    { name: 'locale', type: 'string' },
    { name: 'timeZone', type: 'string' },
    // Never public: this is the handle into the credential store.
    { name: 'providerRef', type: 'string', visibility: 'internal' },
    { name: 'passwordHash', type: 'text', visibility: 'internal' },
    { name: 'mfaSecret', type: 'text', visibility: 'internal' },
    { name: 'recoveryCodeHashes', type: 'json', visibility: 'internal' },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'private' },
  screens: ['list', 'detail'],
  permissions: { read: 'organization.users.read', write: 'organization.users.manage' },
};

const storeResource: ResourceDefinition = {
  name: 'Store',
  entity: 'Store',
  pluralName: 'Stores',
  urlSegment: 'stores',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'handle', type: 'handle', required: true, unique: true, indexed: true, filterable: true, searchable: true },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'businessEntityId', type: 'reference', references: 'BusinessEntity', filterable: true },
    { name: 'type', type: 'enum', values: ['live', 'development', 'client_transfer', 'password_protected'], filterable: true, sortable: true },
    { name: 'status', type: 'enum', values: ['active', 'paused', 'closed'], filterable: true, sortable: true },
    { name: 'defaultLocale', type: 'string' },
    { name: 'timeZone', type: 'string' },
    { name: 'baseCurrency', type: 'string', filterable: true },
    { name: 'featurePreviews', type: 'json' },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'private' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'stores.read', write: 'stores.create' },
};

const businessEntityResource: ResourceDefinition = {
  name: 'BusinessEntity',
  entity: 'BusinessEntity',
  pluralName: 'BusinessEntities',
  urlSegment: 'business-entities',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'countryCode', type: 'string', required: true, filterable: true, sortable: true },
    { name: 'companyType', type: 'string', filterable: true },
    { name: 'taxRegistrationId', type: 'string', visibility: 'private' },
    { name: 'archivedAt', type: 'datetime', filterable: true, sortable: true },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'private' },
  screens: ['list', 'detail', 'create'],
  permissions: { read: 'organization.read', write: 'organization.entities.manage' },
};

/**
 * The partner's own record.
 *
 * `private` visibility: this is not part of the public Admin API. A partner is
 * managed from the partner dashboard, and exposing it to store-scoped API
 * callers would let an app enumerate the agencies working on other merchants.
 */
const partnerResource: ResourceDefinition = {
  name: 'Partner',
  entity: 'Partner',
  pluralName: 'Partners',
  urlSegment: 'partners',
  fields: [
    { name: 'id', type: 'id' },
    { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
    { name: 'status', type: 'enum', values: ['active', 'suspended', 'closed'], filterable: true, sortable: true },
    { name: 'payoutCurrency', type: 'string', filterable: true },
    { name: 'websiteUrl', type: 'string' },
    { name: 'createdAt', type: 'datetime', sortable: true },
  ],
  api: { graphql: true, rest: true, visibility: 'private' },
  screens: ['list', 'detail'],
  permissions: { read: 'partner.read', write: 'partner.manage' },
};

/** Identity tables carry no merchant content, so most toolkit features are off. */
const IDENTITY_TOOLKIT = {
  metafields: false,
  metaobjects: false,
  tags: false,
  savedViews: false,
  bulkActions: false,
  importExport: false,
  seo: false,
} as const;

export const authManifest: ModuleManifest = {
  id: 'auth',
  version: '0.1.0',
  label: 'Identity',
  description: 'Users, organizations, business entities, stores, memberships and roles.',

  entitlementKey: 'core',
  dependsOn: [{ module: 'core', type: 'required' }],

  capabilities: ['entities', 'resources', 'permissions', 'events'],

  entities: [
    // Platform scope: one global User per email, never duplicated per store.
    { name: 'User', tableName: 'users', scope: 'platform', toolkit: { ...IDENTITY_TOOLKIT, timeline: true, audit: true } },
    {
      name: 'Organization',
      tableName: 'organizations',
      scope: 'platform',
      toolkit: IDENTITY_TOOLKIT,
      fields: [
        { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
        { name: 'requireSecureSignIn', type: 'boolean' },
      ],
    },
    {
      name: 'Session',
      tableName: 'sessions',
      scope: 'platform',
      toolkit: { ...IDENTITY_TOOLKIT, timeline: false, softDelete: false },
      fields: [
        { name: 'userId', type: 'reference', references: 'User', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', filterable: true },
        { name: 'organizationId', type: 'reference', references: 'Organization', filterable: true },
        // Stored hashed: a database disclosure must not yield a usable session.
        { name: 'refreshTokenHash', type: 'string', indexed: true, visibility: 'internal' },
        { name: 'deviceLabel', type: 'string' },
        { name: 'ipAddress', type: 'string', visibility: 'private' },
        { name: 'userAgent', type: 'text', visibility: 'private' },
        { name: 'lastSeenAt', type: 'datetime', sortable: true },
        { name: 'expiresAt', type: 'datetime', sortable: true, filterable: true },
        { name: 'revokedAt', type: 'datetime', filterable: true },
      ],
    },
    {
      name: 'LoginFlow',
      tableName: 'login_flows',
      scope: 'platform',
      toolkit: { ...IDENTITY_TOOLKIT, timeline: false, softDelete: false },
      fields: [
        { name: 'rid', type: 'string', unique: true, indexed: true, filterable: true },
        { name: 'step', type: 'enum', values: ['lookup', 'password', 'mfa', 'store-select', 'complete'] },
        { name: 'email', type: 'string' },
        { name: 'userId', type: 'reference', references: 'User' },
        { name: 'returnPath', type: 'string' },
        { name: 'attempts', type: 'integer' },
        { name: 'expiresAt', type: 'datetime', filterable: true },
      ],
    },

    // Organization scope: these belong to an org and span its stores.
    { name: 'BusinessEntity', tableName: 'business_entities', scope: 'organization', toolkit: { ...IDENTITY_TOOLKIT, audit: true } },
    { name: 'Store', tableName: 'stores', scope: 'organization', toolkit: { ...IDENTITY_TOOLKIT, timeline: true, audit: true } },
    {
      name: 'Membership',
      tableName: 'memberships',
      scope: 'organization',
      toolkit: IDENTITY_TOOLKIT,
      fields: [
        { name: 'userId', type: 'reference', references: 'User', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', indexed: true, filterable: true },
        { name: 'status', type: 'enum', values: ['active', 'pending', 'revoked'], filterable: true },
        { name: 'invitedBy', type: 'reference', references: 'User' },
      ],
    },
    {
      name: 'Role',
      tableName: 'roles',
      scope: 'organization',
      toolkit: IDENTITY_TOOLKIT,
      fields: [
        { name: 'storeId', type: 'reference', references: 'Store', filterable: true },
        { name: 'category', type: 'enum', values: ['organization', 'store', 'point-of-sale', 'partner'], filterable: true },
        { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
        { name: 'description', type: 'text' },
        { name: 'permissions', type: 'json' },
        { name: 'system', type: 'boolean', filterable: true },
        { name: 'grantsApproval', type: 'boolean' },
      ],
    },
    {
      name: 'RoleAssignment',
      tableName: 'role_assignments',
      scope: 'organization',
      toolkit: { ...IDENTITY_TOOLKIT, softDelete: false },
      fields: [
        { name: 'userId', type: 'reference', references: 'User', indexed: true, filterable: true },
        { name: 'roleId', type: 'reference', references: 'Role', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', filterable: true },
      ],
    },

    // Partner scope: a top-level actor, deliberately not hung off Organization.
    // A partner owns no stores; its reach into each one is a separate grant that
    // the store's owner makes and can take back.
    {
      name: 'Partner',
      tableName: 'partners',
      scope: 'platform',
      toolkit: { ...IDENTITY_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'ownerUserId', type: 'reference', references: 'User', indexed: true, filterable: true },
        { name: 'name', type: 'string', required: true, filterable: true, sortable: true, searchable: true },
        { name: 'status', type: 'enum', values: ['active', 'suspended', 'closed'], filterable: true, sortable: true },
        { name: 'payoutCurrency', type: 'string', filterable: true },
        { name: 'websiteUrl', type: 'string' },
      ],
    },
    {
      name: 'PartnerStaff',
      tableName: 'partner_staff',
      scope: 'platform',
      toolkit: IDENTITY_TOOLKIT,
      fields: [
        { name: 'partnerId', type: 'reference', references: 'Partner', indexed: true, filterable: true },
        { name: 'userId', type: 'reference', references: 'User', indexed: true, filterable: true },
        { name: 'role', type: 'enum', values: ['owner', 'admin', 'member'], filterable: true },
        { name: 'status', type: 'enum', values: ['active', 'invited', 'removed'], filterable: true },
      ],
    },
    {
      name: 'PartnerStoreLink',
      tableName: 'partner_store_links',
      scope: 'platform',
      toolkit: { ...IDENTITY_TOOLKIT, timeline: true, audit: true },
      fields: [
        { name: 'partnerId', type: 'reference', references: 'Partner', indexed: true, filterable: true },
        { name: 'storeId', type: 'reference', references: 'Store', indexed: true, filterable: true },
        { name: 'status', type: 'enum', values: ['pending', 'active', 'revoked'], filterable: true },
        { name: 'accessLevel', type: 'enum', values: ['full', 'limited'], filterable: true },
        { name: 'permissions', type: 'json' },
        { name: 'createdByPartner', type: 'boolean', filterable: true },
        { name: 'requestedAt', type: 'datetime', sortable: true },
        { name: 'decidedAt', type: 'datetime', sortable: true },
        { name: 'revokedReason', type: 'text' },
      ],
    },
  ],

  resources: [userResource, storeResource, businessEntityResource, partnerResource],

  permissions: [
    { key: 'organization.read', label: 'View organization', description: 'See organization details.', categories: ['organization'] },
    { key: 'organization.users.read', label: 'View users', description: 'See organization users.', categories: ['organization'] },
    { key: 'organization.users.manage', label: 'Manage users', description: 'Invite and remove users.', categories: ['organization'] },
    { key: 'organization.entities.manage', label: 'Manage business entities', description: 'Add and archive legal entities.', categories: ['organization'] },
    { key: 'stores.read', label: 'View stores', description: 'See stores in the organization.', categories: ['organization'] },
    { key: 'stores.create', label: 'Create stores', description: 'Create development and live stores.', categories: ['organization'] },

    // Held by partner staff, inside the partner — never by store staff.
    { key: 'partner.read', label: 'View partner', description: 'See the partner account and its client stores.', categories: ['partner'] },
    { key: 'partner.manage', label: 'Manage partner', description: 'Change partner details and payout settings.', categories: ['partner'] },
    { key: 'partner.staff.manage', label: 'Manage partner team', description: 'Invite and remove partner staff.', categories: ['partner'] },
    { key: 'partner.stores.request', label: 'Request store access', description: 'Ask a merchant for access to their store.', categories: ['partner'] },
    { key: 'partner.stores.create', label: 'Create client stores', description: 'Create development stores and transfer them to clients.', categories: ['partner'] },

    // Held by the STORE's own staff. This is the merchant's side of the gate:
    // approving a partner is something only the store can do, which is why the
    // permission lives here and not among the partner's.
    { key: 'store.partners.manage', label: 'Manage partner access', description: 'Approve, limit and revoke partner access to this store.', categories: ['store'] },
  ],

  events: [
    { type: 'auth.user.created', version: 1, label: 'User created', description: 'A user account was created.', direction: 'emits' },
    { type: 'auth.tenant.created', version: 1, label: 'Store created', description: 'A store was created; Core seeds defaults and modules react.', direction: 'emits' },
    { type: 'auth.membership.granted', version: 1, label: 'Membership granted', description: 'A user was given access to a store.', direction: 'emits' },
    { type: 'auth.membership.revoked', version: 1, label: 'Membership revoked', description: 'A user lost access to a store.', direction: 'emits' },
    { type: 'auth.partner.created', version: 1, label: 'Partner created', description: 'A partner account was created.', direction: 'emits' },
    { type: 'auth.partner-access.requested', version: 1, label: 'Partner requested store access', description: 'A partner asked a merchant for access to their store.', direction: 'emits' },
    { type: 'auth.partner-access.granted', version: 1, label: 'Partner access granted', description: 'A store owner let a partner in.', direction: 'emits' },
    { type: 'auth.partner-access.revoked', version: 1, label: 'Partner access revoked', description: 'A store owner removed a partner.', direction: 'emits' },
    { type: 'auth.store.transferred', version: 1, label: 'Store transferred', description: 'A partner handed a store to its client.', direction: 'emits' },
  ],

  lifecycle: { startup: 'eager' },
};

export default authManifest;
