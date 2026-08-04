/**
 * Content · domain/content.ts
 * Pages and metaobjects. Pages are the first entity where SEO genuinely applies
 * — a product is discoverable through a collection, but a page IS the
 * destination — and metaobject definitions are what make custom content
 * structural rather than a pile of bespoke tables (§12.4).
 * Layer: domain (pure).
 */

export type PageStatus = 'draft' | 'published';

export interface Page {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly body: string;
  readonly status: PageStatus;
  readonly templateSuffix: string | null;
  readonly publishedAt: Date | null;
  readonly version: number;
}

export class ContentInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'ContentInvariantError';
  }
}

export const PAGE_TITLE_MAX = 255;

export function assertPageValid(page: Page): void {
  if (page.title.trim().length === 0) {
    throw new ContentInvariantError('title', 'is required');
  }
  if (page.title.length > PAGE_TITLE_MAX) {
    throw new ContentInvariantError('title', `must be ${PAGE_TITLE_MAX} characters or fewer`);
  }
  if (page.handle.trim().length === 0) {
    throw new ContentInvariantError('handle', 'is required');
  }
  // A published page with no body is a live blank page — almost always a mistake
  // rather than an intent.
  if (page.status === 'published' && page.body.trim().length === 0) {
    throw new ContentInvariantError('body', 'a published page needs content');
  }
  if (page.status === 'published' && page.publishedAt === null) {
    throw new ContentInvariantError('publishedAt', 'a published page needs a publication date');
  }
}

/** Reserved because a page at these handles would shadow storefront routes. */
const RESERVED_PAGE_HANDLES = new Set([
  'cart', 'checkout', 'products', 'collections', 'account', 'search', 'blogs', 'pages',
]);

export function assertPageHandleAvailable(handle: string): void {
  if (RESERVED_PAGE_HANDLES.has(handle)) {
    throw new ContentInvariantError('handle', `"${handle}" is reserved by the storefront`);
  }
}

// --- metaobjects ------------------------------------------------------------

export type MetaobjectFieldType =
  | 'single_line_text'
  | 'multi_line_text'
  | 'rich_text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'url'
  | 'file_reference'
  | 'metaobject_reference';

export interface MetaobjectFieldDefinition {
  readonly key: string;
  readonly name: string;
  readonly type: MetaobjectFieldType;
  readonly required: boolean;
  readonly description: string | null;
}

/**
 * A metaobject definition is a merchant-authored content type. Adding one never
 * triggers a migration — the definition and its entries are rows, which is what
 * lets a tenant invent structure without DDL (§17.4).
 */
export interface MetaobjectDefinition {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly MetaobjectFieldDefinition[];
  /** The field whose value names an entry in lists. */
  readonly displayNameKey: string | null;
  readonly version: number;
}

export interface MetaobjectEntry {
  readonly id: string;
  readonly definitionId: string;
  readonly handle: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly status: PageStatus;
  readonly version: number;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export function assertDefinitionValid(definition: MetaobjectDefinition): void {
  if (!IDENTIFIER.test(definition.type)) {
    throw new ContentInvariantError('type', 'must be lower_snake_case');
  }
  if (definition.name.trim().length === 0) {
    throw new ContentInvariantError('name', 'is required');
  }
  if (definition.fields.length === 0) {
    throw new ContentInvariantError('fields', 'a definition needs at least one field');
  }

  const keys = new Set<string>();
  for (const field of definition.fields) {
    if (!IDENTIFIER.test(field.key)) {
      throw new ContentInvariantError('fields', `field key "${field.key}" must be lower_snake_case`);
    }
    if (keys.has(field.key)) {
      throw new ContentInvariantError('fields', `duplicate field key "${field.key}"`);
    }
    keys.add(field.key);
  }

  if (definition.displayNameKey && !keys.has(definition.displayNameKey)) {
    throw new ContentInvariantError('displayNameKey', 'must name one of this definition\'s fields');
  }
}

/**
 * Validates an entry against its definition. Unknown keys are rejected rather
 * than ignored: silently dropping a value the merchant typed is worse than
 * telling them the field does not exist.
 */
export function assertEntryValid(
  definition: MetaobjectDefinition,
  entry: MetaobjectEntry,
): void {
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));

  for (const key of Object.keys(entry.values)) {
    if (!byKey.has(key)) {
      throw new ContentInvariantError('values', `"${key}" is not a field on ${definition.type}`);
    }
  }

  for (const field of definition.fields) {
    const value = entry.values[field.key];
    // Whitespace does not satisfy a required field. A merchant who typed spaces
    // has not filled it in, and storing "   " as an author's name is worse than
    // refusing it.
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (field.required && missing) {
      throw new ContentInvariantError('values', `"${field.name}" is required`);
    }
    if (missing) continue;

    switch (field.type) {
      case 'integer':
        if (!Number.isInteger(value)) {
          throw new ContentInvariantError('values', `"${field.name}" must be a whole number`);
        }
        break;
      case 'decimal':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          throw new ContentInvariantError('values', `"${field.name}" must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new ContentInvariantError('values', `"${field.name}" must be true or false`);
        }
        break;
      case 'date':
        if (Number.isNaN(new Date(String(value)).getTime())) {
          throw new ContentInvariantError('values', `"${field.name}" must be a valid date`);
        }
        break;
      case 'url':
        try {
          new URL(String(value));
        } catch {
          throw new ContentInvariantError('values', `"${field.name}" must be a valid URL`);
        }
        break;
      case 'single_line_text':
        if (typeof value !== 'string') {
          throw new ContentInvariantError('values', `"${field.name}" must be text`);
        }
        if (value.includes('\n')) {
          throw new ContentInvariantError('values', `"${field.name}" is single-line`);
        }
        break;
      default:
        if (typeof value !== 'string') {
          throw new ContentInvariantError('values', `"${field.name}" must be text`);
        }
    }
  }
}

/** Name for an entry in a list, falling back rather than showing blank. */
export function entryDisplayName(
  definition: MetaobjectDefinition,
  entry: MetaobjectEntry,
): string {
  if (definition.displayNameKey) {
    const value = entry.values[definition.displayNameKey];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return entry.handle;
}
