/**
 * Contracts · resource.ts
 * The one-resource-definition contract (§13.2). An entity is declared once —
 * fields, relations, filterable/sortable columns, permissions, visibility — and
 * from it the platform derives the GraphQL type, the REST serializer, the list
 * and search engine, and the admin screens. Declared once, so the surfaces
 * cannot drift.
 * Layer: contracts (pure types, no framework).
 */
export type FieldType = 'id' | 'string' | 'text' | 'richtext' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'money' | 'enum' | 'json' | 'reference' | 'file' | 'handle';
/**
 * Public/private/internal visibility (§26.4). A private or internal operation can
 * never leak into the public schema or the generated reference docs — fitness
 * checked, and supported at field level too.
 */
export type Visibility = 'public' | 'private' | 'internal';
export interface FieldDefinition {
    readonly name: string;
    readonly type: FieldType;
    readonly required?: boolean;
    readonly unique?: boolean;
    readonly indexed?: boolean;
    readonly filterable?: boolean;
    readonly sortable?: boolean;
    readonly searchable?: boolean;
    readonly translatable?: boolean;
    readonly visibility?: Visibility;
    /** For `enum`. */
    readonly values?: readonly string[];
    /** For `reference` — the target entity name. */
    readonly references?: string;
    readonly description?: string;
}
export interface ScreenColumn {
    readonly field: string;
    readonly label: string;
    /** Shown by default; users may add or remove columns and the set lives in the URL. */
    readonly defaultVisible: boolean;
    readonly position: number;
}
export interface ResourceDefinition {
    readonly name: string;
    readonly entity: string;
    readonly pluralName: string;
    /** URL segment, e.g. "products" → /store/{handle}/products. */
    readonly urlSegment: string;
    readonly fields: readonly FieldDefinition[];
    readonly api: {
        readonly graphql: boolean;
        readonly rest: boolean;
        readonly visibility: Visibility;
    };
    readonly screens: readonly ('list' | 'detail' | 'create' | 'settings')[];
    readonly columns?: readonly ScreenColumn[];
    readonly permissions: {
        readonly read: string;
        readonly write: string;
        readonly delete?: string;
    };
    /** Aggregate root name if this resource is not itself the root (§14.3). */
    readonly aggregateRoot?: string;
}
/** Global id format: gid://{platformSlug}/{Entity}/{id} (§12.1). */
export declare function buildGlobalId(platformSlug: string, entity: string, id: string): string;
export declare function parseGlobalId(gid: string): {
    platformSlug: string;
    entity: string;
    id: string;
} | null;
//# sourceMappingURL=resource.d.ts.map