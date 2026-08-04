/**
 * Core · dashboard/dashboard.service.ts
 * Composes a dashboard from whatever the loaded modules contribute (§31.2).
 *
 * Home is not a screen that knows about products, requests and stock. It is a
 * slot, and the modules that own those things declare what belongs in it. That
 * is the same argument as navigation and settings, applied to the first screen
 * a merchant sees: enabling a module makes its card appear, disabling one makes
 * it vanish, and nobody edits a dashboard file to make either happen.
 *
 * A widget resolves to a NUMBER the module computes. Core never queries a
 * module's tables to build a card — that would be the one place in the platform
 * where the boundary is crossed for convenience, and it is exactly how "one
 * quick join" becomes the reason a module cannot be removed.
 * Layer: core.
 */

import type { DashboardWidgetDeclaration, StoreId } from '@deservefirst/contracts';

import type { ModuleRegistry } from '../module-registry/registry';

/** What a module supplies to answer its own widgets. */
export interface MetricProvider {
  readonly moduleId: string;
  /** Metric key → the value, for the store in the active request context. */
  readonly metrics: Readonly<Record<string, () => Promise<number>>>;
}

export interface ResolvedWidget {
  readonly id: string;
  readonly moduleId: string;
  readonly label: string;
  readonly description: string | null;
  readonly size: DashboardWidgetDeclaration['size'];
  readonly format: NonNullable<DashboardWidgetDeclaration['format']>;
  readonly href: string | null;
  /** Null when the metric could not be produced — see below. */
  readonly value: number | null;
  /** Set when the value is null, so the card can say why rather than show a gap. */
  readonly unavailable: string | null;
}

export interface DashboardOptions {
  readonly registry: ModuleRegistry;
  readonly providers: readonly MetricProvider[];
  /** Whether this module is available to this store right now. */
  isModuleAvailable(storeId: StoreId, moduleId: string): Promise<boolean>;
}

export class DashboardService {
  constructor(private readonly options: DashboardOptions) {}

  /**
   * The widgets for one slot, in order, for one store and one set of grants.
   *
   * Three filters, and each removes a different kind of "should not be here":
   * the module must be available to this store, the viewer must hold the
   * permission, and the metric must actually resolve.
   */
  async compose(
    slot: string,
    storeId: StoreId,
    permissions: ReadonlySet<string>,
  ): Promise<readonly ResolvedWidget[]> {
    const declared = this.options.registry
      .dashboards()
      .filter((entry) => entry.item.slot === slot);

    const byModule = new Map(this.options.providers.map((provider) => [provider.moduleId, provider]));
    const resolved: ResolvedWidget[] = [];

    for (const entry of declared) {
      if (!permissions.has(entry.item.permission)) continue;
      if (!(await this.options.isModuleAvailable(storeId, entry.moduleId))) continue;

      resolved.push(await this.resolve(entry.moduleId, entry.item, byModule.get(entry.moduleId)));
    }

    return resolved.sort(
      (a, b) => positionOf(declared, a) - positionOf(declared, b) || a.label.localeCompare(b.label),
    );
  }

  private async resolve(
    moduleId: string,
    widget: DashboardWidgetDeclaration,
    provider: MetricProvider | undefined,
  ): Promise<ResolvedWidget> {
    const base = {
      id: widget.id,
      moduleId,
      label: widget.label,
      description: widget.description ?? null,
      size: widget.size,
      format: widget.format ?? ('number' as const),
      href: widget.href ?? null,
    };

    const metric = widget.metric ? provider?.metrics[widget.metric] : undefined;
    if (!metric) {
      return {
        ...base,
        value: null,
        unavailable: widget.metric
          ? `The ${moduleId} module declares this widget but supplies no "${widget.metric}" metric.`
          : 'This widget declares no metric.',
      };
    }

    try {
      return { ...base, value: await metric(), unavailable: null };
    } catch (error) {
      // One failing metric must not take the dashboard down. A card that says
      // it could not load is honest; a blank page because stock counting threw
      // makes the whole admin look broken.
      return {
        ...base,
        value: null,
        unavailable: error instanceof Error ? error.message : 'Could not be calculated.',
      };
    }
  }
}

function positionOf(
  declared: readonly { item: DashboardWidgetDeclaration }[],
  widget: ResolvedWidget,
): number {
  const found = declared.find((entry) => entry.item.id === widget.id);
  return found?.item.position ?? 500;
}
