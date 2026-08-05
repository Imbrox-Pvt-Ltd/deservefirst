/**
 * Storefront · domain/domains.ts
 * A hostname a merchant owns, and the proof that they own it.
 *
 * Until now a store answered only at `handle.stores.<platform>`, and the
 * resolver said why: *"a host that merely claims to be a store is not one, and
 * accepting the claim would let anyone point a hostname at us and serve someone
 * else's shop under it."* This file is that missing step.
 *
 * The threat is worth stating plainly, because it decides the whole design. If
 * a merchant could attach any hostname to their store without proving they own
 * it, the first thing anyone would attach is a name that is not theirs — a bank,
 * a competitor, a brand they are pretending to be. They would not even need to
 * control DNS today: they claim `example.com` now, and the moment the real owner
 * points that name anywhere near us, our platform serves an impostor's shop from
 * it. The claim has to be proved before it is honoured, and proved against
 * something only the owner controls.
 *
 * So a domain has **two independent checks** and both are real:
 *
 *   - **Ownership** — a TXT record only whoever controls the zone can publish.
 *     This is the security boundary. Nothing is served without it.
 *   - **Connectivity** — an A or CNAME pointing at us. Not a security property
 *     at all; it is the difference between "verified" and "actually working",
 *     and reporting it separately is what stops a merchant staring at a
 *     correctly-verified domain that loads nothing.
 *
 * Everything here is pure: a hostname in, a decision out. The DNS lookups
 * themselves are infrastructure, and the split is what lets every rule below be
 * tested without a network.
 * Layer: domain (pure).
 */

export type DomainStatus = 'pending' | 'verified' | 'failed';

/**
 * Whether this is the name the store canonically lives at.
 *
 * Exactly one primary per store. An alias still resolves, but redirects to the
 * primary — see `canonicalRedirect`.
 */
export type DomainRole = 'primary' | 'alias';

export interface StoreDomain {
  readonly id: string;
  readonly host: string;
  readonly role: DomainRole;
  readonly status: DomainStatus;
  readonly verificationToken: string;
  readonly verifiedAt: Date | null;
}

export type DomainRejection =
  | 'empty'
  | 'too-long'
  | 'not-a-hostname'
  | 'single-label'
  | 'ip-address'
  | 'reserved'
  | 'platform-owned';

export interface NormalisedDomain {
  readonly ok: true;
  readonly host: string;
}

export interface RejectedDomain {
  readonly ok: false;
  readonly reason: DomainRejection;
  /** Written for the merchant typing it in, not for us. */
  readonly message: string;
}

/** Hostnames nobody may attach, whatever their DNS says. */
const RESERVED = new Set(['localhost', 'local', 'test', 'invalid', 'example', 'internal']);

/**
 * Cleans up what a merchant pasted, or explains why it cannot be a domain.
 *
 * People paste `https://shop.example.com/`, `SHOP.Example.com.`, and
 * `shop.example.com:443`. Rejecting those as malformed would be technically
 * defensible and would make the form feel broken, so each is understood and
 * reduced to the hostname. What is NOT accepted is anything ambiguous about
 * *which* name is being claimed, because that ambiguity is the whole attack.
 */
export function normaliseDomain(
  input: string,
  platformHosts: readonly string[] = [],
): NormalisedDomain | RejectedDomain {
  const trimmed = String(input ?? '').trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty', message: 'Enter a domain.' };
  }

  /**
   * Parsed as a URL, which does the punycode conversion for us.
   *
   * A merchant with an internationalised domain types it in their own script,
   * and DNS only knows the ASCII form — `münchen.example` has to become
   * `xn--mnchen-3ya.example` before any lookup will find it. Asking them to
   * convert it themselves would be asking them to do a job the platform can do.
   */
  let host: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'not-a-hostname', message: 'That does not look like a domain.' };
  }

  // A trailing dot is the fully-qualified form and means the same name; keeping
  // it would store two rows that are one domain.
  host = host.replace(/\.$/, '');

  if (host === '') {
    return { ok: false, reason: 'not-a-hostname', message: 'That does not look like a domain.' };
  }
  if (host.length > 253) {
    return { ok: false, reason: 'too-long', message: 'A domain cannot be longer than 253 characters.' };
  }

  /**
   * An IP address is not a domain, and `new URL` normalises them helpfully
   * enough to sneak past a label check — `[::1]` arrives bracketed and
   * `0x7f.1` arrives as `127.0.0.1`. Neither can be verified by TXT record,
   * and one of them is a request to serve a store from inside our own network.
   */
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return { ok: false, reason: 'ip-address', message: 'Enter a domain name rather than an IP address.' };
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    return {
      ok: false,
      reason: 'single-label',
      message: 'Enter a full domain, like shop.example.com.',
    };
  }

  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return { ok: false, reason: 'not-a-hostname', message: 'That does not look like a domain.' };
    }
  }

  /**
   * Our own hostnames are not connectable, and this is a security check rather
   * than tidiness.
   *
   * `admin.<platform>` attached to a merchant's store would let them serve
   * their own markup from the admin's origin — every cookie, every session and
   * every same-origin assumption in the product belongs to that name. The
   * storefront suffix is refused too: those hostnames are handed out by handle,
   * and a row claiming one would compete with the handle that already owns it.
   *
   * Checked BEFORE the reserved-TLD rule below, and the order is deliberate.
   * The platform's own hostnames may sit under a reserved TLD in development,
   * and answering "that is a reserved domain" to somebody trying to attach
   * `admin.<platform>` would hide the more important refusal behind a less
   * important one.
   */
  for (const platform of platformHosts) {
    const owned = platform.toLowerCase();
    if (host === owned || host.endsWith(`.${owned}`)) {
      return {
        ok: false,
        reason: 'platform-owned',
        message: 'That domain belongs to the platform and cannot be connected.',
      };
    }
  }

  /**
   * The TLDs RFC 2606 sets aside, which nobody can own and which therefore
   * nobody can prove they own.
   */
  const last = labels[labels.length - 1] as string;
  if (RESERVED.has(host) || RESERVED.has(last)) {
    return {
      ok: false,
      reason: 'reserved',
      message: 'That domain is reserved and cannot be connected.',
    };
  }

  return { ok: true, host };
}

/**
 * Where the ownership record goes.
 *
 * Under a `_`-prefixed subdomain rather than at the apex, because the apex TXT
 * record is where SPF, DMARC and every other vendor's verification already
 * live. Writing there means a merchant editing one vendor's record can break
 * another's, and support tickets that look like our bug.
 */
export function verificationRecordName(host: string): string {
  return `_deservefirst.${host}`;
}

/** The TXT value proving ownership. Unique per domain, never reused. */
export function verificationValue(token: string): string {
  return `deservefirst-site-verification=${token}`;
}

export interface ExpectedRecords {
  readonly ownership: { readonly type: 'TXT'; readonly name: string; readonly value: string };
  readonly connectivity:
    | { readonly type: 'CNAME'; readonly name: string; readonly value: string }
    | { readonly type: 'A'; readonly name: string; readonly value: string };
}

/**
 * What to tell the merchant to add at their registrar.
 *
 * A subdomain gets a CNAME and an apex gets an A record, because that is what
 * DNS permits rather than what we would prefer: a CNAME at the apex conflicts
 * with the SOA and NS records that have to exist there, and most registrars
 * will simply refuse it.
 */
export function expectedRecords(
  host: string,
  token: string,
  target: { readonly cname: string; readonly ipv4: string },
): ExpectedRecords {
  const ownership = {
    type: 'TXT' as const,
    name: verificationRecordName(host),
    value: verificationValue(token),
  };

  return {
    ownership,
    connectivity: isApex(host)
      ? { type: 'A' as const, name: host, value: target.ipv4 }
      : { type: 'CNAME' as const, name: host, value: target.cname },
  };
}

/**
 * Whether this is the registrable name itself rather than something under it.
 *
 * Two labels, which is right for `example.com` and wrong for `example.co.uk` —
 * a correct answer needs the public suffix list, which is a large file that
 * changes. Being wrong here costs a merchant on a multi-part TLD the wrong
 * *instruction*, not a security failure: we show them a CNAME where an A record
 * was needed, they tell us it did not work, and `evaluateVerification` accepts
 * either. Shipping the list is a later improvement, not a correctness fix.
 */
function isApex(host: string): boolean {
  return host.split('.').length === 2;
}

export interface ObservedRecords {
  /** Every TXT value found at the verification name. */
  readonly txt: readonly string[];
  /** Where the host's CNAME points, if it has one. */
  readonly cname: string | null;
  /** The addresses the host resolves to. */
  readonly addresses: readonly string[];
  /** Set when the lookup itself failed rather than returning nothing. */
  readonly error?: string | null;
}

export interface VerificationResult {
  readonly status: DomainStatus;
  /** Proved ownership. Nothing is served without this. */
  readonly owns: boolean;
  /** Traffic will actually arrive. Diagnostic, not a security property. */
  readonly reachesUs: boolean;
  /** What to tell the merchant to do next. */
  readonly message: string;
}

/**
 * Decides what the observed DNS means.
 *
 * Ownership is the only thing that gates serving. Connectivity is reported
 * separately so a merchant whose TXT record is correct and whose CNAME is not
 * gets told the useful half — the alternative is a domain that verifies and
 * then loads nothing, which reads as a broken platform.
 */
export function evaluateVerification(
  observed: ObservedRecords,
  expected: ExpectedRecords,
): VerificationResult {
  if (observed.error) {
    /**
     * A lookup that failed is PENDING, never failed.
     *
     * DNS propagates for minutes to days, and a resolver timeout says nothing
     * about the merchant's records. Marking this a failure would tell somebody
     * who did everything right that they did it wrong.
     */
    return {
      status: 'pending',
      owns: false,
      reachesUs: false,
      message: 'We could not read this domain’s DNS yet. New records can take a while to appear.',
    };
  }

  /**
   * Compared after trimming and unquoting: TXT values come back quoted from
   * some resolvers and split into chunks by others, and a merchant whose record
   * is correct should not fail because of how it was transported.
   */
  const owns = observed.txt.some(
    (value) => value.trim().replace(/^"|"$/g, '') === expected.ownership.value,
  );

  const reachesUs =
    expected.connectivity.type === 'CNAME'
      ? (observed.cname ?? '').replace(/\.$/, '').toLowerCase() ===
        expected.connectivity.value.toLowerCase()
      : observed.addresses.includes(expected.connectivity.value);

  if (!owns) {
    return {
      status: 'pending',
      owns: false,
      reachesUs,
      message: `Add a TXT record at ${expected.ownership.name} with the value we show, then check again.`,
    };
  }

  if (!reachesUs) {
    return {
      status: 'verified',
      owns: true,
      reachesUs: false,
      message:
        `Ownership confirmed. Traffic is not reaching us yet — point ${expected.connectivity.name} ` +
        `at ${expected.connectivity.value} with ${expected.connectivity.type === 'A' ? 'an A' : 'a CNAME'} record.`,
    };
  }

  return { status: 'verified', owns: true, reachesUs: true, message: 'This domain is connected.' };
}

/**
 * Whether a domain may actually serve the storefront.
 *
 * The single question the resolver asks. Kept as a named function rather than
 * an inline comparison so there is exactly one place that can be got wrong.
 */
export function isServable(domain: Pick<StoreDomain, 'status'>): boolean {
  return domain.status === 'verified';
}

/**
 * Where a request should be redirected so that one page has one URL.
 *
 * Search engines treat two hostnames serving identical pages as duplicate
 * content and split the ranking between them, which costs the merchant the
 * traffic they connected a domain to get. So an alias — and the platform
 * subdomain, once a primary exists — redirects permanently to the primary.
 *
 * Returns null when the request is already canonical, and the caller must treat
 * null as "carry on" rather than as an error.
 */
export function canonicalRedirect(input: {
  readonly requestHost: string;
  readonly primaryHost: string | null;
  readonly path: string;
  readonly query: string;
}): string | null {
  const primary = input.primaryHost?.toLowerCase() ?? null;
  if (!primary) return null;

  const from = input.requestHost.toLowerCase();
  if (from === primary) return null;

  const query = input.query ? `?${input.query}` : '';
  return `https://${primary}${input.path}${query}`;
}

/**
 * Applies a change of primary to the store's set of domains.
 *
 * "Exactly one primary" is a statement about the SET, not about any row, which
 * is why it is computed here over all of them rather than enforced by a column
 * — the same reasoning as a theme's `main` role. Returns every domain whose
 * role changed, so the caller writes one statement rather than one per row.
 */
export function planPrimaryChange(
  domains: readonly StoreDomain[],
  promoteId: string,
): readonly { readonly id: string; readonly role: DomainRole }[] {
  const target = domains.find((domain) => domain.id === promoteId);
  if (!target) throw new Error('That domain is not connected to this store.');

  if (!isServable(target)) {
    // A pending domain made primary would redirect the whole storefront to a
    // hostname that does not reach us — the store would go dark.
    throw new Error('A domain must be verified before it can be the primary one.');
  }

  return domains
    .map((domain) => ({
      id: domain.id,
      role: (domain.id === promoteId ? 'primary' : 'alias') as DomainRole,
    }))
    .filter((next) => {
      const current = domains.find((domain) => domain.id === next.id);
      return current?.role !== next.role;
    });
}
