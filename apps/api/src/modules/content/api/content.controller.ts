/**
 * Content · api/content.controller.ts
 * Pages and merchant-defined content types.
 *
 * Publishing is its own endpoint rather than a status field on the generic
 * patch: it is the one change with an effect beyond the record (§13.1), and a
 * form save must not be able to make a half-written page live.
 * Layer: api.
 */

import { controller, type ModuleController, type RouteRequest } from '../../../core/http/controller';
import type {
  BlogPostService,
  MenuService,
  MetaobjectService,
  PageService,
} from '../application';
import {
  entryDisplayName,
  type MetaobjectDefinition,
  type MetaobjectEntry,
  type Page,
} from '../domain';
import { parseListQuery } from '@deservefirst/contracts';

export interface ContentServices {
  readonly pages: PageService;
  readonly metaobjects: MetaobjectService;
  readonly menus: MenuService;
  readonly blogPosts: BlogPostService;
}

const toPageDto = (page: Page) => ({
  id: page.id,
  handle: page.handle,
  title: page.title,
  body: page.body,
  status: page.status,
  templateSuffix: page.templateSuffix,
  publishedAt: page.publishedAt?.toISOString() ?? null,
  version: page.version,
});

const toDefinitionDto = (definition: MetaobjectDefinition) => ({
  id: definition.id,
  type: definition.type,
  name: definition.name,
  description: definition.description,
  fields: definition.fields,
  displayNameKey: definition.displayNameKey,
  version: definition.version,
});

/**
 * The display name is resolved here rather than in the browser: which field
 * names an entry belongs with the definition, not with each screen showing one.
 */
const toEntryDto = (definition: MetaobjectDefinition, entry: MetaobjectEntry) => ({
  id: entry.id,
  definitionId: entry.definitionId,
  handle: entry.handle,
  values: entry.values,
  status: entry.status,
  displayName: entryDisplayName(definition, entry),
  version: entry.version,
});

const expectedVersion = (request: RouteRequest): number => Number(request.body.version ?? -1);

export function contentController(services: ContentServices): ModuleController {
  const { pages, metaobjects } = services;

  return controller('content', [
    // --- pages ----------------------------------------------------------------
    {
      method: 'GET',
      path: '/pages/:id/detail',
      permission: 'content.read',
      handle: async (request) => toPageDto(await pages.get(request.params.id!)),
    },
    // --- menus ---------------------------------------------------------------
    {
      method: 'POST',
      path: '/menus',
      permission: 'content.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return services.menus.create({
          title: String(body.title ?? ''),
          handle: String(body.handle ?? ''),
          items: Array.isArray(body.items) ? (body.items as never) : [],
        });
      },
    },
    {
      method: 'PATCH',
      path: '/menus/:id',
      permission: 'content.manage',
      handle: async (request) => {
        const { body } = request;
        return services.menus.save(request.params.id!, Number(body.version ?? 0), {
          title: body.title === undefined ? undefined : String(body.title),
          items: Array.isArray(body.items) ? (body.items as never) : undefined,
        });
      },
    },

    // --- blog posts ----------------------------------------------------------
    {
      method: 'POST',
      path: '/blog_posts',
      permission: 'content.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return services.blogPosts.create({
          blogId: String(body.blogId ?? ''),
          title: String(body.title ?? ''),
          body: body.body === undefined ? undefined : String(body.body),
          handle: body.handle === undefined ? undefined : String(body.handle),
        });
      },
    },
    {
      method: 'PATCH',
      path: '/blog_posts/:id',
      permission: 'content.manage',
      handle: async (request) => {
        const { body } = request;
        return services.blogPosts.save(request.params.id!, Number(body.version ?? 0), {
          title: body.title === undefined ? undefined : String(body.title),
          body: body.body === undefined ? undefined : String(body.body),
          status: body.status as 'draft' | 'published' | undefined,
          publishedAt:
            body.publishedAt === undefined
              ? undefined
              : body.publishedAt === null
                ? null
                : new Date(String(body.publishedAt)),
        });
      },
    },

    {
      method: 'POST',
      path: '/pages',
      permission: 'content.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toPageDto(
          await pages.create({
            title: String(body.title ?? ''),
            body: body.body === undefined ? undefined : String(body.body),
            handle: body.handle === undefined ? undefined : String(body.handle),
          }),
        );
      },
    },
    {
      method: 'PATCH',
      path: '/pages/:id',
      permission: 'content.manage',
      handle: async (request) => {
        const { body } = request;
        return toPageDto(
          await pages.update(request.params.id!, expectedVersion(request), {
            title: body.title === undefined ? undefined : String(body.title),
            body: body.body === undefined ? undefined : String(body.body),
            handle: body.handle === undefined ? undefined : String(body.handle),
            templateSuffix: body.templateSuffix as string | null | undefined,
          }),
        );
      },
    },
    {
      method: 'POST',
      path: '/pages/:id/status',
      permission: 'content.publish',
      handle: async (request) =>
        toPageDto(
          await pages.setStatus(
            request.params.id!,
            expectedVersion(request),
            request.body.status === 'published' ? 'published' : 'draft',
          ),
        ),
    },

    // --- content types ---------------------------------------------------------
    {
      method: 'GET',
      path: '/metaobject-definitions/:id/detail',
      permission: 'content.read',
      handle: async (request) =>
        toDefinitionDto(await metaobjects.getDefinition(request.params.id!)),
    },
    {
      method: 'POST',
      path: '/metaobject-definitions',
      permission: 'content.definitions.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toDefinitionDto(
          await metaobjects.createDefinition({
            type: String(body.type ?? ''),
            name: String(body.name ?? ''),
            description: (body.description ?? null) as string | null,
            fields: (body.fields ?? []) as never,
            displayNameKey: (body.displayNameKey ?? null) as string | null,
          }),
        );
      },
    },
    {
      method: 'PATCH',
      path: '/metaobject-definitions/:id',
      permission: 'content.definitions.manage',
      handle: async (request) => {
        const { body } = request;
        return toDefinitionDto(
          await metaobjects.updateDefinition(request.params.id!, expectedVersion(request), {
            name: body.name === undefined ? undefined : String(body.name),
            description: body.description as string | null | undefined,
            fields: body.fields as never,
            displayNameKey: body.displayNameKey as string | null | undefined,
          }),
        );
      },
    },
    {
      // The entries carry their definition, because rendering values without it
      // would mean guessing which field names each row.
      method: 'GET',
      path: '/metaobject-definitions/:id/entries',
      permission: 'content.read',
      handle: async (request) => {
        const { definition, entries } = await metaobjects.listEntries(
          request.params.id!,
          parseListQuery(request.query),
        );
        return {
          definition: toDefinitionDto(definition),
          entries: entries.nodes.map((entry) => toEntryDto(definition, entry)),
        };
      },
    },

    // --- entries ---------------------------------------------------------------
    {
      method: 'GET',
      path: '/metaobjects/:id/detail',
      permission: 'content.read',
      handle: async (request) => {
        const { definition, entry } = await metaobjects.getEntry(request.params.id!);
        return { definition: toDefinitionDto(definition), entry: toEntryDto(definition, entry) };
      },
    },
    {
      method: 'POST',
      path: '/metaobjects',
      permission: 'content.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        const entry = await metaobjects.createEntry({
          definitionId: String(body.definitionId ?? ''),
          handle: body.handle === undefined ? undefined : String(body.handle),
          values: (body.values ?? {}) as Record<string, unknown>,
        });
        return toEntryDto(await metaobjects.getDefinition(entry.definitionId), entry);
      },
    },
    {
      method: 'PATCH',
      path: '/metaobjects/:id',
      permission: 'content.manage',
      handle: async (request) => {
        const { body } = request;
        const entry = await metaobjects.updateEntry(request.params.id!, expectedVersion(request), {
          values: body.values as Record<string, unknown> | undefined,
          status:
            body.status === 'published' ? 'published' : body.status === 'draft' ? 'draft' : undefined,
        });
        return toEntryDto(await metaobjects.getDefinition(entry.definitionId), entry);
      },
    },
  ]);
}
