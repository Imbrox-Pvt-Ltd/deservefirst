/**
 * Storefront · application/publish-service.ts
 * Publishing a theme: check it renders, write a version, move the pointer.
 *
 * The order is the whole safety property. A publish that wrote first and
 * checked afterwards would have already broken the store by the time it
 * noticed; checking first means the worst outcome is a merchant being told no.
 *
 *   1. gather the draft
 *   2. RENDER every affected template against it — refuse if any fails
 *   3. write an immutable version
 *   4. move the theme's pointer and its role, in one transaction
 *   5. clear the draft, announce the publish
 *
 * Step 2 is what separates this from a file copy. A theme that throws on the
 * product template is a store that cannot sell anything, and the merchant is
 * right here with the editor open — the one moment when telling them costs
 * nothing at all.
 * Layer: application.
 */

import {
  decidePublish,
  planPublish,
  planRollback,
  PublishError,
  versionRefFor,
  type PreflightResult,
  type RoleChange,
  type ThemeRecord,
  type ThemeSource,
} from '../domain';
import { createThemeEngine, defaultContext } from '../engine';
import { STOREFRONT_EVENTS } from '../events';
import { PageRenderer } from './page-renderer';
import { withDrafts, type DraftStore, type EditorSession } from './editor-service';

/**
 * Immutable storage for theme versions.
 *
 * `write` takes a full file set and a reference derived from it, so writing the
 * same content twice is the same version rather than a second copy. Nothing
 * here can modify an existing version — that is what makes a rollback a
 * pointer move rather than a restore.
 */
export interface ThemeVersionStore {
  write(themeId: string, versionRef: string, files: readonly { path: string; contents: string }[]): Promise<void>;
  /** Whether this exact content is already stored. */
  has(themeId: string, versionRef: string): Promise<boolean>;
  /** A source reading one version, for rendering a check or serving a store. */
  sourceFor(themeId: string, versionRef: string): ThemeSource & { manifest(): Promise<ReadonlySet<string>> };
}

export interface ThemeRepository {
  byId(themeId: string): Promise<ThemeRecord | null>;
  mainTheme(): Promise<ThemeRecord | null>;
  /**
   * Applies the role change in ONE transaction.
   *
   * The signature is deliberately a single call: a publish that demoted and
   * promoted in two statements has a window where a store has no live theme, or
   * two.
   */
  applyRoleChange(change: RoleChange): Promise<void>;
  history(themeId: string): Promise<readonly { versionRef: string; publishedAt: string }[]>;
}

export interface PublishResult {
  readonly versionRef: string;
  readonly preflight: PreflightResult;
  /** False when the content was identical and nothing needed writing. */
  readonly changed: boolean;
}

export class PublishService {
  constructor(
    private readonly themes: ThemeRepository,
    private readonly versions: ThemeVersionStore,
    private readonly drafts: DraftStore,
    private readonly announce: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>,
  ) {}

  /**
   * Renders the affected templates without publishing anything.
   *
   * Exposed on its own so the editor can show "this will publish cleanly"
   * before a merchant commits — the check is the valuable part, and making them
   * press publish to find out would waste it.
   */
  async preflight(session: EditorSession, files: readonly { path: string; contents: string }[]): Promise<PreflightResult> {
    const source = withDrafts(
      session.source as ThemeSource & { manifest(): Promise<ReadonlySet<string>> },
      new Map(files.map((file) => [file.path, file.contents])),
    );

    const engine = createThemeEngine(defaultContext(), { source });
    const renderer = new PageRenderer(engine, source);

    const results: {
      template: string;
      error: string | null;
      sectionFailures: { section: string; reason: string }[];
    }[] = [];

    for (const file of files) {
      if (!file.path.startsWith('templates/')) continue;
      const pageType = pageTypeOf(file.path);

      try {
        const page = await renderer.render({ pageType, scope: previewScope() });
        results.push({
          template: file.path,
          error: page.templatePath ? null : 'the theme has no template for this page',
          /**
           * Section failures are passed on with their reasons, not counted.
           *
           * `decidePublish` needs the reason to tell a theme bug from an
           * artefact of checking with no data — counting them would force it to
           * choose between blocking every real theme and blocking none.
           */
          sectionFailures: page.failures.map((failure) => ({
            section: failure.sectionType,
            reason: failure.message,
          })),
        });
      } catch (error) {
        results.push({
          template: file.path,
          error: (error as Error).message.split('\n')[0] ?? 'render failed',
          sectionFailures: [],
        });
      }
    }

    return decidePublish(results);
  }

  async publish(session: EditorSession): Promise<PublishResult> {
    const theme = await this.themes.byId(session.themeId);
    if (!theme) throw new PublishError('not_found', 'That theme no longer exists');

    const pending = await this.pendingFiles(session);
    if (pending.length === 0) {
      throw new PublishError('nothing_to_publish', 'There are no unpublished changes');
    }

    /**
     * The check, before anything is written.
     *
     * A publish that wrote first would already have broken the store by the
     * time it noticed.
     */
    const preflight = await this.preflight(session, pending);
    if (!preflight.ok) {
      throw new PublishError(
        'would_break',
        `Publishing would break ${preflight.failures.length} template(s). Nothing was changed.`,
        preflight.failures,
      );
    }

    // The full file set, not only what changed: a version must be complete or
    // it cannot be served on its own.
    const files = await this.completeFileSet(session, pending);
    const versionRef = versionRefFor(files);

    /**
     * Content-addressed, so republishing identical content writes nothing.
     *
     * A merchant who opens the editor, changes their mind and publishes anyway
     * should not create a second copy of the same bytes — and the reference
     * staying the same is what keeps the history readable.
     */
    const changed = !(await this.versions.has(session.themeId, versionRef));
    if (changed) await this.versions.write(session.themeId, versionRef, files);

    const change = planPublish(theme, await this.themes.mainTheme(), versionRef);
    await this.themes.applyRoleChange(change);

    // Only once the pointer has moved. Clearing earlier would lose a merchant's
    // work if the transaction failed.
    for (const file of pending) await this.drafts.discard(session.themeId, file.path);

    await this.announce({
      type: STOREFRONT_EVENTS.themePublished,
      payload: {
        themeId: theme.id,
        versionRef,
        previousThemeId: change.demote?.themeId ?? null,
        templates: preflight.checked,
      },
    });

    return { versionRef, preflight, changed };
  }

  /**
   * Points the live theme back at its previous version.
   *
   * The previous VERSION of the live theme, not the previously-live theme —
   * those differ when a merchant published edits to the theme that was already
   * live, which is the usual case. Rolling back should undo the edit.
   */
  async rollback(): Promise<{ themeId: string; versionRef: string }> {
    const live = await this.themes.mainTheme();
    if (!live) throw new PublishError('not_found', 'This store has no live theme');

    const target = planRollback(live, await this.themes.history(live.id));
    await this.themes.applyRoleChange({
      promote: { themeId: target.themeId, versionRef: target.versionRef },
      demote: null,
    });

    await this.announce({
      type: STOREFRONT_EVENTS.themePublished,
      payload: { themeId: target.themeId, versionRef: target.versionRef, rolledBack: true },
    });

    return target;
  }

  private async pendingFiles(session: EditorSession): Promise<readonly { path: string; contents: string }[]> {
    const paths = await this.drafts.pending(session.themeId);
    const files: { path: string; contents: string }[] = [];

    for (const path of paths) {
      const draft = await this.drafts.read(session.themeId, path);
      if (!draft) continue;
      const { serialiseTemplate } = await import('../domain');
      files.push({ path, contents: serialiseTemplate(draft) });
    }
    return files;
  }

  /**
   * Every file the version needs: the theme's own, with the draft overlaid.
   *
   * A version holding only the changed templates could not be served by itself,
   * so rolling back to it would produce a store with no layout.
   */
  private async completeFileSet(
    session: EditorSession,
    pending: readonly { path: string; contents: string }[],
  ): Promise<readonly { path: string; contents: string }[]> {
    const source = session.source as ThemeSource & { manifest(): Promise<ReadonlySet<string>> };
    const overlay = new Map(pending.map((file) => [file.path, file.contents]));
    const files: { path: string; contents: string }[] = [];

    for (const path of await source.manifest()) {
      const contents = overlay.get(path) ?? (await source.read(path));
      if (contents !== null && contents !== undefined) files.push({ path, contents });
    }

    // A draft for a template the theme does not have yet is still part of it.
    for (const [path, contents] of overlay) {
      if (!files.some((file) => file.path === path)) files.push({ path, contents });
    }

    return files;
  }
}

/** `templates/product.wholesale.json` → `product`. */
function pageTypeOf(path: string): never {
  const file = path.split('/').pop() ?? '';
  return (file.replace(/\.(json|liquid)$/, '').split('.')[0] ?? 'index') as never;
}

/**
 * Enough scope for a template to render during a check.
 *
 * Deliberately empty of records: the check asks "does this template parse and
 * execute", not "does it look right with real data". Loading a product would
 * make the check depend on the catalogue having one, so a new store could never
 * publish.
 */
function previewScope(): Record<string, unknown> {
  return {
    shop: { name: 'Preview', domain: 'preview.test', currency: 'USD' },
    settings: {},
    request: { path: '/', page_type: 'index', design_mode: true },
  };
}
