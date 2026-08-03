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
export type HostKey = 'marketing' | 'accounts' | 'admin' | 'partners' | 'developers' | 'api' | 'storefront';
export declare const authPaths: {
    readonly home: () => string;
    readonly login: (options?: {
        loginHint?: string;
        returnPath?: string;
    }) => string;
    /** Step 2 of the login chain; `rid` correlates every step of one attempt. */
    readonly loginLookup: (rid: string) => string;
    readonly loginTwoFactor: (rid: string, method?: "app" | "sms" | "email") => string;
    readonly logout: () => string;
    readonly signup: () => string;
    readonly passwordForgot: () => string;
    readonly passwordReset: (token: string) => string;
    readonly verifyEmail: (token: string) => string;
    readonly acceptInvite: (token: string) => string;
    readonly oauthStart: (provider: string) => string;
    readonly oauthCallback: (provider: string) => string;
    /** Step-up verification when an action needs fresh proof of identity. */
    readonly challenge: (token: string) => string;
};
export declare const accountPaths: {
    readonly overview: (accountId: string) => string;
    readonly personal: (accountId: string) => string;
    readonly security: (accountId: string) => string;
    /** 2FA enrolment is deep-linked by fragment, as the reference product does. */
    readonly enrollTwoFactor: (accountId: string) => string;
    readonly passkeys: (accountId: string) => string;
    readonly sessions: (accountId: string) => string;
    readonly notifications: (accountId: string) => string;
    readonly connectedAccounts: (accountId: string) => string;
    readonly stores: (accountId: string) => string;
    readonly createStore: (accountId: string) => string;
    readonly close: (accountId: string) => string;
};
export declare const organizationPaths: {
    readonly root: (orgId: string) => string;
    readonly details: (orgId: string) => string;
    readonly users: (orgId: string) => string;
    readonly user: (orgId: string, userId: string) => string;
    readonly addUser: (orgId: string) => string;
    readonly roles: (orgId: string) => string;
    readonly addRole: (orgId: string) => string;
    readonly role: (orgId: string, roleId: string) => string;
    readonly security: (orgId: string) => string;
    readonly businessEntities: (orgId: string) => string;
    readonly businessEntity: (orgId: string, entityId: string) => string;
    readonly createStore: (orgId: string) => string;
};
export declare const storePaths: {
    readonly root: (handle: string) => string;
    readonly search: (h: string) => string;
    readonly notifications: (h: string) => string;
    readonly activity: (h: string) => string;
    readonly orders: (h: string) => string;
    readonly order: (h: string, id: string) => string;
    readonly draftOrders: (h: string) => string;
    readonly draftOrderNew: (h: string) => string;
    readonly draftOrder: (h: string, id: string) => string;
    readonly shippingLabels: (h: string) => string;
    readonly abandonedCheckouts: (h: string) => string;
    readonly products: (h: string) => string;
    readonly productNew: (h: string) => string;
    readonly product: (h: string, id: string) => string;
    readonly productVariant: (h: string, id: string, variantId: string) => string;
    readonly productVariantNew: (h: string, id: string) => string;
    readonly collections: (h: string) => string;
    readonly collectionNew: (h: string) => string;
    readonly collection: (h: string, id: string) => string;
    readonly inventory: (h: string, locationId?: string) => string;
    readonly purchaseOrders: (h: string) => string;
    readonly purchaseOrderNew: (h: string) => string;
    readonly purchaseOrder: (h: string, id: string) => string;
    readonly transfers: (h: string) => string;
    readonly transfer: (h: string, id: string) => string;
    readonly giftCards: (h: string) => string;
    readonly customers: (h: string) => string;
    readonly customerNew: (h: string) => string;
    readonly customer: (h: string, id: string) => string;
    readonly customerSegments: (h: string) => string;
    readonly customerSegment: (h: string, id: string) => string;
    readonly companies: (h: string) => string;
    readonly companyNew: (h: string) => string;
    readonly company: (h: string, id: string) => string;
    readonly growth: (h: string) => string;
    readonly discounts: (h: string) => string;
    readonly markets: (h: string) => string;
    readonly finance: (h: string) => string;
    readonly analytics: (h: string) => string;
    readonly content: (h: string) => string;
    readonly metaobjects: (h: string) => string;
    readonly metaobject: (h: string, id: string) => string;
    readonly pages: (h: string) => string;
    readonly pageNew: (h: string) => string;
    readonly page: (h: string, id: string) => string;
    readonly blogPost: (h: string, blogId: string, postId: string) => string;
    readonly navigation: (h: string) => string;
    readonly onlineStore: (h: string) => string;
    readonly themes: (h: string) => string;
    readonly themeEditor: (h: string, id: string) => string;
    /** AI-agent sales channel (PLAN/01 §5). */
    readonly agentic: (h: string) => string;
    readonly services: (h: string) => string;
    readonly service: (h: string, moduleId: string) => string;
    readonly serviceSubscribe: (h: string, moduleId: string) => string;
    /**
     * The generic bulk editor. One screen serves every entity, parameterised by the
     * editable field set, with an explicit return path.
     */
    readonly bulkEdit: (h: string, entity: string, fields: readonly string[], returnTo: string) => string;
};
/** The section list, in the order the settings rail renders them. */
export declare const SETTINGS_SECTIONS: readonly ["general", "plan", "billing", "payments", "checkout", "customer_accounts", "shipping", "taxes", "locations", "markets", "apps", "sales_channels", "domains", "customer_events", "notifications", "custom_data", "languages", "privacy", "policies"];
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export declare const settingsPaths: {
    readonly root: (handle: string) => string;
    readonly section: (h: string, section: SettingsSection) => string;
    readonly general: (h: string) => string;
    readonly storeContactDetails: (h: string) => string;
    readonly branding: (h: string) => string;
    readonly plan: (h: string) => string;
    readonly selectPlan: (h: string) => string;
    readonly billing: (h: string) => string;
    readonly invoices: (h: string) => string;
    readonly invoice: (h: string, id: string) => string;
    readonly usage: (h: string) => string;
    readonly payments: (h: string) => string;
    readonly checkout: (h: string) => string;
    readonly customerAccounts: (h: string) => string;
    readonly shipping: (h: string) => string;
    readonly shippingProfile: (h: string, id: string) => string;
    readonly taxes: (h: string) => string;
    readonly locations: (h: string) => string;
    readonly markets: (h: string) => string;
    readonly apps: (h: string) => string;
    readonly app: (h: string, id: string) => string;
    readonly salesChannels: (h: string) => string;
    readonly domains: (h: string) => string;
    readonly connectDomain: (h: string) => string;
    readonly domainVerification: (h: string, id: string) => string;
    readonly customerEvents: (h: string) => string;
    readonly customPixel: (h: string, id: string) => string;
    readonly notifications: (h: string) => string;
    readonly customerNotifications: (h: string) => string;
    /** Metafield & metaobject definitions — generic over entity (§12.1). */
    readonly customData: (h: string) => string;
    readonly entityMetafields: (h: string, entity: string) => string;
    readonly createMetafieldDefinition: (h: string, entity: string) => string;
    readonly metaobjectDefinitions: (h: string) => string;
    readonly languages: (h: string) => string;
    readonly privacy: (h: string) => string;
    readonly policies: (h: string) => string;
    readonly cancelReturnRules: (h: string, id: string) => string;
    readonly users: (h: string) => string;
    readonly inviteUser: (h: string) => string;
    readonly user: (h: string, id: string) => string;
    readonly userPermissions: (h: string, id: string) => string;
    readonly roles: (h: string) => string;
    readonly role: (h: string, id: string) => string;
    readonly developer: (h: string) => string;
    readonly apiKeys: (h: string) => string;
    readonly webhooks: (h: string) => string;
    readonly eventLog: (h: string) => string;
    readonly account: (h: string) => string;
    /** Org-scoped screens are mirrored into the store settings tree. */
    readonly organizationDetails: (h: string) => string;
    readonly organizationAccount: (h: string) => string;
};
export declare const developerPaths: {
    readonly root: (orgId: string) => string;
    readonly stores: (orgId: string, storeType?: "dev" | "client_transfer") => string;
    readonly catalogs: (orgId: string) => string;
    readonly apps: (orgId: string) => string;
    readonly appNew: (orgId: string) => string;
    readonly app: (orgId: string, appId: string) => string;
    readonly appSettings: (orgId: string, appId: string) => string;
    readonly appVersions: (orgId: string, appId: string) => string;
    readonly appVersionNew: (orgId: string, appId: string) => string;
    readonly appLogs: (orgId: string, appId: string) => string;
    readonly appApiHealth: (orgId: string, appId: string) => string;
    readonly appWebhookMonitoring: (orgId: string, appId: string) => string;
    readonly appFunctionMonitoring: (orgId: string, appId: string) => string;
};
/** App log event taxonomy, mirrored from the reference product's filter list. */
export declare const APP_LOG_TYPES: readonly ["webhook", "function", "app-event", "app-billing-event", "graphql-request", "rest-request", "ui-extension-error", "assistant-event"];
export type AppLogType = (typeof APP_LOG_TYPES)[number];
export declare const partnerPaths: {
    readonly root: (partnerId: string) => string;
    readonly stores: (p: string) => string;
    readonly storeNew: (p: string) => string;
    readonly store: (p: string, handle: string) => string;
    readonly apps: (p: string) => string;
    readonly app: (p: string, appId: string) => string;
    readonly leads: (p: string) => string;
    readonly leadNew: (p: string, kind: "plus" | "pos" | "b2b") => string;
    readonly referralHistory: (p: string) => string;
    readonly payouts: (p: string) => string;
    readonly team: (p: string) => string;
    readonly teamMember: (p: string, id: string) => string;
    readonly settings: (p: string) => string;
    readonly apiClients: (p: string) => string;
    readonly apiClientNew: (p: string) => string;
    readonly apiClient: (p: string, id: string) => string;
    /** Dated GraphQL explorer bound to one API client — dogfooding the schema (§26.5). */
    readonly graphiql: (p: string, clientId: string, apiVersion: string) => string;
};
export declare const apiPaths: {
    readonly resource: (version: string, module: string, resource: string) => string;
    readonly resourceItem: (version: string, module: string, resource: string, id: string) => string;
    readonly graphql: (version: string) => string;
    readonly token: (version: string) => string;
    readonly refresh: (version: string) => string;
    readonly webhook: (version: string, topic: string) => string;
    /** Read-only reflection of the platform registry (§36.1). */
    readonly reflection: (version: string, kind: "modules" | "entities" | "settings" | "capabilities" | "runtime") => string;
};
export declare const storefrontPaths: {
    readonly home: () => string;
    readonly product: (handle: string) => string;
    readonly collection: (handle: string) => string;
    readonly page: (handle: string) => string;
    readonly blogPost: (blog: string, post: string) => string;
    readonly cart: () => string;
    /** Localised storefront URLs use a subfolder prefix for SEO (§15.7). */
    readonly localized: (locale: string, path: string) => string;
};
//# sourceMappingURL=urls.d.ts.map