/**
 * Storefront · api/editor.controller.ts
 * The endpoints the theme editor calls.
 *
 * A real module controller, unlike the storefront handler beside it: these ARE
 * admin API routes, they carry permissions, and they belong in the reference
 * like every other endpoint a partner might automate against.
 *
 * The permission split is the interesting part. Reading a theme needs
 * `store.themes.read`, editing needs `store.themes.manage`, and publishing
 * needs it too — but publishing is the only one that changes what customers
 * see, so it is worth noticing that "edit" and "publish" being the same
 * permission is a decision rather than an oversight. A separate publish
 * permission would let a store give a designer the editor without the ability
 * to ship; that is a real need and a later change, and it is recorded here so it
 * is chosen rather than drifted into.
 * Layer: api.
 */

import { controller, type ModuleController, type RouteRequest } from '../../core/http/controller';
import {
  EditorError,
  isSearchableType,
  SEARCHABLE_TYPES,
  type EditRequest,
  type ResourceMatch,
  type SearchableType,
} from '../domain';
import type { EditorService, EditorSession, ThemeSchemas } from '../application';

export interface EditorServices {
  readonly editor: EditorService;
  /** The theme a store is editing, and its parsed schemas. */
  sessionFor(storeId: string, themeId?: string): Promise<{
    session: EditorSession;
    schemas: ThemeSchemas;
    templates: readonly string[];
    previewUrl: (templatePath: string) => string;
  }>;
  publish(storeId: string, themeId: string): Promise<void>;
  /** Records a setting can point at, for the picker. */
  searchResources(type: SearchableType, term: string): Promise<readonly ResourceMatch[]>;
}

/** Turns an editor refusal into the status it deserves. */
function statusFor(error: EditorError): number {
  switch (error.code) {
    case 'conflict':
      return 409;
    case 'not_found':
      return 404;
    // A limit or a placement rule is the theme's own constraint, not a
    // malformed request — 422 says "understood, and not allowed".
    case 'limit_reached':
    case 'not_allowed_here':
    case 'invalid':
      return 422;
    default:
      return 400;
  }
}

export function editorController(services: EditorServices): ModuleController {
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof EditorError) {
        // The code travels to the client, because a conflict needs a different
        // response from a validation failure — one means reload, the other
        // means fix the value.
        // `status`, not `statusCode` — the transport's error handler reads the
        // former, and an error carrying only the latter is served as a 500 with
        // its message replaced. Which meant this careful mapping never reached
        // anyone: a merchant whose colleague saved first got "an unexpected
        // error occurred" instead of "reload and try again".
        throw Object.assign(new Error(error.message), {
          status: statusFor(error),
          code: error.code,
        });
      }
      throw error;
    }
  };

  return controller('storefront', [
    {
      method: 'GET',
      path: '/editor',
      permission: 'store.themes.read',
      handle: async (request: RouteRequest) => {
        const themeId = request.query.get('theme') ?? undefined;
        const { session, schemas, templates, previewUrl } = await services.sessionFor(
          request.storeId,
          themeId,
        );

        /**
         * The homepage by default, not whatever sorts first.
         *
         * Alphabetical order opens the editor on `templates/404.json`, which is
         * the one page a merchant is least likely to want and the worst first
         * impression of the editor.
         */
        const templatePath =
          request.query.get('template') ??
          templates.find((path) => /^templates\/index\.(json|liquid)$/.test(path)) ??
          templates[0] ??
          'templates/index.json';

        const document = await run(() => services.editor.open(session, templatePath));
        const pending = await services.editor.pendingFiles(session);

        return {
          themeId: session.themeId,
          templatePath,
          templates,
          sections: document.sections,
          version: document.version,
          /**
           * Every schema, not only the ones in use.
           *
           * The panel needs the schema of a section the moment it is added, and
           * fetching one per click would make the picker feel broken on a slow
           * connection. A theme's schemas are a few hundred kilobytes at most.
           */
          schemas: Object.fromEntries(
            templates.length > 0
              ? document.sections.map((section) => [section.type, schemas.schemaFor(section.type)])
              : [],
          ),
          addable: schemas.addable(templateNameOf(templatePath)),
          unusable: schemas.unusable(),
          previewUrl: previewUrl(templatePath),
          hasUnsavedChanges: pending.length > 0,
        };
      },
    },

    {
      /**
       * What a `product` or `collection` setting can point at.
       *
       * A GET because it reads and changes nothing, so a merchant typing gets
       * the browser's own request handling — and because a type-ahead firing on
       * every keystroke should be something a proxy may cache and cancel.
       */
      method: 'GET',
      path: '/editor/resources',
      permission: 'store.themes.manage',
      handle: async (request: RouteRequest) => {
        const type = request.query.get('type');

        /**
         * Checked against the allow-list before anything else.
         *
         * The value arrives in a query string and decides which table is read.
         * Refusing an unknown one here, by name, is what stops a settings panel
         * from becoming a way to read any table in the database.
         */
        if (!isSearchableType(type)) {
          throw Object.assign(
            new Error(
              `"${String(type)}" is not a resource a setting can point at. ` +
                `Use one of: ${SEARCHABLE_TYPES.join(', ')}.`,
            ),
            { status: 422, code: 'validation_failed' },
          );
        }

        return { matches: await services.searchResources(type, request.query.get('q') ?? '') };
      },
    },

    {
      method: 'POST',
      path: '/editor/edit',
      permission: 'store.themes.manage',
      handle: async (request: RouteRequest) => {
        const { session, schemas } = await services.sessionFor(
          request.storeId,
          String(request.body.themeId ?? ''),
        );

        const templatePath = String(request.body.templatePath ?? '');
        const edit: EditRequest = {
          action: request.body.action as EditRequest['action'],
          expectedVersion: Number(request.body.expectedVersion ?? 0),
        };

        const document = await run(() =>
          services.editor.edit(session, templatePath, edit, schemas),
        );

        return { sections: document.sections, version: document.version };
      },
    },

    {
      method: 'DELETE',
      path: '/editor/draft',
      permission: 'store.themes.manage',
      handle: async (request: RouteRequest) => {
        const { session } = await services.sessionFor(
          request.storeId,
          request.query.get('theme') ?? undefined,
        );
        await services.editor.discard(session, request.query.get('template') ?? '');
        return { discarded: true };
      },
    },

    {
      method: 'POST',
      path: '/editor/publish',
      permission: 'store.themes.manage',
      handle: async (request: RouteRequest) => {
        /**
         * The only endpoint here that changes what customers see.
         *
         * Everything else edits a draft; this writes it to the theme and makes
         * it live. Kept as its own call rather than a flag on save, so a
         * merchant cannot publish by accident while tidying up.
         */
        await services.publish(request.storeId, String(request.body.themeId ?? ''));
        return { published: true };
      },
    },
  ]);
}

/** `templates/product.wholesale.json` → `product`. */
function templateNameOf(path: string): string {
  const file = path.split('/').pop() ?? '';
  return file.replace(/\.(json|liquid)$/, '').split('.')[0] ?? '';
}
