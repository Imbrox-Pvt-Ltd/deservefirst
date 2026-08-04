/**
 * Content · application/index.ts
 * Use-cases: orchestration over the domain. Takes typed input, returns typed
 * DTOs, and knows nothing about HTTP, GraphQL or the queue — so every transport
 * calls the same code and they cannot diverge (§13.1).
 * Layer: application.
 */

import { type Connection, type ListQuery } from '@deservefirst/contracts';

import type { ToolkitPorts } from '../../../core/entity-toolkit';
import {
  assertDefinitionValid,
  assertEntryValid,
  assertPageHandleAvailable,
  assertPageValid,
  ContentInvariantError,
  entryDisplayName,
  type MetaobjectDefinition,
  type MetaobjectEntry,
  type MetaobjectFieldDefinition,
  type Page,
} from '../domain';

export interface PageRepository {
  findById(id: string): Promise<Page | null>;
  takenHandles(prefix: string): Promise<ReadonlySet<string>>;
  list(query: ListQuery): Promise<Connection<Page>>;
  insert(page: Page): Promise<Page>;
  update(page: Page, expectedVersion: number): Promise<Page>;
  softDelete(id: string): Promise<void>;
}

export interface DefinitionRepository {
  findById(id: string): Promise<MetaobjectDefinition | null>;
  findByType(type: string): Promise<MetaobjectDefinition | null>;
  list(query: ListQuery): Promise<Connection<MetaobjectDefinition>>;
  insert(definition: MetaobjectDefinition): Promise<MetaobjectDefinition>;
  update(definition: MetaobjectDefinition, expectedVersion: number): Promise<MetaobjectDefinition>;
  softDelete(id: string): Promise<void>;
}

export interface EntryRepository {
  findById(id: string): Promise<MetaobjectEntry | null>;
  takenHandlesFor(definitionId: string, prefix: string): Promise<ReadonlySet<string>>;
  listFor(definitionId: string, query: ListQuery): Promise<Connection<MetaobjectEntry>>;
  countFor(definitionId: string): Promise<number>;
  insert(entry: MetaobjectEntry): Promise<MetaobjectEntry>;
  update(entry: MetaobjectEntry, expectedVersion: number): Promise<MetaobjectEntry>;
  softDelete(id: string): Promise<void>;
}

export class ContentNotFoundError extends Error {
  readonly status = 404;
  constructor(what: string, id: string) {
    super(`No ${what} with id "${id}" in this store.`);
    this.name = 'ContentNotFoundError';
  }
}

export class PageService {
  constructor(
    private readonly repository: PageRepository,
    private readonly toolkit: ToolkitPorts,
  ) {}

  async list(query: ListQuery): Promise<Connection<Page>> {
    return this.repository.list(query);
  }

  async get(id: string): Promise<Page> {
    const page = await this.repository.findById(id);
    if (!page) throw new ContentNotFoundError('page', id);
    return page;
  }

  async create(input: { title: string; body?: string; handle?: string }): Promise<Page> {
    const base = this.toolkit.slugify(input.handle ?? input.title);
    assertPageHandleAvailable(base);

    const page: Page = {
      id: this.toolkit.newId(),
      handle: this.toolkit.disambiguate(base, await this.repository.takenHandles(base)),
      title: input.title,
      body: input.body ?? '',
      // New pages start as drafts. Publishing on create would put a half-written
      // page live the moment someone names it.
      status: 'draft',
      templateSuffix: null,
      publishedAt: null,
      version: 1,
    };

    assertPageValid(page);
    const saved = await this.repository.insert(page);
    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `page "${saved.title}" created`,
      changes: [],
    });
    return saved;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: { title?: string; body?: string; handle?: string; templateSuffix?: string | null },
  ): Promise<Page> {
    const current = await this.get(id);

    let handle = current.handle;
    if (patch.handle !== undefined && patch.handle !== current.handle) {
      const base = this.toolkit.slugify(patch.handle);
      assertPageHandleAvailable(base);
      handle = this.toolkit.disambiguate(base, await this.repository.takenHandles(base));
    }

    const next: Page = {
      ...current,
      handle,
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      templateSuffix:
        patch.templateSuffix === undefined ? current.templateSuffix : patch.templateSuffix,
      version: current.version + 1,
    };

    assertPageValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    const changes = [
      changeOf('title', current.title, saved.title),
      changeOf('handle', current.handle, saved.handle),
    ].filter((change): change is { field: string; from: unknown; to: unknown } => change !== null);

    if (changes.length > 0) {
      await this.toolkit.recordTimeline({
        ownerId: saved.id,
        message: `page "${saved.title}" edited`,
        changes,
      });
    }
    return saved;
  }

  /**
   * Publishing stamps the date the FIRST time only.
   *
   * A page can be republished after edits, and the original date is kept —
   * "posted on" refers to when the page appeared, and moving it every time
   * someone fixes a typo is a lie about the page.
   */
  async setStatus(id: string, expectedVersion: number, status: Page['status']): Promise<Page> {
    const current = await this.get(id);
    if (current.status === status) return current;

    const next: Page = {
      ...current,
      status,
      publishedAt:
        status === 'published' ? (current.publishedAt ?? this.toolkit.now()) : current.publishedAt,
      version: current.version + 1,
    };

    assertPageValid(next);
    const saved = await this.repository.update(next, expectedVersion);

    await this.toolkit.recordTimeline({
      ownerId: saved.id,
      message: `page "${saved.title}" ${status === 'published' ? 'published' : 'unpublished'}`,
      changes: [{ field: 'status', from: current.status, to: status }],
    });
    await this.toolkit.emit(`content.page.${status === 'published' ? 'published' : 'unpublished'}`, {
      pageId: saved.id,
      handle: saved.handle,
    });
    return saved;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.repository.softDelete(id);
  }
}

export class MetaobjectService {
  constructor(
    private readonly definitions: DefinitionRepository,
    private readonly entries: EntryRepository,
    private readonly toolkit: ToolkitPorts,
  ) {}

  // --- definitions -----------------------------------------------------------

  async listDefinitions(query: ListQuery): Promise<Connection<MetaobjectDefinition>> {
    return this.definitions.list(query);
  }

  async getDefinition(id: string): Promise<MetaobjectDefinition> {
    const definition = await this.definitions.findById(id);
    if (!definition) throw new ContentNotFoundError('metaobject definition', id);
    return definition;
  }

  async createDefinition(input: {
    type: string;
    name: string;
    description?: string | null;
    fields: readonly MetaobjectFieldDefinition[];
    displayNameKey?: string | null;
  }): Promise<MetaobjectDefinition> {
    if (await this.definitions.findByType(input.type)) {
      throw new ContentInvariantError('type', `"${input.type}" is already defined in this store`);
    }

    const definition: MetaobjectDefinition = {
      id: this.toolkit.newId(),
      type: input.type,
      name: input.name,
      description: input.description ?? null,
      fields: input.fields,
      displayNameKey: input.displayNameKey ?? input.fields[0]?.key ?? null,
      version: 1,
    };

    assertDefinitionValid(definition);
    return this.definitions.insert(definition);
  }

  /**
   * Changing a definition must not invalidate what is already stored, so
   * removing a field, changing its type, or adding a required one is refused
   * while entries exist.
   *
   * The alternative — accept it and let existing entries fail validation the
   * next time anyone opens them — turns one careless edit into a pile of records
   * nobody can save, discovered one at a time by whoever opens them.
   */
  async updateDefinition(
    id: string,
    expectedVersion: number,
    patch: {
      name?: string;
      description?: string | null;
      fields?: readonly MetaobjectFieldDefinition[];
      displayNameKey?: string | null;
    },
  ): Promise<MetaobjectDefinition> {
    const current = await this.getDefinition(id);

    if (patch.fields) {
      const entryCount = await this.entries.countFor(id);
      if (entryCount > 0) assertFieldsCompatible(current.fields, patch.fields, entryCount);
    }

    const next: MetaobjectDefinition = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      fields: patch.fields ?? current.fields,
      displayNameKey:
        patch.displayNameKey === undefined ? current.displayNameKey : patch.displayNameKey,
      version: current.version + 1,
    };

    assertDefinitionValid(next);
    return this.definitions.update(next, expectedVersion);
  }

  // --- entries ---------------------------------------------------------------

  async listEntries(
    definitionId: string,
    query: ListQuery,
  ): Promise<{ definition: MetaobjectDefinition; entries: Connection<MetaobjectEntry> }> {
    const definition = await this.getDefinition(definitionId);
    return { definition, entries: await this.entries.listFor(definitionId, query) };
  }

  async getEntry(id: string): Promise<{ definition: MetaobjectDefinition; entry: MetaobjectEntry }> {
    const entry = await this.entries.findById(id);
    if (!entry) throw new ContentNotFoundError('metaobject entry', id);
    return { definition: await this.getDefinition(entry.definitionId), entry };
  }

  async createEntry(input: {
    definitionId: string;
    handle?: string;
    values: Record<string, unknown>;
  }): Promise<MetaobjectEntry> {
    const definition = await this.getDefinition(input.definitionId);

    const draft: MetaobjectEntry = {
      id: this.toolkit.newId(),
      definitionId: definition.id,
      handle: 'pending',
      values: input.values,
      status: 'draft',
      version: 1,
    };

    // Validated before a handle is derived: naming a record we are about to
    // reject would consume a handle from the store's namespace for nothing.
    assertEntryValid(definition, draft);

    const base = this.toolkit.slugify(input.handle ?? entryDisplayName(definition, draft));
    const entry: MetaobjectEntry = {
      ...draft,
      handle: this.toolkit.disambiguate(base, await this.entries.takenHandlesFor(definition.id, base)),
    };

    return this.entries.insert(entry);
  }

  async updateEntry(
    id: string,
    expectedVersion: number,
    patch: { values?: Record<string, unknown>; status?: MetaobjectEntry['status'] },
  ): Promise<MetaobjectEntry> {
    const { definition, entry } = await this.getEntry(id);

    const next: MetaobjectEntry = {
      ...entry,
      // Values are replaced wholesale rather than merged: a merged patch cannot
      // express clearing a field, and a form that cannot clear a field is a form
      // people work around.
      values: patch.values ?? entry.values,
      status: patch.status ?? entry.status,
      version: entry.version + 1,
    };

    assertEntryValid(definition, next);
    return this.entries.update(next, expectedVersion);
  }

  async deleteEntry(id: string): Promise<void> {
    await this.getEntry(id);
    await this.entries.softDelete(id);
  }
}

/** Refuses definition edits that would invalidate entries already stored. */
function assertFieldsCompatible(
  before: readonly MetaobjectFieldDefinition[],
  after: readonly MetaobjectFieldDefinition[],
  entryCount: number,
): void {
  const now = new Map(after.map((field) => [field.key, field]));
  const records = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;

  for (const field of before) {
    const replacement = now.get(field.key);

    if (!replacement) {
      throw new ContentInvariantError(
        'fields',
        `"${field.name}" cannot be removed while ${records} still use this type`,
      );
    }
    if (replacement.type !== field.type) {
      throw new ContentInvariantError(
        'fields',
        `"${field.name}" cannot change type while ${records} still use this type`,
      );
    }
  }

  for (const field of after) {
    const existed = before.some((entry) => entry.key === field.key);
    if (!existed && field.required) {
      throw new ContentInvariantError(
        'fields',
        `"${field.name}" cannot be added as required while ${records} already exist — ` +
          `add it optional, fill it in, then require it`,
      );
    }
  }
}

function changeOf(field: string, from: unknown, to: unknown) {
  return from === to ? null : { field, from, to };
}
export * from './menu-blog-service';
