/**
 * Storefront · domain/internal-links.ts
 * Links a theme stored using another platform's URL scheme.
 *
 * When a merchant picks "the about page" in a theme editor, the theme does not
 * store `/pages/about` — it stores an opaque internal reference,
 * `<scheme>://pages/about`, so the link keeps working if the page is later
 * renamed. Every theme built elsewhere is full of them: the reference theme's
 * templates carry six, and its product page has one on a "learn more" button.
 *
 * Rendered as-is they reach the browser as an unknown scheme, and the link does
 * nothing at all. Not a broken link a visitor can recognise — a button that
 * simply does not respond, which reads as a broken site rather than a broken
 * href.
 *
 * The schemes come from `config/theme-compat.json`, like every other foreign
 * name the platform answers to. That file is data, and it is where the decision
 * about which platforms we accept themes from is recorded.
 *
 * Matched by VALUE rather than by setting name, which is the opposite of how
 * fonts and colours are resolved — and deliberately so. A font setting is
 * identified by its key because `dm_sans_n4` is otherwise indistinguishable
 * from a product code. `<scheme>://` is not ambiguous: no legitimate setting
 * value begins with it unless it IS one of these references. Matching the key
 * instead would mean maintaining a list of every name a theme might give a link
 * field, and missing one silently.
 * Layer: domain (pure).
 */

/**
 * The path an internal reference points at, or null if it is not one.
 *
 * `<scheme>://collections/all` becomes `/collections/all`. The rest of the
 * reference is already our URL shape, because both platforms route
 * `/collections/{handle}` and `/pages/{handle}` the same way — which is why
 * this is a prefix swap rather than a routing table.
 */
export function resolveInternalLink(
  value: unknown,
  schemes: readonly string[],
): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  for (const scheme of schemes) {
    const prefix = `${scheme}://`;
    if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) continue;

    const rest = trimmed.slice(prefix.length);

    /**
     * A reference with nothing after it points at the storefront root.
     *
     * `<scheme>://` alone is what a theme stores for "the home page", and
     * returning an empty string would render `href=""` — which reloads the
     * current page rather than going home.
     */
    if (rest === '') return '/';

    /**
     * Anything that could leave the site is refused rather than rewritten.
     *
     * A reference is merchant-supplied through the editor, and a `//` or a
     * backslash after the scheme would produce a protocol-relative URL that
     * sends a customer to another host. Returning null leaves the original
     * value in place, where it is visibly broken rather than quietly hostile.
     */
    if (rest.startsWith('/') || rest.startsWith('\\') || rest.includes('://')) return null;

    return `/${rest}`;
  }

  return null;
}

/**
 * Rewrites internal references anywhere in a settings object.
 *
 * Shallow, because theme settings are flat: a section's settings are strings,
 * numbers and booleans, and its blocks are resolved separately by the caller.
 */
export function resolveLinkSettings(
  settings: Readonly<Record<string, unknown>>,
  schemes: readonly string[],
): Record<string, unknown> {
  if (schemes.length === 0) return { ...settings };

  const resolved: Record<string, unknown> = { ...settings };

  for (const [key, value] of Object.entries(settings)) {
    const link = resolveInternalLink(value, schemes);
    if (link !== null) resolved[key] = link;
  }

  return resolved;
}
