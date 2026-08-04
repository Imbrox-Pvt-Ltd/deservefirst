/**
 * Core · module-registry/registry.ts
 * The Platform Registry (§31.1) — one queryable index of everything every module
 * contributes. Modules publish metadata; the runtime discovers, validates and
 * composes. Nothing is hardcoded in a central file, and nothing loads that was
 * not declared.
 * Layer: core.
 */

import {
  assertManifestValid,
  type CommandDeclaration,
  type DashboardWidgetDeclaration,
  type EventDeclaration,
  type JobDeclaration,
  type ModuleManifest,
  type NavigationDeclaration,
  type PermissionDeclaration,
  type ResourceDefinition,
  type RouteDeclaration,
  type SearchProviderDeclaration,
  type SettingDeclaration,
  type WebhookDeclaration,
} from '@deservefirst/contracts';

export interface RegisteredModule {
  readonly manifest: ModuleManifest;
  /** Set false when an optional dependency is unmet — the module degrades (§36.2). */
  readonly enabled: boolean;
  readonly degradedReason: string | null;
}

export class ModuleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleRegistryError';
  }
}

/**
 * Holds every module's metadata and answers questions about the composed whole.
 * Registration is validated eagerly: a manifest that fails its capability
 * contracts throws here rather than producing a module that silently does
 * nothing (§31.7).
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>();
  private sealed = false;

  register(manifest: ModuleManifest): void {
    if (this.sealed) {
      throw new ModuleRegistryError(
        `Cannot register "${manifest.id}" after the registry is sealed — modules are discovered at boot, not at runtime.`,
      );
    }
    if (this.modules.has(manifest.id)) {
      throw new ModuleRegistryError(`Module "${manifest.id}" is already registered.`);
    }

    assertManifestValid(manifest);
    this.modules.set(manifest.id, { manifest, enabled: true, degradedReason: null });
  }

  /**
   * Resolves dependencies and freezes the registry. A missing *required*
   * dependency is fatal; a missing *optional* one degrades that module so the
   * platform still starts (§31.9, §36.2).
   */
  seal(): readonly RegisteredModule[] {
    const problems: string[] = [];

    for (const [id, entry] of this.modules) {
      for (const dependency of entry.manifest.dependsOn) {
        if (dependency.module === 'core' || dependency.module === 'auth') continue;

        const target = this.modules.get(dependency.module);
        if (target) {
          if (dependency.capability && !target.manifest.capabilities.includes(dependency.capability)) {
            const message = `module "${id}" needs capability "${dependency.capability}" from "${dependency.module}", which does not declare it`;
            if (dependency.type === 'required') problems.push(message);
            else this.degrade(id, message);
          }
          continue;
        }

        const message = `module "${id}" depends on "${dependency.module}", which is not registered`;
        if (dependency.type === 'required') problems.push(message);
        else this.degrade(id, message);
      }
    }

    if (problems.length > 0) {
      throw new ModuleRegistryError(
        'Refusing to start — unmet required dependencies:\n' +
          problems.map((problem) => `  · ${problem}`).join('\n'),
      );
    }

    this.assertNoRouteCollisions();
    this.sealed = true;
    return [...this.modules.values()];
  }

  private degrade(moduleId: string, reason: string): void {
    const entry = this.modules.get(moduleId);
    if (!entry) return;
    this.modules.set(moduleId, { manifest: entry.manifest, enabled: false, degradedReason: reason });
  }

  /**
   * Two modules claiming the same path would make routing order-dependent, which
   * is the class of bug that only shows up after a deploy reorders discovery.
   */
  private assertNoRouteCollisions(): void {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const entry of this.modules.values()) {
      for (const route of entry.manifest.routes ?? []) {
        const owner = seen.get(route.path);
        if (owner && owner !== entry.manifest.id) {
          collisions.push(`"${route.path}" claimed by both "${owner}" and "${entry.manifest.id}"`);
        } else {
          seen.set(route.path, entry.manifest.id);
        }
      }
    }

    if (collisions.length > 0) {
      throw new ModuleRegistryError(
        'Route collisions across modules:\n' + collisions.map((c) => `  · ${c}`).join('\n'),
      );
    }
  }

  get(moduleId: string): RegisteredModule | undefined {
    return this.modules.get(moduleId);
  }

  all(): readonly RegisteredModule[] {
    return [...this.modules.values()];
  }

  enabled(): readonly RegisteredModule[] {
    return this.all().filter((entry) => entry.enabled);
  }

  // --- composed views -------------------------------------------------------
  // Each returns the union across enabled modules, tagged with its owner, which
  // is what makes the registry queryable rather than merely a store.

  private collect<T>(pick: (manifest: ModuleManifest) => readonly T[] | undefined) {
    return this.enabled().flatMap((entry) =>
      (pick(entry.manifest) ?? []).map((item) => ({ moduleId: entry.manifest.id, item })),
    );
  }

  routes(): readonly { moduleId: string; item: RouteDeclaration }[] {
    return this.collect((manifest) => manifest.routes);
  }

  navigation(): readonly { moduleId: string; item: NavigationDeclaration }[] {
    return this.collect((manifest) => manifest.navigation).sort(
      (a, b) => a.item.position - b.item.position,
    );
  }

  permissions(): readonly { moduleId: string; item: PermissionDeclaration }[] {
    return this.collect((manifest) => manifest.permissions);
  }

  settings(): readonly { moduleId: string; item: SettingDeclaration }[] {
    return this.collect((manifest) => manifest.settings);
  }

  events(): readonly { moduleId: string; item: EventDeclaration }[] {
    return this.collect((manifest) => manifest.events);
  }

  webhooks(): readonly { moduleId: string; item: WebhookDeclaration }[] {
    return this.collect((manifest) => manifest.webhooks);
  }

  jobs(): readonly { moduleId: string; item: JobDeclaration }[] {
    return this.collect((manifest) => manifest.jobs);
  }

  searchProviders(): readonly { moduleId: string; item: SearchProviderDeclaration }[] {
    return this.collect((manifest) => manifest.searchProviders);
  }

  commands(): readonly { moduleId: string; item: CommandDeclaration }[] {
    return this.collect((manifest) => manifest.commands);
  }

  dashboards(): readonly { moduleId: string; item: DashboardWidgetDeclaration }[] {
    return this.collect((manifest) => manifest.dashboards);
  }

  resources(): readonly { moduleId: string; item: ResourceDefinition }[] {
    return this.collect((manifest) => manifest.resources);
  }

  /**
   * Every STORE-scoped table, for the isolation check and the query guard.
   * Organization- and platform-scoped tables are deliberately excluded: making
   * the guard demand a store predicate on the users table would break every
   * login.
   */
  storeScopedTables(): readonly string[] {
    return this.enabled().flatMap((entry) =>
      (entry.manifest.entities ?? [])
        .filter((entity) => (entity.scope ?? 'store') === 'store')
        .map((entity) => entity.tableName),
    );
  }

  /**
   * Which extensions target a named slot (§31.8). The host page asks; the engine
   * resolves. A module adds a tab to another module's screen without touching
   * its code, and the aggregate stays owned by its module.
   */
  widgetsForSlot(slot: string): readonly { moduleId: string; item: DashboardWidgetDeclaration }[] {
    return this.dashboards().filter((entry) => entry.item.slot === slot);
  }
}
