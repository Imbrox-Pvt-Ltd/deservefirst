/**
 * Contracts · module-manifest.ts
 * The module manifest (§31.2) — one declaration from which the platform composes
 * every surface. If it is not declared here, the platform does not load it:
 * routes, events, permissions and entitlements exist only when declared. That is
 * the "follow the rule or nothing works" law of §14.1.
 * Layer: contracts (pure types, no framework).
 */

import type { ResourceDefinition } from './resource';

/** Semantic version string, e.g. "1.0.0". */
export type SemVer = string;

/** Every capability a module may declare. Each has a contract (see capability.ts). */
export type CapabilityKey =
  | 'entities'
  | 'resources'
  | 'routes'
  | 'navigation'
  | 'settings'
  | 'permissions'
  | 'events'
  | 'webhooks'
  | 'jobs'
  | 'search'
  | 'commands'
  | 'notifications'
  | 'integrations'
  | 'dashboards'
  | 'metrics'
  | 'seo'
  | 'ai';

/**
 * A typed dependency (§31.9). Declaring `capability` rather than just a name lets
 * an unmet *optional* dependency degrade gracefully instead of crashing (§36.2).
 */
export interface ModuleDependency {
  readonly module: string;
  readonly type: 'required' | 'optional';
  readonly version?: string;
  readonly capability?: CapabilityKey;
}

export interface PermissionDeclaration {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** Which role categories may be granted this permission (see roles.ts). */
  readonly categories: readonly string[];
}

/** A UI route contributed by the module. Screens map to §8.3 templates. */
export interface RouteDeclaration {
  readonly path: string;
  readonly screen: 'ListScreen' | 'DetailScreen' | 'CreateScreen' | 'SettingsScreen' | 'CustomScreen';
  readonly entity?: string;
  readonly permission: string;
  /** Overlay routes render above the parent, which stays mounted (§8.5). */
  readonly presentation?: 'page' | 'overlay' | 'drawer';
}

export interface NavigationDeclaration {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly section: 'primary' | 'sales-channels' | 'apps' | 'settings';
  readonly position: number;
  readonly permission: string;
  readonly children?: readonly Omit<NavigationDeclaration, 'section' | 'children'>[];
}

export type SettingFieldKind =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  | 'money' | 'date' | 'json' | 'secret';

/**
 * Schema-driven settings (§31.9): the module declares the schema, the runtime
 * generates the UI, API, validation, storage and docs — and contributes it into
 * a *shared* settings group rather than adding a page of its own.
 */
export interface SettingDeclaration {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly group: string;
  readonly section: string;
  readonly kind: SettingFieldKind;
  readonly scope: 'organization' | 'store' | 'user';
  readonly defaultValue?: unknown;
  readonly options?: readonly { value: string; label: string }[];
  readonly required?: boolean;
  readonly permission: string;
}

export interface EventDeclaration {
  /** `{context}.{aggregate}.{pastTenseVerb}` — e.g. catalog.product.published (§14.4). */
  readonly type: string;
  readonly version: number;
  readonly label: string;
  readonly description: string;
  readonly direction: 'emits' | 'consumes';
}

export interface WebhookDeclaration {
  readonly topic: string;
  readonly eventType: string;
  readonly description: string;
}

export interface JobDeclaration {
  readonly key: string;
  readonly label: string;
  /** Cron expression run by the central scheduler (§35.4) — never OS crontab. */
  readonly schedule: string;
  readonly tenantScoped: boolean;
  readonly maxAttempts: number;
}

export interface SearchProviderDeclaration {
  readonly entity: string;
  readonly indexKey: string;
  readonly permission: string;
  readonly fields: readonly string[];
}

export interface CommandDeclaration {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly permission: string;
  readonly keywords?: readonly string[];
}

export interface NotificationDeclaration {
  readonly key: string;
  readonly label: string;
  readonly eventType: string;
  readonly channels: readonly ('in-app' | 'email' | 'webhook' | 'sms')[];
  readonly audience: 'store' | 'organization' | 'platform';
}

export interface DashboardWidgetDeclaration {
  readonly id: string;
  readonly label: string;
  readonly slot: string;
  readonly permission: string;
  readonly size: 'small' | 'medium' | 'large' | 'full';
}

export interface UsageFeatureDeclaration {
  readonly key: string;
  readonly label: string;
  readonly unitLabel: string;
  readonly window: 'daily' | 'monthly' | 'billing-period';
  readonly defaultLimit: number | null;
}

export interface EntityDeclaration {
  readonly name: string;
  readonly tableName: string;
  /** Entity Toolkit opt-ins (§12.1); everything defaults on unless disabled. */
  readonly toolkit?: {
    readonly metafields?: boolean;
    readonly metaobjects?: boolean;
    readonly tags?: boolean;
    readonly timeline?: boolean;
    readonly audit?: boolean;
    readonly savedViews?: boolean;
    readonly bulkActions?: boolean;
    readonly importExport?: boolean;
    readonly softDelete?: boolean;
    readonly seo?: boolean;
  };
  readonly translatableFields?: readonly string[];
  readonly moneyFields?: readonly string[];
}

/**
 * The complete manifest. Each key is a registry the platform composes at boot;
 * declaring a capability without its required pieces fails the load loudly
 * (§31.7) rather than degrading silently.
 */
export interface ModuleManifest {
  readonly id: string;
  readonly version: SemVer;
  readonly label: string;
  readonly description: string;

  /** Gates enable/disable and billing (§5.3). */
  readonly entitlementKey: string;
  readonly dependsOn: readonly ModuleDependency[];
  readonly capabilities: readonly CapabilityKey[];

  readonly entities?: readonly EntityDeclaration[];
  readonly resources?: readonly ResourceDefinition[];
  readonly routes?: readonly RouteDeclaration[];
  readonly navigation?: readonly NavigationDeclaration[];
  readonly settings?: readonly SettingDeclaration[];
  readonly permissions?: readonly PermissionDeclaration[];
  readonly events?: readonly EventDeclaration[];
  readonly webhooks?: readonly WebhookDeclaration[];
  readonly jobs?: readonly JobDeclaration[];
  readonly searchProviders?: readonly SearchProviderDeclaration[];
  readonly commands?: readonly CommandDeclaration[];
  readonly notifications?: readonly NotificationDeclaration[];
  readonly dashboards?: readonly DashboardWidgetDeclaration[];
  readonly usageFeatures?: readonly UsageFeatureDeclaration[];

  /** Named slots this module exposes for others to extend (§31.8). */
  readonly slots?: readonly { readonly id: string; readonly description: string }[];

  readonly lifecycle?: {
    readonly startup: 'eager' | 'lazy';
  };
}
