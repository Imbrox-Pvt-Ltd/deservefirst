/**
 * Storefront · application/editor-service.ts
 * Reading a theme into something the editor can draw, and saving what changed.
 *
 * Two jobs the pure model deliberately does not do.
 *
 * **Reading schemas out of the theme.** A section's settings live inside a
 * `{% schema %}` block in a `.liquid` file. The editor needs every one of them
 * to draw its panels, so they are extracted and cached per theme — parsing four
 * hundred Liquid files on each keystroke is not a thing to do lazily.
 *
 * **The draft.** Editing must never touch what customers see. A merchant
 * dragging sections around is working on a draft; the live theme changes only
 * when they publish. That is also what makes the preview honest — it renders
 * the draft, so what they see is what they would ship.
 * Layer: application.
 */

import {
  allowedInGroup,
  allowedOnTemplate,
  applyEdit,
  parseJsonTemplate,
  serialiseTemplate,
  type EditRequest,
  type SchemaLookup,
  type SectionSchema,
  type TemplateDocument,
  type ThemeSource,
} from '../domain';

/**
 * Pulls the `{% schema %}` blocks out of a theme's sections.
 *
 * A tolerant reader on purpose: one section with malformed JSON must not stop
 * the editor opening. That section is reported unusable and the other seventy
 * still work, which is the difference between "fix this section" and "the
 * editor is broken".
 */
export class ThemeSchemas implements SchemaLookup {
  private readonly schemas = new Map<string, SectionSchema>();
  private readonly failures = new Map<string, string>();

  private constructor() {}

  static async read(source: ThemeSource): Promise<ThemeSchemas> {
    const catalogue = new ThemeSchemas();

    for (const file of await source.list('sections')) {
      if (!file.endsWith('.liquid')) continue;
      const type = file.replace(/\.liquid$/, '');
      const liquid = await source.read(`sections/${file}`);
      if (liquid === null) continue;

      const block = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(liquid);
      if (!block) {
        /**
         * A section with no schema is not broken — it is a section a merchant
         * cannot configure, which some themes use for fixed layout pieces. It
         * simply does not appear in "add section".
         */
        continue;
      }

      try {
        catalogue.schemas.set(type, JSON.parse(block[1] as string) as SectionSchema);
      } catch (error) {
        catalogue.failures.set(type, (error as Error).message);
      }
    }

    return catalogue;
  }

  schemaFor(sectionType: string): SectionSchema | undefined {
    return this.schemas.get(sectionType);
  }

  /** Sections a merchant may add, with what the picker needs to show them. */
  addable(templateName: string): readonly {
    type: string;
    name: string;
    presets: readonly string[];
  }[] {
    const offered: { type: string; name: string; presets: readonly string[] }[] = [];

    for (const [type, schema] of this.schemas) {
      /**
       * Only sections with a preset are offered.
       *
       * That is the theme author's own signal: a preset says "this is
       * something a merchant adds", and its absence says "this is placed by the
       * template". Offering everything would fill the picker with pieces that
       * render nothing on their own.
       */
      if (!schema.presets?.length) continue;
      if (!allowedOnTemplate(schema, templateName)) continue;

      offered.push({
        type,
        name: schema.name,
        presets: schema.presets.map((preset) => preset.name),
      });
    }

    return offered.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Sections a merchant may add to a named group — a header or a footer.
   *
   * A separate question from `addable`, and the reference theme proves it is
   * not academic: all 55 of its placement rules are about groups, and nine
   * sections are group-only. Asking the template question about a group would
   * offer none of them.
   */
  addableToGroup(group: string): readonly { type: string; name: string; presets: readonly string[] }[] {
    const offered: { type: string; name: string; presets: readonly string[] }[] = [];
    for (const [type, schema] of this.schemas) {
      if (!schema.presets?.length) continue;
      if (!allowedInGroup(schema, group)) continue;
      offered.push({ type, name: schema.name, presets: schema.presets.map((p) => p.name) });
    }
    return offered.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Sections whose schema could not be read, so the editor can say so. */
  unusable(): readonly { type: string; reason: string }[] {
    return [...this.failures].map(([type, reason]) => ({ type, reason }));
  }
}

/**
 * Where a merchant's unsaved work lives.
 *
 * Keyed by theme and template, held apart from the theme's own files. A draft
 * written into the theme directly would be visible to customers the moment it
 * was saved, which is the one thing the editor must never do.
 */
export interface DraftStore {
  read(themeId: string, templatePath: string): Promise<TemplateDocument | null>;
  write(themeId: string, document: TemplateDocument): Promise<void>;
  discard(themeId: string, templatePath: string): Promise<void>;
  /** Every template with unsaved changes, for the "you have edits" banner. */
  pending(themeId: string): Promise<readonly string[]>;
}

export interface EditorSession {
  readonly themeId: string;
  readonly source: ThemeSource;
}

export class EditorService {
  constructor(
    private readonly drafts: DraftStore,
    private readonly newId: () => string,
  ) {}

  /**
   * The document the editor should show: the draft if there is one, else the
   * theme's own file.
   *
   * Draft-first, so reopening the editor shows what the merchant was doing
   * rather than discarding it — an editor that forgot unsaved work on refresh
   * is one people learn not to trust.
   */
  async open(session: EditorSession, templatePath: string): Promise<TemplateDocument> {
    const draft = await this.drafts.read(session.themeId, templatePath);
    if (draft) return draft;

    const source = await session.source.read(templatePath);
    if (source === null) {
      throw new Error(`${templatePath} does not exist in this theme`);
    }

    const parsed = parseJsonTemplate(templatePath, source);
    return { templatePath, sections: parsed.sections, version: 1 };
  }

  /** Applies one edit and keeps it as a draft. */
  async edit(
    session: EditorSession,
    templatePath: string,
    request: EditRequest,
    schemas: SchemaLookup,
  ): Promise<TemplateDocument> {
    const current = await this.open(session, templatePath);
    const next = applyEdit(current, request, schemas, this.newId);
    await this.drafts.write(session.themeId, next);
    return next;
  }

  async discard(session: EditorSession, templatePath: string): Promise<void> {
    await this.drafts.discard(session.themeId, templatePath);
  }

  /**
   * The file contents a save would write, for every changed template.
   *
   * Returned rather than written, because writing theme files is the caller's
   * business — and because seeing the diff before it lands is what makes a
   * review step possible.
   */
  async pendingFiles(session: EditorSession): Promise<readonly { path: string; contents: string }[]> {
    const paths = await this.drafts.pending(session.themeId);
    const files: { path: string; contents: string }[] = [];

    for (const path of paths) {
      const draft = await this.drafts.read(session.themeId, path);
      if (draft) files.push({ path, contents: serialiseTemplate(draft) });
    }

    return files;
  }
}

/**
 * A draft store in memory.
 *
 * The editor's own preview and the tests use it. A durable one keyed the same
 * way is a drop-in replacement; nothing above knows the difference.
 */
export class InMemoryDraftStore implements DraftStore {
  private readonly documents = new Map<string, TemplateDocument>();

  private key(themeId: string, templatePath: string): string {
    return `${themeId} ${templatePath}`;
  }

  async read(themeId: string, templatePath: string): Promise<TemplateDocument | null> {
    return this.documents.get(this.key(themeId, templatePath)) ?? null;
  }

  async write(themeId: string, document: TemplateDocument): Promise<void> {
    this.documents.set(this.key(themeId, document.templatePath), document);
  }

  async discard(themeId: string, templatePath: string): Promise<void> {
    this.documents.delete(this.key(themeId, templatePath));
  }

  async pending(themeId: string): Promise<readonly string[]> {
    const prefix = `${themeId} `;
    return [...this.documents.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }
}

/**
 * A theme source that serves a draft template in place of the saved one.
 *
 * This is how the preview renders unsaved work without writing anything a
 * customer could reach: the renderer asks for `templates/index.json` and gets
 * the draft, while every other file comes from the real theme untouched.
 *
 * Wrapping rather than copying matters — a preview that duplicated the theme
 * would drift from it the moment anything else changed.
 */
export function withDrafts(
  source: ThemeSource & { manifest(): Promise<ReadonlySet<string>> },
  drafts: ReadonlyMap<string, string>,
): ThemeSource & { manifest(): Promise<ReadonlySet<string>> } {
  return {
    async read(path) {
      return drafts.get(path) ?? source.read(path);
    },
    async exists(path) {
      return drafts.has(path) || source.exists(path);
    },
    list: (directory) => source.list(directory),
    async manifest() {
      const manifest = new Set(await source.manifest());
      // A draft for a template the theme does not have yet must still resolve,
      // or a merchant cannot preview a template they just created.
      for (const path of drafts.keys()) manifest.add(path);
      return manifest;
    },
  };
}
