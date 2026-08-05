/**
 * Storefront · domain/handles.ts
 * Turning a title into the URL segment that identifies it.
 *
 * In domain rather than beside the filter that exposes it, because two things
 * now depend on agreeing exactly: the `handle` filter a theme calls, and the
 * by-handle lookup that turns a query parameter into a database key. If those
 * two normalised differently, `{{ product.title | handle }}` would produce a
 * link that `all_products[handle]` could not resolve.
 *
 * It is also a security boundary now. Whatever a lookup is handed — a query
 * parameter, a path fragment, anything — passes through here before it reaches
 * a loader, so `../../etc/passwd` becomes the handle `etc-passwd` and finds
 * nothing rather than travelling any further.
 * Layer: domain (pure).
 */

/**
 * A title as a URL segment.
 *
 * Accents are decomposed and stripped rather than transliterated, matching the
 * reference product: "Café" becomes "cafe". Anything that is not a letter,
 * digit or underscore becomes a hyphen, runs collapse, and the ends are
 * trimmed — so "  Hello, World!  " is "hello-world".
 */
export function handleize(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
