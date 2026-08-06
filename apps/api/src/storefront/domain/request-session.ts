/**
 * Storefront · domain/request-session.ts
 * Which draft request an anonymous visitor is adding to.
 *
 * Phase 1 sells nothing (§25): a shopper assembles a Request/RFQ and a merchant
 * answers it. That object is cart-shaped, and themes address it as `cart`, so
 * the storefront speaks "cart" outwards and "request" inwards — the name a
 * theme uses is a compatibility concern, and the name the domain uses is what
 * the thing actually is.
 *
 * The token in the cookie IS the secret. There is no signing because there is
 * nothing to sign: it carries no claims, only an unguessable name for a row.
 * That makes it a session identifier in the strict sense, and the security
 * property that matters is that it cannot be guessed or enumerated — hence the
 * strict format check here rather than passing whatever arrived to a query.
 *
 * It deliberately does NOT identify a person. A visitor who later signs in
 * keeps the same draft; a shared computer does not leak an identity, because
 * there is no identity in it.
 * Layer: domain (pure).
 */

/**
 * The cookie a draft request travels in.
 *
 * `__Host-` is deliberate: browsers refuse to set it unless it is Secure,
 * path-scoped to `/` and carries no Domain — so a subdomain cannot write a
 * cookie that this store would then read as its own. On a multi-tenant platform
 * where every store is a subdomain, that is the difference between a session
 * identifier and a way for one shop to hand another shop a cart.
 */
export const REQUEST_COOKIE = '__Host-df_request';

/** Development serves stores over plain HTTP, where `__Host-` cannot be set. */
export const REQUEST_COOKIE_INSECURE = 'df_request';

/** Thirty days: long enough that a shopper's list survives a weekend. */
export const REQUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * A token is 32 hex characters and nothing else.
 *
 * Checked before it reaches a query rather than trusted because it came from a
 * cookie. A cookie is attacker-controlled input in exactly the way a query
 * string is; the only difference is that people forget.
 */
export function isRequestToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** Reads one cookie out of a raw header, without a parser dependency. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

/** The draft request this visitor is carrying, if the cookie holds a real one. */
export function requestTokenFrom(cookieHeader: string | null | undefined): string | null {
  for (const name of [REQUEST_COOKIE, REQUEST_COOKIE_INSECURE]) {
    const value = cookieValue(cookieHeader, name);
    if (isRequestToken(value)) return value;
  }
  return null;
}

/**
 * The `Set-Cookie` for a draft request.
 *
 * `SameSite=Lax` rather than `Strict`: a shopper following a link from an email
 * or a search result must still see the list they built, and Lax already stops
 * the cross-site POST that a stricter setting is usually reached for — that is
 * separately blocked by the origin check on every mutation.
 */
export function requestCookieHeader(token: string, secure: boolean): string {
  const name = secure ? REQUEST_COOKIE : REQUEST_COOKIE_INSECURE;
  const attributes = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${REQUEST_COOKIE_MAX_AGE}`,
  ];
  // Only over HTTPS, because a browser silently drops a Secure cookie on
  // http://localhost and the whole flow would appear to work and never persist.
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** How many of one thing a shopper may ask for. */
export const MAX_LINE_QUANTITY = 999;

/**
 * A quantity from a form, narrowed to something that can reach the database.
 *
 * Zero is meaningful — it removes the line — so this returns it rather than
 * treating it as absent. Negative and non-numeric become zero as well: a
 * request for minus four of something is not an instruction anybody meant.
 */
export function normaliseQuantity(input: unknown): number {
  const parsed = Number(String(input ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_LINE_QUANTITY);
}
