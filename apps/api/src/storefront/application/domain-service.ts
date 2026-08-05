/**
 * Storefront · application/domain-service.ts
 * Connecting a hostname to a store, and checking whether the claim holds.
 *
 * The rules are all in `domain/domains.ts` and this is what carries them out:
 * it decides nothing about what a valid domain is, and everything about the
 * order operations happen in. That order is the interesting part.
 *
 * A domain is CLAIMED first and PROVED later, which is the only shape that
 * works — DNS takes minutes to days to propagate, so a flow that demanded the
 * TXT record before creating the row would ask a merchant to publish a token
 * they have not been given. So the row exists from the start, in `pending`, and
 * `pending` means "serves nothing".
 *
 * The security property to hold on to: nothing in this file makes a domain
 * servable except an observed DNS record matching a token we generated. Not
 * creating it, not naming it primary, not any admin action. `verify` is the
 * only door.
 * Layer: application.
 */

import {
  canonicalRedirect,
  evaluateVerification,
  expectedRecords,
  isServable,
  normaliseDomain,
  planPrimaryChange,
  type DomainStatus,
  type ExpectedRecords,
  type ObservedRecords,
  type StoreDomain,
  type VerificationResult,
} from '../domain';

export interface DomainRepository {
  all(): Promise<readonly StoreDomain[]>;
  byId(id: string): Promise<StoreDomain | null>;
  /**
   * Across EVERY store, which is why it is named as such.
   *
   * Two stores claiming one hostname is the thing this exists to prevent, and
   * that question cannot be answered inside one store's scope.
   */
  findAnyStoreClaiming(host: string): Promise<{ storeId: string; status: DomainStatus } | null>;
  create(input: {
    readonly host: string;
    readonly role: 'primary' | 'alias';
    readonly verificationToken: string;
  }): Promise<StoreDomain>;
  recordCheck(
    id: string,
    result: { readonly status: DomainStatus; readonly reachesUs: boolean; readonly verifiedAt: Date | null },
  ): Promise<void>;
  /** Applies every role change in one statement — see `planPrimaryChange`. */
  applyRoles(changes: readonly { readonly id: string; readonly role: 'primary' | 'alias' }[]): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What the platform tells merchants to point their DNS at. */
export interface DomainTarget {
  readonly cname: string;
  readonly ipv4: string;
}

export interface DnsProbe {
  lookup(host: string, verificationName: string): Promise<ObservedRecords>;
}

export class DomainError extends Error {
  constructor(
    readonly code: 'invalid' | 'taken' | 'not_found' | 'not_verified' | 'last_primary',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface ConnectedDomain {
  readonly domain: StoreDomain;
  /** What to show the merchant to put at their registrar. */
  readonly records: ExpectedRecords;
}

export class DomainService {
  constructor(
    private readonly domains: DomainRepository,
    private readonly probe: DnsProbe,
    private readonly target: DomainTarget,
    /** The platform's own hostnames, which nobody may connect. */
    private readonly platformHosts: readonly string[],
    private readonly newToken: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<readonly ConnectedDomain[]> {
    const all = await this.domains.all();
    return all.map((domain) => ({
      domain,
      records: expectedRecords(domain.host, domain.verificationToken, this.target),
    }));
  }

  /**
   * Claims a hostname for this store.
   *
   * The claim is recorded and nothing is served. What makes this safe is that
   * `status` starts at `pending` and only `verify` can move it.
   */
  async connect(input: string): Promise<ConnectedDomain> {
    const normalised = normaliseDomain(input, this.platformHosts);
    if (!normalised.ok) throw new DomainError('invalid', normalised.message);

    const host = normalised.host;

    /**
     * Whether anyone else has this name, and what state their claim is in.
     *
     * The two cases are genuinely different and conflating them would either
     * hand a domain to the wrong store or strand a merchant forever:
     *
     * A **verified** claim elsewhere is final. Somebody has proved they own
     * this name, and until they disconnect it nobody else may have it.
     *
     * A **pending** claim elsewhere is worth nothing — it is a row somebody
     * typed. Blocking on it would mean anyone could permanently reserve every
     * domain on the internet by typing them into a trial store, which is a
     * denial-of-service with a signup form. So a second store may claim the
     * same pending name, and whoever proves ownership first gets it.
     */
    const existing = await this.domains.findAnyStoreClaiming(host);
    if (existing && isServable({ status: existing.status })) {
      throw new DomainError(
        'taken',
        // Deliberately not saying WHICH store. That would turn this endpoint
        // into a way to ask which of your competitors is on this platform.
        'That domain is already connected and verified elsewhere.',
      );
    }

    const mine = await this.domains.all();
    if (mine.some((domain) => domain.host === host)) {
      throw new DomainError('taken', 'That domain is already connected to this store.');
    }

    /**
     * The first domain is not automatically primary.
     *
     * It cannot be: primary means "redirect the whole storefront here", and a
     * domain nobody has verified yet does not reach us. A store that made its
     * first unverified domain primary would go dark the moment it was added.
     */
    const domain = await this.domains.create({
      host,
      role: 'alias',
      verificationToken: this.newToken(),
    });

    return { domain, records: expectedRecords(host, domain.verificationToken, this.target) };
  }

  /**
   * Looks at DNS and records what it found.
   *
   * The only path to `verified`. Safe to call as often as a merchant likes —
   * it reads DNS and writes a status, and re-reading a verified domain that is
   * still correct is a no-op.
   */
  async verify(id: string): Promise<{ domain: StoreDomain; result: VerificationResult }> {
    const domain = await this.domains.byId(id);
    if (!domain) throw new DomainError('not_found', 'That domain is not connected to this store.');

    const records = expectedRecords(domain.host, domain.verificationToken, this.target);
    const observed = await this.probe.lookup(domain.host, records.ownership.name);
    const result = evaluateVerification(observed, records);

    /**
     * A domain that was verified and now is not stays verified.
     *
     * DNS fails transiently far more often than a merchant genuinely revokes a
     * record, and demoting on the first bad read would take a working
     * storefront offline because a resolver timed out. Losing a domain should
     * be something a merchant does deliberately.
     */
    const keepVerified = isServable(domain) && !result.owns;

    await this.domains.recordCheck(id, {
      status: keepVerified ? 'verified' : result.status,
      reachesUs: result.reachesUs,
      verifiedAt: result.owns ? (domain.verifiedAt ?? this.now()) : domain.verifiedAt,
    });

    const updated = await this.domains.byId(id);
    return { domain: updated ?? domain, result };
  }

  /** Makes one domain the canonical one. Verified domains only. */
  async makePrimary(id: string): Promise<void> {
    const all = await this.domains.all();

    let changes;
    try {
      changes = planPrimaryChange(all, id);
    } catch (error) {
      throw new DomainError('not_verified', (error as Error).message);
    }

    if (changes.length > 0) await this.domains.applyRoles(changes);
  }

  /**
   * Disconnects a domain.
   *
   * The primary may be removed, and the store falls back to its platform
   * subdomain — which always works and is never disconnectable. Refusing would
   * trap a merchant who mistyped a domain they no longer control, and there is
   * no state in which they should be unable to undo that.
   */
  async disconnect(id: string): Promise<void> {
    const domain = await this.domains.byId(id);
    if (!domain) throw new DomainError('not_found', 'That domain is not connected to this store.');
    await this.domains.remove(id);
  }

  /** The store's canonical hostname, or null while it has none. */
  async primaryHost(): Promise<string | null> {
    const all = await this.domains.all();
    const primary = all.find((domain) => domain.role === 'primary' && isServable(domain));
    return primary?.host ?? null;
  }

  /** Where a request should go so that one page has one URL. */
  async redirectFor(requestHost: string, path: string, query: string): Promise<string | null> {
    return canonicalRedirect({
      requestHost,
      primaryHost: await this.primaryHost(),
      path,
      query,
    });
  }
}
