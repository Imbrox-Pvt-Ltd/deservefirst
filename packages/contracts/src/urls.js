"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.storefrontPaths = exports.apiPaths = exports.partnerPaths = exports.APP_LOG_TYPES = exports.developerPaths = exports.settingsPaths = exports.SETTINGS_SECTIONS = exports.storePaths = exports.organizationPaths = exports.accountPaths = exports.authPaths = void 0;
// ---------------------------------------------------------------------------
// Unauthenticated / identity — marketing host
// ---------------------------------------------------------------------------
exports.authPaths = {
    home: () => '/',
    login: (options) => {
        const params = new URLSearchParams();
        if (options?.loginHint)
            params.set('login_hint', options.loginHint);
        if (options?.returnPath)
            params.set('returnPath', options.returnPath);
        const query = params.toString();
        return query ? `/login?${query}` : '/login';
    },
    /** Step 2 of the login chain; `rid` correlates every step of one attempt. */
    loginLookup: (rid) => `/login/lookup?rid=${encodeURIComponent(rid)}`,
    loginTwoFactor: (rid, method = 'app') => `/login/two-factor/${method}?rid=${encodeURIComponent(rid)}`,
    logout: () => '/logout',
    signup: () => '/signup',
    passwordForgot: () => '/password/forgot',
    passwordReset: (token) => `/password/reset/${token}`,
    verifyEmail: (token) => `/verify-email/${token}`,
    acceptInvite: (token) => `/invite/${token}`,
    oauthStart: (provider) => `/oauth/${provider}`,
    oauthCallback: (provider) => `/oauth/${provider}/callback`,
    /** Step-up verification when an action needs fresh proof of identity. */
    challenge: (token) => `/challenges/user_verification?token=${encodeURIComponent(token)}`,
};
// ---------------------------------------------------------------------------
// The person — accounts host. Spans every store the user belongs to.
// ---------------------------------------------------------------------------
exports.accountPaths = {
    overview: (accountId) => `/accounts/${accountId}`,
    personal: (accountId) => `/accounts/${accountId}/personal`,
    security: (accountId) => `/accounts/${accountId}/security`,
    /** 2FA enrolment is deep-linked by fragment, as the reference product does. */
    enrollTwoFactor: (accountId) => `/accounts/${accountId}/security#enroll_tfa`,
    passkeys: (accountId) => `/accounts/${accountId}/security/passkeys`,
    sessions: (accountId) => `/accounts/${accountId}/sessions`,
    notifications: (accountId) => `/accounts/${accountId}/notifications`,
    connectedAccounts: (accountId) => `/accounts/${accountId}/connected-accounts`,
    stores: (accountId) => `/accounts/${accountId}/stores`,
    createStore: (accountId) => `/accounts/${accountId}/stores/new`,
    close: (accountId) => `/accounts/${accountId}/close`,
};
// ---------------------------------------------------------------------------
// The organization — admin host, above any single store.
// ---------------------------------------------------------------------------
exports.organizationPaths = {
    root: (orgId) => `/organization/${orgId}`,
    details: (orgId) => `/organization/${orgId}/settings/organization-details`,
    users: (orgId) => `/organization/${orgId}/settings/organization-account`,
    user: (orgId, userId) => `/organization/${orgId}/settings/organization-account/${userId}`,
    addUser: (orgId) => `/organization/${orgId}/settings/organization-account/new`,
    roles: (orgId) => `/organization/${orgId}/settings/organization-account/roles`,
    addRole: (orgId) => `/organization/${orgId}/settings/organization-account/roles/new`,
    role: (orgId, roleId) => `/organization/${orgId}/settings/organization-account/roles/${roleId}`,
    security: (orgId) => `/organization/${orgId}/settings/organization-account/security`,
    businessEntities: (orgId) => `/organization/${orgId}/settings/business-entities`,
    businessEntity: (orgId, entityId) => `/organization/${orgId}/settings/business-entities/${entityId}`,
    createStore: (orgId) => `/store-create/organization/${orgId}`,
};
// ---------------------------------------------------------------------------
// The store — admin host. One store at a time, all modules.
// ---------------------------------------------------------------------------
const store = (handle) => `/store/${handle}`;
exports.storePaths = {
    root: store,
    search: (h) => `${store(h)}/search`,
    notifications: (h) => `${store(h)}/notifications`,
    activity: (h) => `${store(h)}/activity`,
    // Orders
    orders: (h) => `${store(h)}/orders`,
    order: (h, id) => `${store(h)}/orders/${id}`,
    draftOrders: (h) => `${store(h)}/draft_orders`,
    draftOrderNew: (h) => `${store(h)}/draft_orders/new`,
    draftOrder: (h, id) => `${store(h)}/draft_orders/${id}`,
    shippingLabels: (h) => `${store(h)}/shipping_labels`,
    abandonedCheckouts: (h) => `${store(h)}/checkouts`,
    // Products
    products: (h) => `${store(h)}/products`,
    productNew: (h) => `${store(h)}/products/new`,
    product: (h, id) => `${store(h)}/products/${id}`,
    productVariant: (h, id, variantId) => `${store(h)}/products/${id}/variants/${variantId}`,
    productVariantNew: (h, id) => `${store(h)}/products/${id}/variants/new`,
    collections: (h) => `${store(h)}/collections`,
    collectionNew: (h) => `${store(h)}/collections/new`,
    collection: (h, id) => `${store(h)}/collections/${id}`,
    inventory: (h, locationId) => locationId
        ? `${store(h)}/products/inventory?location_id=${locationId}`
        : `${store(h)}/products/inventory`,
    purchaseOrders: (h) => `${store(h)}/purchase_orders`,
    purchaseOrderNew: (h) => `${store(h)}/purchase_orders/new`,
    purchaseOrder: (h, id) => `${store(h)}/purchase_orders/${id}`,
    transfers: (h) => `${store(h)}/transfers`,
    transfer: (h, id) => `${store(h)}/transfers/${id}`,
    giftCards: (h) => `${store(h)}/gift_cards`,
    // Customers
    customers: (h) => `${store(h)}/customers`,
    customerNew: (h) => `${store(h)}/customers/new`,
    customer: (h, id) => `${store(h)}/customers/${id}`,
    customerSegments: (h) => `${store(h)}/customers/segments`,
    customerSegment: (h, id) => `${store(h)}/customers/segments/${id}`,
    companies: (h) => `${store(h)}/companies`,
    companyNew: (h) => `${store(h)}/companies/new`,
    company: (h, id) => `${store(h)}/companies/${id}`,
    // Other primary sections
    growth: (h) => `${store(h)}/growth`,
    discounts: (h) => `${store(h)}/discounts`,
    markets: (h) => `${store(h)}/markets`,
    finance: (h) => `${store(h)}/finance`,
    analytics: (h) => `${store(h)}/analytics`,
    // Content
    content: (h) => `${store(h)}/content`,
    metaobjects: (h) => `${store(h)}/content/metaobjects`,
    metaobject: (h, id) => `${store(h)}/content/metaobjects/${id}`,
    pages: (h) => `${store(h)}/pages`,
    pageNew: (h) => `${store(h)}/pages/new`,
    page: (h, id) => `${store(h)}/pages/${id}`,
    blogPost: (h, blogId, postId) => `${store(h)}/blogs/${blogId}/posts/${postId}`,
    navigation: (h) => `${store(h)}/navigation`,
    // Sales channels
    onlineStore: (h) => `${store(h)}/online-store`,
    themes: (h) => `${store(h)}/themes`,
    themeEditor: (h, id) => `${store(h)}/themes/${id}/editor`,
    /** AI-agent sales channel (PLAN/01 §5). */
    agentic: (h) => `${store(h)}/apps/agentic`,
    // Modules
    services: (h) => `${store(h)}/services`,
    service: (h, moduleId) => `${store(h)}/services/${moduleId}`,
    serviceSubscribe: (h, moduleId) => `${store(h)}/services/${moduleId}/subscribe`,
    /**
     * The generic bulk editor. One screen serves every entity, parameterised by the
     * editable field set, with an explicit return path.
     */
    bulkEdit: (h, entity, fields, returnTo) => {
        const params = new URLSearchParams({
            resource_name: entity,
            edit: fields.join(','),
            return_to: returnTo,
        });
        return `${store(h)}/bulk/${entity.toLowerCase()}?${params.toString()}`;
    },
};
// ---------------------------------------------------------------------------
// Store settings — rendered as an overlay above the admin, with real URLs.
// ---------------------------------------------------------------------------
const settings = (handle) => `${store(handle)}/settings`;
/** The section list, in the order the settings rail renders them. */
exports.SETTINGS_SECTIONS = [
    'general', 'plan', 'billing', 'payments', 'checkout', 'customer_accounts',
    'shipping', 'taxes', 'locations', 'markets', 'apps', 'sales_channels',
    'domains', 'customer_events', 'notifications', 'custom_data', 'languages',
    'privacy', 'policies',
];
exports.settingsPaths = {
    root: settings,
    section: (h, section) => `${settings(h)}/${section}`,
    general: (h) => `${settings(h)}/general`,
    storeContactDetails: (h) => `${settings(h)}/general/store-contact-details`,
    branding: (h) => `${settings(h)}/general/branding`,
    plan: (h) => `${settings(h)}/plan`,
    selectPlan: (h) => `${settings(h)}/subscribe/select-plan`,
    billing: (h) => `${settings(h)}/billing`,
    invoices: (h) => `${settings(h)}/billing/invoices`,
    invoice: (h, id) => `${settings(h)}/billing/invoices/${id}`,
    usage: (h) => `${settings(h)}/usage`,
    payments: (h) => `${settings(h)}/payments`,
    checkout: (h) => `${settings(h)}/checkout`,
    customerAccounts: (h) => `${settings(h)}/customer_accounts`,
    shipping: (h) => `${settings(h)}/shipping`,
    shippingProfile: (h, id) => `${settings(h)}/shipping/profiles/${id}`,
    taxes: (h) => `${settings(h)}/taxes`,
    locations: (h) => `${settings(h)}/locations`,
    markets: (h) => `${settings(h)}/markets`,
    apps: (h) => `${settings(h)}/apps`,
    app: (h, id) => `${settings(h)}/apps/${id}`,
    salesChannels: (h) => `${settings(h)}/sales_channels`,
    domains: (h) => `${settings(h)}/domains`,
    connectDomain: (h) => `${settings(h)}/domains/connect`,
    domainVerification: (h, id) => `${settings(h)}/domains/verifications/${id}`,
    customerEvents: (h) => `${settings(h)}/customer_events`,
    customPixel: (h, id) => `${settings(h)}/customer_events/pixels/custom/${id}`,
    notifications: (h) => `${settings(h)}/notifications`,
    customerNotifications: (h) => `${settings(h)}/notifications/customer`,
    /** Metafield & metaobject definitions — generic over entity (§12.1). */
    customData: (h) => `${settings(h)}/custom_data`,
    entityMetafields: (h, entity) => `${settings(h)}/custom_data/${entity}/metafields`,
    createMetafieldDefinition: (h, entity) => `${settings(h)}/custom_data/${entity}/metafields/create`,
    metaobjectDefinitions: (h) => `${settings(h)}/custom_data/metaobjects`,
    languages: (h) => `${settings(h)}/languages`,
    privacy: (h) => `${settings(h)}/privacy`,
    policies: (h) => `${settings(h)}/policies`,
    cancelReturnRules: (h, id) => `${settings(h)}/legal/cancel-return-rules/${id}`,
    users: (h) => `${settings(h)}/users`,
    inviteUser: (h) => `${settings(h)}/users/new`,
    user: (h, id) => `${settings(h)}/users/${id}`,
    userPermissions: (h, id) => `${settings(h)}/users/${id}/permissions`,
    roles: (h) => `${settings(h)}/roles`,
    role: (h, id) => `${settings(h)}/roles/${id}`,
    developer: (h) => `${settings(h)}/developer`,
    apiKeys: (h) => `${settings(h)}/developer/api-keys`,
    webhooks: (h) => `${settings(h)}/developer/webhooks`,
    eventLog: (h) => `${settings(h)}/developer/events`,
    account: (h) => `${settings(h)}/account`,
    /** Org-scoped screens are mirrored into the store settings tree. */
    organizationDetails: (h) => `${settings(h)}/organization-details`,
    organizationAccount: (h) => `${settings(h)}/organization-account`,
};
// ---------------------------------------------------------------------------
// Developer dashboard — apps, dev stores, catalogs (decision D9).
// ---------------------------------------------------------------------------
const dev = (orgId) => `/dashboard/${orgId}`;
exports.developerPaths = {
    root: dev,
    stores: (orgId, storeType) => storeType ? `${dev(orgId)}/stores?store_type=${storeType}` : `${dev(orgId)}/stores`,
    catalogs: (orgId) => `${dev(orgId)}/catalogs`,
    apps: (orgId) => `${dev(orgId)}/apps`,
    appNew: (orgId) => `${dev(orgId)}/apps/new`,
    app: (orgId, appId) => `${dev(orgId)}/apps/${appId}`,
    appSettings: (orgId, appId) => `${dev(orgId)}/apps/${appId}/settings`,
    appVersions: (orgId, appId) => `${dev(orgId)}/apps/${appId}/versions`,
    appVersionNew: (orgId, appId) => `${dev(orgId)}/apps/${appId}/versions/new`,
    appLogs: (orgId, appId) => `${dev(orgId)}/apps/${appId}/logs`,
    appApiHealth: (orgId, appId) => `${dev(orgId)}/apps/${appId}/monitoring/api_health`,
    appWebhookMonitoring: (orgId, appId) => `${dev(orgId)}/apps/${appId}/monitoring/webhooks`,
    appFunctionMonitoring: (orgId, appId) => `${dev(orgId)}/apps/${appId}/monitoring/function`,
};
/** App log event taxonomy, mirrored from the reference product's filter list. */
exports.APP_LOG_TYPES = [
    'webhook', 'function', 'app-event', 'app-billing-event',
    'graphql-request', 'rest-request', 'ui-extension-error', 'assistant-event',
];
// ---------------------------------------------------------------------------
// Partner dashboard.
// ---------------------------------------------------------------------------
const partner = (partnerId) => `/${partnerId}`;
exports.partnerPaths = {
    root: partner,
    stores: (p) => `${partner(p)}/stores`,
    storeNew: (p) => `${partner(p)}/stores/new`,
    store: (p, handle) => `${partner(p)}/stores/${handle}`,
    apps: (p) => `${partner(p)}/apps`,
    app: (p, appId) => `${partner(p)}/apps/${appId}`,
    leads: (p) => `${partner(p)}/partner_leads`,
    leadNew: (p, kind) => `${partner(p)}/partner_leads/${kind}`,
    referralHistory: (p) => `${partner(p)}/referral_history`,
    payouts: (p) => `${partner(p)}/payouts`,
    team: (p) => `${partner(p)}/team`,
    teamMember: (p, id) => `${partner(p)}/team/${id}`,
    settings: (p) => `${partner(p)}/settings`,
    apiClients: (p) => `${partner(p)}/settings/partner_api_clients`,
    apiClientNew: (p) => `${partner(p)}/settings/partner_api_clients/new`,
    apiClient: (p, id) => `${partner(p)}/settings/partner_api_clients/${id}`,
    /** Dated GraphQL explorer bound to one API client — dogfooding the schema (§26.5). */
    graphiql: (p, clientId, apiVersion) => `${partner(p)}/settings/partner_api_clients/graphiql?partnerApiClient=${clientId}&apiVersion=${apiVersion}`,
};
// ---------------------------------------------------------------------------
// API — dated versions; the tenant travels in the token, never in the path.
// ---------------------------------------------------------------------------
exports.apiPaths = {
    resource: (version, module, resource) => `/${version}/${module}/${resource}`,
    resourceItem: (version, module, resource, id) => `/${version}/${module}/${resource}/${id}`,
    graphql: (version) => `/${version}/graphql`,
    token: (version) => `/${version}/auth/token`,
    refresh: (version) => `/${version}/auth/refresh`,
    webhook: (version, topic) => `/${version}/webhooks/${topic}`,
    /** Read-only reflection of the platform registry (§36.1). */
    reflection: (version, kind) => `/${version}/platform/${kind}`,
};
// ---------------------------------------------------------------------------
// Storefront — merchant-facing public output.
// ---------------------------------------------------------------------------
exports.storefrontPaths = {
    home: () => '/',
    product: (handle) => `/products/${handle}`,
    collection: (handle) => `/collections/${handle}`,
    page: (handle) => `/pages/${handle}`,
    blogPost: (blog, post) => `/blogs/${blog}/${post}`,
    cart: () => '/cart',
    /** Localised storefront URLs use a subfolder prefix for SEO (§15.7). */
    localized: (locale, path) => `/${locale}${path}`,
};
//# sourceMappingURL=urls.js.map