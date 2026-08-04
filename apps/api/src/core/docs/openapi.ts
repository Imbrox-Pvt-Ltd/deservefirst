/**
 * Core · docs/openapi.ts
 * The API reference, generated from the declarations that define the API.
 *
 * §26.2: the schema is the single source, and reference docs are regenerated
 * every build so they cannot drift. Hand-written API docs are wrong within a
 * fortnight of the first change nobody remembers to mirror — and worse than
 * absent, because they are believed.
 *
 * Two inputs, both already the truth: the resource declarations (which produce
 * the generic list and get endpoints), and each module's route definitions
 * (which produce everything that writes). Nothing here is authored; if an
 * endpoint is missing from the output it is missing from the platform.
 * Layer: core/docs.
 */

import type { FieldDefinition, ResourceDefinition } from '@deservefirst/contracts';

import type { ModuleController } from '../http/controller';
import type { ModuleRegistry } from '../module-registry/registry';

export interface OpenApiOptions {
  readonly version: string;
  readonly title: string;
  readonly serverUrl: string;
}

type Json = Record<string, unknown>;

/** A resource field's shape on the wire. */
function schemaForField(field: FieldDefinition): Json {
  const nullable = !field.required;

  switch (field.type) {
    case 'integer':
      return { type: 'integer', ...(nullable ? { nullable } : {}) };
    case 'decimal':
      return { type: 'number', ...(nullable ? { nullable } : {}) };
    case 'boolean':
      return { type: 'boolean', ...(nullable ? { nullable } : {}) };
    case 'date':
      return { type: 'string', format: 'date', ...(nullable ? { nullable } : {}) };
    case 'datetime':
      return { type: 'string', format: 'date-time', ...(nullable ? { nullable } : {}) };
    case 'enum':
      return { type: 'string', enum: [...(field.values ?? [])], ...(nullable ? { nullable } : {}) };
    case 'json':
      return { description: 'Arbitrary JSON declared by the module.' };
    case 'money':
      // Money crosses the wire as an exact decimal string with its currency.
      // A float would be the obvious choice and would be wrong at the third
      // decimal place of the first tax calculation.
      return {
        type: 'object',
        properties: {
          amount: { type: 'string', example: '19.99', description: 'Exact decimal, never a float.' },
          currency: { type: 'string', example: 'USD', description: 'ISO 4217.' },
        },
        required: ['amount', 'currency'],
        ...(nullable ? { nullable } : {}),
      };
    case 'reference':
      return {
        type: 'string',
        description: field.references ? `Id of a ${field.references}.` : 'Id of a related record.',
        ...(nullable ? { nullable } : {}),
      };
    default:
      return { type: 'string', ...(nullable ? { nullable } : {}) };
  }
}

/**
 * A resource's public shape.
 *
 * Private and internal fields are omitted, exactly as the serialiser omits them
 * (§26.4) — documenting a field the API refuses to return is how an integrator
 * spends a day building against something that does not exist.
 */
function schemaForResource(resource: ResourceDefinition): Json {
  const properties: Json = {
    id: { type: 'string' },
    version: {
      type: 'integer',
      description: 'Send this back on update; a mismatch is a 409 rather than a lost write.',
    },
  };

  for (const field of resource.fields) {
    if (field.name === 'id') continue;
    if (field.visibility === 'private' || field.visibility === 'internal') continue;
    properties[field.name] = schemaForField(field);
  }

  return {
    type: 'object',
    description: `${resource.pluralName} — declared by the ${resource.entity} entity.`,
    properties,
  };
}

const ENVELOPE_REF = '#/components/schemas/ResponseEnvelope';

function envelopeOf(dataSchema: Json): Json {
  return {
    allOf: [{ $ref: ENVELOPE_REF }, { type: 'object', properties: { data: dataSchema } }],
  };
}

/** `/products/:id` → `/products/{id}`, and the parameter list that implies. */
function toOpenApiPath(path: string): { path: string; parameters: Json[] } {
  const parameters: Json[] = [];
  const converted = path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
    return `{${name}}`;
  });
  return { path: converted, parameters };
}

const LIST_PARAMETERS: Json[] = [
  {
    name: 'query',
    in: 'query',
    schema: { type: 'string' },
    description: 'Filter tokens plus free text, e.g. `status:active vendor:"Acme"`.',
  },
  { name: 'order', in: 'query', schema: { type: 'string' }, description: 'e.g. `created_at desc`.' },
  {
    name: 'after',
    in: 'query',
    schema: { type: 'string' },
    description: 'Keyset cursor. There is no offset paging: it skips and repeats rows under writes.',
  },
  { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 250 } },
  { name: 'savedViewId', in: 'query', schema: { type: 'string' } },
];

const STORE_HEADER: Json = {
  name: 'X-Store-Id',
  in: 'header',
  required: true,
  schema: { type: 'string' },
  description: 'Every store-scoped call names its store. There is no implicit "current store".',
};

/**
 * Builds the document.
 *
 * Controllers are passed in rather than read from the registry because their
 * route definitions are what the transport actually mounts. Their handlers are
 * never invoked here — only method, path, permission and status are read — so a
 * caller may construct them with stub services purely to describe the surface.
 */
export function buildOpenApiDocument(
  registry: ModuleRegistry,
  controllers: readonly ModuleController[],
  options: OpenApiOptions,
): Json {
  const paths: Json = {};
  const schemas: Json = {
    ResponseEnvelope: {
      type: 'object',
      description: 'Every response has this shape, success or failure (§13.4).',
      properties: {
        data: { description: 'The payload, or null when errors is non-empty.' },
        meta: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            pagination: {
              type: 'object',
              properties: {
                hasNextPage: { type: 'boolean' },
                hasPreviousPage: { type: 'boolean' },
                startCursor: { type: 'string', nullable: true },
                endCursor: { type: 'string', nullable: true },
              },
            },
          },
          required: ['requestId'],
        },
        errors: {
          type: 'array',
          items: { $ref: '#/components/schemas/ApiError' },
        },
      },
      required: ['data', 'meta', 'errors'],
    },
    ApiError: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'validation_failed' },
        title: { type: 'string' },
        detail: { type: 'string' },
        status: { type: 'integer' },
        field: { type: 'string', nullable: true },
      },
      required: ['code', 'title', 'detail', 'status'],
    },
  };

  const add = (path: string, method: string, operation: Json) => {
    const existing = (paths[path] as Json | undefined) ?? {};
    paths[path] = { ...existing, [method.toLowerCase()]: operation };
  };

  // --- the generic surface, from the resource declarations --------------------
  for (const entry of registry.enabled()) {
    for (const resource of entry.manifest.resources ?? []) {
      if (!resource.api.rest) continue;
      // Private and internal resources are not part of the public reference.
      if (resource.api.visibility !== 'public') continue;

      const base = `/${options.version}/${entry.manifest.id}/${resource.urlSegment}`;
      schemas[resource.name] = schemaForResource(resource);
      const ref = { $ref: `#/components/schemas/${resource.name}` };

      add(base, 'get', {
        tags: [entry.manifest.id],
        summary: `List ${resource.pluralName.toLowerCase()}`,
        description:
          'Generated from the resource declaration — the same source that builds the list screen.',
        parameters: [STORE_HEADER, ...LIST_PARAMETERS],
        security: [{ permission: [resource.permissions.read] }],
        responses: {
          200: {
            description: `A page of ${resource.pluralName.toLowerCase()}.`,
            content: {
              'application/json': {
                schema: envelopeOf({ type: 'array', items: ref }),
              },
            },
          },
        },
      });

      add(`${base}/{id}`, 'get', {
        tags: [entry.manifest.id],
        summary: `Get one ${resource.name.toLowerCase()}`,
        parameters: [STORE_HEADER, { name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ permission: [resource.permissions.read] }],
        responses: {
          200: { description: 'The record.', content: { 'application/json': { schema: envelopeOf(ref) } } },
          404: { description: 'No such record in this store.' },
        },
      });
    }
  }

  // --- everything modules declare themselves ----------------------------------
  for (const moduleController of controllers) {
    for (const route of moduleController.routes) {
      const { path, parameters } = toOpenApiPath(
        `/${options.version}/${moduleController.moduleId}${route.path}`,
      );

      const writes = route.method !== 'GET' && route.method !== 'DELETE';

      add(path, route.method, {
        tags: [moduleController.moduleId],
        summary: `${route.method} ${route.path}`,
        description:
          'Declared by the module. Writes go through its service, where the invariants and events are.',
        parameters: [STORE_HEADER, ...parameters],
        security: [{ permission: [route.permission] }],
        ...(writes
          ? {
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        version: {
                          type: 'integer',
                          description:
                            'The version last read. Omitting it is not "no opinion" — it is a lost update.',
                        },
                      },
                    },
                  },
                },
              },
            }
          : {}),
        responses: {
          [route.status ?? 200]: {
            description: 'Success.',
            content: { 'application/json': { schema: { $ref: ENVELOPE_REF } } },
          },
          409: { description: 'The record changed since it was read — reload and retry.' },
          422: { description: 'A domain rule refused this.' },
        },
      });
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description:
        'Generated from the platform\'s resource and route declarations on every build, so it ' +
        'cannot drift from the running API (§26.2). Do not edit by hand.',
    },
    servers: [{ url: options.serverUrl }],
    // Authorisation is per-permission, so the reference names the permission a
    // caller needs rather than describing a generic "requires auth".
    components: {
      schemas,
      securitySchemes: {
        permission: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'Bearer token whose granted permissions must include the operation\'s.',
        },
      },
    },
    paths,
  };
}
