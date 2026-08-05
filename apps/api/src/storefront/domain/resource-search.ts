/**
 * Storefront · domain/resource-search.ts
 * What a theme setting is allowed to point at, and how it is searched.
 *
 * A section setting of type `product` holds a handle. Until now the editor drew
 * that as a text field and a merchant typed the handle from memory — which
 * works exactly as well as remembering a URL slug for a product you named six
 * months ago. This is what a picker searches.
 *
 * The searchable types are an ALLOW-LIST rather than a mapping the caller
 * supplies, and that is the security-relevant part. The type arrives in a query
 * string, and a value that reached a table name would be a way to read any
 * table in the database through a settings panel. Anything not named here is
 * refused before a query is built.
 * Layer: domain (pure).
 */

/** A setting type that refers to a record. */
export type SearchableType = 'product' | 'collection' | 'page' | 'blog' | 'article' | 'link_list';

export interface ResourceMatch {
  readonly handle: string;
  readonly title: string;
  /** Context that distinguishes two similar titles — a status, a parent blog. */
  readonly subtitle: string | null;
  /**
   * Whether customers can currently see it.
   *
   * Shown rather than filtered. A merchant setting up a homepage before launch
   * is referring to drafts on purpose, and hiding them would make the picker
   * useless at exactly the moment it is most used — but a section pointing at
   * something invisible renders empty, so they need to know.
   */
  readonly published: boolean;
}

export const SEARCHABLE_TYPES: readonly SearchableType[] = [
  'product',
  'collection',
  'page',
  'blog',
  'article',
  'link_list',
];

export function isSearchableType(value: unknown): value is SearchableType {
  return typeof value === 'string' && (SEARCHABLE_TYPES as readonly string[]).includes(value);
}

/**
 * How many matches one search returns.
 *
 * Small on purpose. A picker is for finding one thing, and a list long enough
 * to scroll is one a merchant searches again rather than reads — so the effort
 * belongs in matching well, not in returning more.
 */
export const SEARCH_LIMIT = 20;

/**
 * Cleans a merchant's typing into something to match on.
 *
 * The wildcards are added by the query, not here: a term containing `%` must
 * match a literal per cent sign rather than everything, and the only way to
 * guarantee that is to escape it before it is ever concatenated.
 */
export function normaliseSearchTerm(input: unknown): string {
  return String(input ?? '')
    .trim()
    .slice(0, 100)
    // `_` matches any single character in SQL LIKE and appears in real handles.
    .replace(/[%_\\]/g, (character) => `\\${character}`);
}
