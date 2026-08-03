/**
 * Contracts · urls.ts
 * The canonical URL map (§8.4, §8.5, §24). Every path shape here was verified
 * against the reference product capture (PLAN/01 §3) and is the single source of
 * truth for both the frontend route tree and the backend route registry — they
 * derive from this file, so they cannot drift (§24.1).
 * Layer: contracts (pure, no framework).
 *
 * Conventions, applied verbatim everywhere:
 *   list    /{resource}
 *   create  /{resource}/new
 *   detail  /{resource}/{id}
 *   nested  /{resource}/{id}/{sub}
 *   core settings   /settings/{section}
 *   module settings /settings/{module}
 * The store lives in the path; the person lives on accounts.; the partner on
 * partners.; the developer on dev.; and the tenant travels in the token for API
 * calls, never in the API path.
 */

/** Every host in the platform (PLAN/01 §2). */
export type HostKey =
  | 'marketing'
  | 'accounts'
  | 'admin'
  | 'partners'
  | 'developers'
  | 'api'
  | 'storefront';

// ---------------------------------------------------------------------------
// Unauthenticated / identity — marketing host
// ---------------------------------------------------------------------------

export const authPaths = {
  home: () => '/',
  login: (options?: { loginHint?: string; returnPath?: string }) => {
    const params = new URLSearchParams();
    if (options?.loginHint) params.set('login_hint', options.loginHint);
    if (options?.returnPath) params.set('returnPath', options.returnPath);
    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  },
  /** Step 2 of the login chain; `rid` correlates every step of one attempt. */
  loginLookup: (rid: string) => `/login/lookup?rid=${encodeURIComponent(rid)}`,
  loginTwoFactor: (rid: string, method: 'app' | 'sms' | 'email' = 'app') =>
    `/login/two-factor/${method}?rid=${encodeURIComponent(rid)}`,
  logout: () => '/logout',
  signup: () => '/signup',
  passwordForgot: () => '/password/forgot',
  passwordReset: (token: string) => `/password/reset/${token}`,
  verifyEmail: (token: string) => `/verify-email/${token}`,
  acceptInvite: (token: string) => `/invite/${token}`,
  oauthStart: (provider: string) => `/oauth/${provider}`,
  oauthCallback: (provider: string) => `/oauth/${provider}/callback`,
  /** Step-up verification when an action needs fresh proof of identity. */
  challenge: (token: string) => `/challenges/user_verification?token=${encodeURIComponent(token)}`,
} as const;

// ---------------------------------------------------------------------------
// The person — accounts host. Spans every store the user belongs to.
// ---------------------------------------------------------------------------

export const accountPaths = {
  overview: (accountId: string) => `/accounts/${accountId}`,
  personal: (accountId: string) => `/accounts/${accountId}/personal`,
  security: (accountId: string) => `/accounts/${accountId}/security`,
  /** 2FA enrolment is deep-linked by fragment, as the reference product does. */
  enrollTwoFactor: (accountId: string) => `/accounts/${accountId}/security#enroll_tfa`,
  passkeys: (accountId: string) => `/accounts/${accountId}/security/passkeys`,
  sessions: (accountId: string) => `/accounts/${accountId}/sessions`,
  notifications: (accountId: string) => `/accounts/${accountId}/notifications`,
  connectedAccounts: (accountId: string) => `/accounts/${accountId}/connected-accounts`,
  stores: (accountId: string) => `/accounts/${accountId}/stores`,
  createStore: (accountId: string) => `/accounts/${accountId}/stores/new`,
  close: (accountId: string) => `/accounts/${accountId}/close`,
} as const;

// ---------------------------------------------------------------------------
// The organization — admin host, above any single store.
// ---------------------------------------------------------------------------

export const organizationPaths = {
  root: (orgId: string) => `/organization/${orgId}`,
  details: (orgId: string) => `/organization/${orgId}/settings/organization-details`,
  users: (orgId: string) => `/organization/${orgId}/settings/organization-account`,
  user: (orgId: string, userId: string) =>
    `/organization/${orgId}/settings/organization-account/${userId}`,
  addUser: (orgId: string) => `/organization/${orgId}/settings/organization-account/new`,
  roles: (orgId: string) => `/organization/${orgId}/settings/organization-account/roles`,
  addRole: (orgId: string) => `/organization/${orgId}/settings/organization-account/roles/new`,
  role: (orgId: string, roleId: string) =>
    `/organization/${orgId}/settings/organization-account/roles/${roleId}`,
  security: (orgId: string) => `/organization/${orgId}/settings/organization-account/security`,
  businessEntities: (orgId: string) => `/organization/${orgId}/settings/business-entities`,
  businessEntity: (orgId: string, entityId: string) =>
    `/organization/${orgId}/settings/business-entities/${entityId}`,
  createStore: (orgId: string) => `/store-create/organization/${orgId}`,
} as const;

// ---------------------------------------------------------------------------
// The store — admin host. One store at a time, all modules.
// ---------------------------------------------------------------------------

const store = (handle: string) => `/store/${handle}`;

export const storePaths = {
  root: store,
  search: (h: string) => `${store(h)}/search`,
  notifications: (h: string) => `${store(h)}/notifications`,
  activity: (h: string) => `${store(h)}/activity`,

  // Orders
  orders: (h: string) => `${store(h)}/orders`,
  order: (h: string, id: string) => `${store(h)}/orders/${id}`,
  draftOrders: (h: string) => `${store(h)}/draft_orders`,
  draftOrderNew: (h: string) => `${store(h)}/draft_orders/new`,
  draftOrder: (h: string, id: string) => `${store(h)}/draft_orders/${id}`,
  shippingLabels: (h: string) => `${store(h)}/shipping_labels`,
  abandonedCheckouts: (h: string) => `${store(h)}/checkouts`,

  // Products
  products: (h: string) => `${store(h)}/products`,
  productNew: (h: string) => `${store(h)}/products/new`,
  product: (h: string, id: string) => `${store(h)}/products/${id}`,
  productVariant: (h: string, id: string, variantId: string) =>
    `${store(h)}/products/${id}/variants/${variantId}`,
  productVariantNew: (h: string, id: string) => `${store(h)}/products/${id}/variants/new`,
  collections: (h: string) => `${store(h)}/collections`,
  collectionNew: (h: string) => `${store(h)}/collections/new`,
  collection: (h: string, id: string) => `${store(h)}/collections/${id}`,
  inventory: (h: string, locationId?: string) =>
    locationId
      ? `${store(h)}/products/inventory?location_id=${locationId}`
      : `${store(h)}/products/inventory`,
  purchaseOrders: (h: string) => `${store(h)}/purchase_orders`,
  purchaseOrderNew: (h: string) => `${store(h)}/purchase_orders/new`,
  purchaseOrder: (h: string, id: string) => `${store(h)}/purchase_orders/${id}`,
  transfers: (h: string) => `${store(h)}/transfers`,
  transfer: (h: string, id: string) => `${store(h)}/transfers/${id}`,
  giftCards: (h: string) => `${store(h)}/gift_cards`,

  // Customers
  customers: (h: string) => `${store(h)}/customers`,
  customerNew: (h: string) => `${store(h)}/customers/new`,
  customer: (h: string, id: string) => `${store(h)}/customers/${id}`,
  customerSegments: (h: string) => `${store(h)}/customers/segments`,
  customerSegment: (h: string, id: string) => `${store(h)}/customers/segments/${id}`,
  companies: (h: string) => `${store(h)}/companies`,
  companyNew: (h: string) => `${store(h)}/companies/new`,
  company: (h: string, id: string) => `${store(h)}/companies/${id}`,

  // Other primary sections
  growth: (h: string) => `${store(h)}/growth`,
  discounts: (h: string) => `${store(h)}/discounts`,
  markets: (h: string) => `${store(h)}/markets`,
  finance: (h: string) => `${store(h)}/finance`,
  analytics: (h: string) => `${store(h)}/analytics`,

  // Content
  content: (h: string) => `${store(h)}/content`,
  metaobjects: (h: string) => `${store(h)}/content/metaobjects`,
  metaobject: (h: string, id: string) => `${store(h)}/content/metaobjects/${id}`,
  pages: (h: string) => `${store(h)}/pages`,
  pageNew: (h: string) => `${store(h)}/pages/new`,
  page: (h: string, id: string) => `${store(h)}/pages/${id}`,
  blogPost: (h: string, blogId: string, postId: string) =>
    `${store(h)}/blogs/${blogId}/posts/${postId}`,
  navigation: (h: string) => `${store(h)}/navigation`,

  // Sales channels
  onlineStore: (h: string) => `${store(h)}/online-store`,
  themes: (h: string) => `${store(h)}/themes`,
  themeEditor: (h: string, id: string) => `${store(h)}/themes/${id}/editor`,
  /** AI-agent sales channel (PLAN/01 §5). */
  agentic: (h: string) => `${store(h)}/apps/agentic`,

  // Modules
  services: (h: string) => `${store(h)}/services`,
  service: (h: string, moduleId: string) => `${store(h)}/services/${moduleId}`,
  serviceSubscribe: (h: string, moduleId: string) => `${store(h)}/services/${moduleId}/subscribe`,

  /**
   * The generic bulk editor. One screen serves every entity, parameterised by the
   * editable field set, with an explicit return path.
   */
  bulkEdit: (h: string, entity: string, fields: readonly string[], returnTo: string) => {
    const params = new URLSearchParams({
      resource_name: entity,
      edit: fields.join(','),
      return_to: returnTo,
    });
    return `${store(h)}/bulk/${entity.toLowerCase()}?${params.toString()}`;
  },
} as const;

// ---------------------------------------------------------------------------
// Store settings — rendered as an overlay above the admin, with real URLs.
// ---------------------------------------------------------------------------

const settings = (handle: string) => `${store(handle)}/settings`;

/** The section list, in the order the settings rail renders them. */
export const SETTINGS_SECTIONS = [
  'general', 'plan', 'billing', 'payments', 'checkout', 'customer_accounts',
  'shipping', 'taxes', 'locations', 'markets', 'apps', 'sales_channels',
  'domains', 'customer_events', 'notifications', 'custom_data', 'languages',
  'privacy', 'policies',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const settingsPaths = {
  root: settings,
  section: (h: string, section: SettingsSection) => `${settings(h)}/${section}`,

  general: (h: string) => `${settings(h)}/general`,
  storeContactDetails: (h: string) => `${settings(h)}/general/store-contact-details`,
  branding: (h: string) => `${settings(h)}/general/branding`,

  plan: (h: string) => `${settings(h)}/plan`,
  selectPlan: (h: string) => `${settings(h)}/subscribe/select-plan`,
  billing: (h: string) => `${settings(h)}/billing`,
  invoices: (h: string) => `${settings(h)}/billing/invoices`,
  invoice: (h: string, id: string) => `${settings(h)}/billing/invoices/${id}`,
  usage: (h: string) => `${settings(h)}/usage`,

  payments: (h: string) => `${settings(h)}/payments`,
  checkout: (h: string) => `${settings(h)}/checkout`,
  customerAccounts: (h: string) => `${settings(h)}/customer_accounts`,

  shipping: (h: string) => `${settings(h)}/shipping`,
  shippingProfile: (h: string, id: string) => `${settings(h)}/shipping/profiles/${id}`,
  taxes: (h: string) => `${settings(h)}/taxes`,
  locations: (h: string) => `${settings(h)}/locations`,
  markets: (h: string) => `${settings(h)}/markets`,

  apps: (h: string) => `${settings(h)}/apps`,
  app: (h: string, id: string) => `${settings(h)}/apps/${id}`,
  salesChannels: (h: string) => `${settings(h)}/sales_channels`,

  domains: (h: string) => `${settings(h)}/domains`,
  connectDomain: (h: string) => `${settings(h)}/domains/connect`,
  domainVerification: (h: string, id: string) => `${settings(h)}/domains/verifications/${id}`,

  customerEvents: (h: string) => `${settings(h)}/customer_events`,
  customPixel: (h: string, id: string) => `${settings(h)}/customer_events/pixels/custom/${id}`,

  notifications: (h: string) => `${settings(h)}/notifications`,
  customerNotifications: (h: string) => `${settings(h)}/notifications/customer`,

  /** Metafield & metaobject definitions — generic over entity (§12.1). */
  customData: (h: string) => `${settings(h)}/custom_data`,
  entityMetafields: (h: string, entity: string) =>
    `${settings(h)}/custom_data/${entity}/metafields`,
  createMetafieldDefinition: (h: string, entity: string) =>
    `${settings(h)}/custom_data/${entity}/metafields/create`,
  metaobjectDefinitions: (h: string) => `${settings(h)}/custom_data/metaobjects`,

  languages: (h: string) => `${settings(h)}/languages`,
  privacy: (h: string) => `${settings(h)}/privacy`,
  policies: (h: string) => `${settings(h)}/policies`,
  cancelReturnRules: (h: string, id: string) => `${settings(h)}/legal/cancel-return-rules/${id}`,

  users: (h: string) => `${settings(h)}/users`,
  inviteUser: (h: string) => `${settings(h)}/users/new`,
  user: (h: string, id: string) => `${settings(h)}/users/${id}`,
  userPermissions: (h: string, id: string) => `${settings(h)}/users/${id}/permissions`,
  roles: (h: string) => `${settings(h)}/roles`,
  role: (h: string, id: string) => `${settings(h)}/roles/${id}`,

  developer: (h: string) => `${settings(h)}/developer`,
  apiKeys: (h: string) => `${settings(h)}/developer/api-keys`,
  webhooks: (h: string) => `${settings(h)}/developer/webhooks`,
  eventLog: (h: string) => `${settings(h)}/developer/events`,

  account: (h: string) => `${settings(h)}/account`,
  /** Org-scoped screens are mirrored into the store settings tree. */
  organizationDetails: (h: string) => `${settings(h)}/organization-details`,
  organizationAccount: (h: string) => `${settings(h)}/organization-account`,
} as const;

// ---------------------------------------------------------------------------
// Developer dashboard — apps, dev stores, catalogs (decision D9).
// ---------------------------------------------------------------------------

const dev = (orgId: string) => `/dashboard/${orgId}`;

export const developerPaths = {
  root: dev,
  stores: (orgId: string, storeType?: 'dev' | 'client_transfer') =>
    storeType ? `${dev(orgId)}/stores?store_type=${storeType}` : `${dev(orgId)}/stores`,
  catalogs: (orgId: string) => `${dev(orgId)}/catalogs`,
  apps: (orgId: string) => `${dev(orgId)}/apps`,
  appNew: (orgId: string) => `${dev(orgId)}/apps/new`,
  app: (orgId: string, appId: string) => `${dev(orgId)}/apps/${appId}`,
  appSettings: (orgId: string, appId: string) => `${dev(orgId)}/apps/${appId}/settings`,
  appVersions: (orgId: string, appId: string) => `${dev(orgId)}/apps/${appId}/versions`,
  appVersionNew: (orgId: string, appId: string) => `${dev(orgId)}/apps/${appId}/versions/new`,
  appLogs: (orgId: string, appId: string) => `${dev(orgId)}/apps/${appId}/logs`,
  appApiHealth: (orgId: string, appId: string) =>
    `${dev(orgId)}/apps/${appId}/monitoring/api_health`,
  appWebhookMonitoring: (orgId: string, appId: string) =>
    `${dev(orgId)}/apps/${appId}/monitoring/webhooks`,
  appFunctionMonitoring: (orgId: string, appId: string) =>
    `${dev(orgId)}/apps/${appId}/monitoring/function`,
} as const;

/** App log event taxonomy, mirrored from the reference product's filter list. */
export const APP_LOG_TYPES = [
  'webhook', 'function', 'app-event', 'app-billing-event',
  'graphql-request', 'rest-request', 'ui-extension-error', 'assistant-event',
] as const;

export type AppLogType = (typeof APP_LOG_TYPES)[number];

// ---------------------------------------------------------------------------
// Partner dashboard.
// ---------------------------------------------------------------------------

const partner = (partnerId: string) => `/${partnerId}`;

export const partnerPaths = {
  root: partner,
  stores: (p: string) => `${partner(p)}/stores`,
  storeNew: (p: string) => `${partner(p)}/stores/new`,
  store: (p: string, handle: string) => `${partner(p)}/stores/${handle}`,
  apps: (p: string) => `${partner(p)}/apps`,
  app: (p: string, appId: string) => `${partner(p)}/apps/${appId}`,
  leads: (p: string) => `${partner(p)}/partner_leads`,
  leadNew: (p: string, kind: 'plus' | 'pos' | 'b2b') => `${partner(p)}/partner_leads/${kind}`,
  referralHistory: (p: string) => `${partner(p)}/referral_history`,
  payouts: (p: string) => `${partner(p)}/payouts`,
  team: (p: string) => `${partner(p)}/team`,
  teamMember: (p: string, id: string) => `${partner(p)}/team/${id}`,
  settings: (p: string) => `${partner(p)}/settings`,
  apiClients: (p: string) => `${partner(p)}/settings/partner_api_clients`,
  apiClientNew: (p: string) => `${partner(p)}/settings/partner_api_clients/new`,
  apiClient: (p: string, id: string) => `${partner(p)}/settings/partner_api_clients/${id}`,
  /** Dated GraphQL explorer bound to one API client — dogfooding the schema (§26.5). */
  graphiql: (p: string, clientId: string, apiVersion: string) =>
    `${partner(p)}/settings/partner_api_clients/graphiql?partnerApiClient=${clientId}&apiVersion=${apiVersion}`,
} as const;

// ---------------------------------------------------------------------------
// API — dated versions; the tenant travels in the token, never in the path.
// ---------------------------------------------------------------------------

export const apiPaths = {
  resource: (version: string, module: string, resource: string) =>
    `/${version}/${module}/${resource}`,
  resourceItem: (version: string, module: string, resource: string, id: string) =>
    `/${version}/${module}/${resource}/${id}`,
  graphql: (version: string) => `/${version}/graphql`,
  token: (version: string) => `/${version}/auth/token`,
  refresh: (version: string) => `/${version}/auth/refresh`,
  webhook: (version: string, topic: string) => `/${version}/webhooks/${topic}`,
  /** Read-only reflection of the platform registry (§36.1). */
  reflection: (version: string, kind: 'modules' | 'entities' | 'settings' | 'capabilities' | 'runtime') =>
    `/${version}/platform/${kind}`,
} as const;

// ---------------------------------------------------------------------------
// Storefront — merchant-facing public output.
// ---------------------------------------------------------------------------

export const storefrontPaths = {
  home: () => '/',
  product: (handle: string) => `/products/${handle}`,
  collection: (handle: string) => `/collections/${handle}`,
  page: (handle: string) => `/pages/${handle}`,
  blogPost: (blog: string, post: string) => `/blogs/${blog}/${post}`,
  cart: () => '/cart',
  /** Localised storefront URLs use a subfolder prefix for SEO (§15.7). */
  localized: (locale: string, path: string) => `/${locale}${path}`,
} as const;
