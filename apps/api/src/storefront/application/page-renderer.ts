/**
 * Storefront · application/page-renderer.ts
 * Turning a request into a page: resolve, render sections, wrap in the layout.
 *
 * The order is the whole design. A JSON template is a list of sections, each
 * rendered on its own, joined into `content_for_layout`, and that string is what
 * the layout receives. A theme author never assembles a page; they write
 * sections and a layout, and the merchant decides the order between them.
 *
 * One section failing does not take the page down. A theme is untrusted code
 * and a section is the unit a merchant added, so a broken one renders as a
 * comment and the other nine still ship — a storefront missing its testimonials
 * is a bug report, and a storefront serving a 500 is lost revenue. The failure
 * is returned alongside the html rather than swallowed, so the caller can log it
 * and the editor can show it.
 * Layer: application.
 */

import {
  parseJsonTemplate,
  parseSectionGroup,
  resolveTemplate,
  type PageType,
  type TemplateSection,
} from '../domain/template-resolution';
import { resolveFontSettings } from '../domain/font-handle';
import type { ThemeSource } from '../domain/theme-source';
import type { ThemeEngine } from '../engine';

export interface PageRequest {
  readonly pageType: PageType;
  /** The merchant's template suffix for this record, if any. */
  readonly suffix?: string | null;
  /** Drops and globals the page is rendered against. */
  readonly scope: Record<string, unknown>;
}

export interface SectionFailure {
  readonly sectionId: string;
  readonly sectionType: string;
  readonly message: string;
}

export interface RenderedPage {
  readonly html: string;
  /** Which template was chosen, for logging and for the editor. */
  readonly templatePath: string | null;
  readonly considered: readonly string[];
  readonly missingSuffix?: string;
  readonly failures: readonly SectionFailure[];
}

export interface PageRendererOptions {
  /**
   * Whether a failing section explains itself in the markup.
   *
   * On in development and in the editor, off in production: a comment naming a
   * Liquid error is exactly what a theme developer needs and exactly what a
   * customer should never see.
   */
  readonly explainFailures?: boolean;
}

export class PageRenderer {
  constructor(
    private readonly engine: ThemeEngine,
    private readonly source: ThemeSource & { manifest(): Promise<ReadonlySet<string>> },
    private readonly options: PageRendererOptions = {},
  ) {}

  async render(request: PageRequest): Promise<RenderedPage> {
    const available = await this.source.manifest();
    const choice = resolveTemplate(
      { pageType: request.pageType, suffix: request.suffix ?? null },
      available,
    );

    const failures: SectionFailure[] = [];

    if (!choice.path) {
      // No template at all. The theme is incomplete rather than the request
      // being wrong, so it is reported as such instead of rendering a 404 page
      // the theme also does not have.
      return {
        html: '',
        templatePath: null,
        considered: choice.considered,
        ...(choice.missingSuffix ? { missingSuffix: choice.missingSuffix } : {}),
        failures: [
          {
            sectionId: '',
            sectionType: request.pageType,
            message: `no template for "${request.pageType}" (looked for ${choice.considered.join(', ')})`,
          },
        ],
      };
    }

    const source = await this.source.read(choice.path);
    if (source === null) {
      throw new Error(`${choice.path} was listed by the theme but could not be read`);
    }

    let body: string;
    let layoutPath: string | null = 'layout/theme.liquid';

    if (choice.format === 'json') {
      const template = parseJsonTemplate(choice.path, source);
      layoutPath = template.layout;
      body = await this.renderSections(template.sections, request.scope, failures);
    } else {
      // A Liquid template is the page body directly — the pre-2.0 model, still
      // valid and still used for `404` and `gift_card` in most themes.
      body = await this.renderOne(
        () => this.engine.renderFile(choice.path as string, request.scope),
        { id: choice.path, type: 'template' },
        failures,
      );
    }

    if (!layoutPath) return this.done(body, choice, failures);

    const layoutSource = await this.source.read(layoutPath);
    if (layoutSource === null) {
      // A template naming a layout the theme lacks. The body is real, so it is
      // served rather than discarded, and the failure says what was missing.
      failures.push({
        sectionId: '',
        sectionType: 'layout',
        message: `layout "${layoutPath}" does not exist in this theme`,
      });
      return this.done(body, choice, failures);
    }

    const html = await this.renderOne(
      () =>
        this.engine.renderFile(layoutPath as string, {
          ...request.scope,
          content_for_layout: body,
          content_for_header: request.scope.content_for_header ?? '',
        }),
      { id: layoutPath, type: 'layout' },
      failures,
    );

    return this.done(html, choice, failures);
  }

  /**
   * Renders a named section group — a header or footer shared by every page.
   *
   * Exposed separately because the layout asks for these through
   * `{% sections %}` rather than the template listing them.
   */
  async renderSectionGroup(
    name: string,
    scope: Record<string, unknown>,
  ): Promise<{ html: string; failures: readonly SectionFailure[] }> {
    const path = `sections/${name}.json`;
    const source = await this.source.read(path);
    if (source === null) return { html: '', failures: [] };

    const failures: SectionFailure[] = [];
    const html = await this.renderSections(parseSectionGroup(path, source), scope, failures);
    return { html, failures };
  }

  private async renderSections(
    sections: readonly TemplateSection[],
    scope: Record<string, unknown>,
    failures: SectionFailure[],
  ): Promise<string> {
    const rendered: string[] = [];

    for (const [index, section] of sections.entries()) {
      // A disabled section is one the merchant switched off in the editor. It
      // stays in the file so its settings survive being switched back on.
      if (section.disabled) continue;

      const html = await this.renderOne(
        () =>
          this.engine.renderFile(`sections/${section.type}.liquid`, {
            ...scope,
            section: {
              id: section.id,
              type: section.type,
              /**
               * Font handles become font objects here too.
               *
               * A `font_picker` in a SECTION's schema stores the same
               * `dm_sans_n4` string as one in the theme's settings, and a theme
               * reads it the same way — so a section that sets its own
               * typography rendered `font-family: , ;`, which browsers discard.
               * Theme settings alone were not enough.
               */
              settings: resolveFontSettings(section.settings),
              blocks: section.blocks.map((block, position) => ({
                ...block,
                settings: resolveFontSettings(block.settings ?? {}),
                index: position,
              })),
              index,
            },
          }),
        section,
        failures,
      );

      rendered.push(html);
    }

    return rendered.join('\n');
  }

  /**
   * Renders one thing, converting a failure into a recorded one.
   *
   * The isolation boundary. Everything a theme can get wrong — a missing
   * snippet, a filter on the wrong type, an unclosed tag — surfaces here as a
   * failure attached to the section that caused it, rather than as an exception
   * that loses the other nine sections along with it.
   */
  private async renderOne(
    render: () => Promise<string>,
    section: { id: string; type: string },
    failures: SectionFailure[],
  ): Promise<string> {
    try {
      return await render();
    } catch (error) {
      const message = (error as Error).message.split('\n')[0] ?? 'unknown error';
      failures.push({ sectionId: section.id, sectionType: section.type, message });

      return this.options.explainFailures
        ? `<!-- section "${section.type}" failed to render: ${message.replace(/--+>/g, '')} -->`
        : '';
    }
  }

  private done(
    html: string,
    choice: ReturnType<typeof resolveTemplate>,
    failures: readonly SectionFailure[],
  ): RenderedPage {
    return {
      html,
      templatePath: choice.path,
      considered: choice.considered,
      ...(choice.missingSuffix ? { missingSuffix: choice.missingSuffix } : {}),
      failures,
    };
  }
}
