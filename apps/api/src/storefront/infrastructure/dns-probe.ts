/**
 * Storefront · infrastructure/dns-probe.ts
 * Reading what a merchant actually published in DNS.
 *
 * The only part of domain verification that touches the network, kept behind
 * `DnsProbe` so every rule about what the answers MEAN is pure and testable
 * without one. This file has no opinions; it returns what it saw.
 *
 * Three properties matter here and none of them are about correctness of the
 * lookup:
 *
 * **It must not hang.** A merchant clicking "check" waits on this, and a
 * nameserver that never answers would hold the request open until something
 * else gave up. The resolver gets an explicit timeout and a bounded retry.
 *
 * **A missing record is not an error.** `NODATA` and `NXDOMAIN` are the normal
 * answers for a merchant who has not added the record yet — the overwhelmingly
 * common case. Treating them as failures would turn "you have not finished" into
 * "something went wrong".
 *
 * **A failure is reported as a failure, not as an absence.** They lead to
 * opposite messages: an empty answer means "add the record", a timeout means
 * "we could not look". Collapsing the two tells somebody who did everything
 * right that they did it wrong.
 * Layer: infrastructure.
 */

import { Resolver } from 'node:dns/promises';

import type { DnsProbe } from '../application/domain-service';
import type { ObservedRecords } from '../domain';

export interface DnsProbeOptions {
  /** How long one query may take. */
  readonly timeoutMs?: number;
  /**
   * Resolvers to ask. Defaults to the system's.
   *
   * Worth overriding in production: asking a public resolver rather than a
   * caching one nearby means a merchant who just fixed their record sees it
   * sooner, and negative caching is what makes verification feel broken.
   */
  readonly servers?: readonly string[];
}

/**
 * Errors meaning "there is no such record", as opposed to "we could not ask".
 *
 * The distinction is the whole reason this list exists.
 */
const NO_RECORD = new Set(['ENODATA', 'ENOTFOUND', 'ENXDOMAIN']);

export class NodeDnsProbe implements DnsProbe {
  private readonly resolver: Resolver;

  constructor(options: DnsProbeOptions = {}) {
    // `tries` bounds the retries the resolver makes internally; without both,
    // the effective wait is the timeout multiplied by an unbounded count.
    this.resolver = new Resolver({ timeout: options.timeoutMs ?? 5_000, tries: 2 });
    if (options.servers && options.servers.length > 0) {
      this.resolver.setServers([...options.servers]);
    }
  }

  async lookup(host: string, verificationName: string): Promise<ObservedRecords> {
    /**
     * All three run together, because they are independent and a merchant is
     * waiting. In sequence this is three timeouts deep in the bad case.
     */
    const [txt, cname, addresses] = await Promise.all([
      this.txt(verificationName),
      this.cname(host),
      this.addresses(host),
    ]);

    /**
     * Only a genuine failure becomes an error.
     *
     * The TXT lookup is the one that decides ownership, so its failure is what
     * makes the whole result inconclusive. A CNAME or A lookup that failed
     * affects only the diagnostic half, and reporting the whole check as
     * unreadable because of it would hide a perfectly good verification.
     */
    return {
      txt: txt.values,
      cname: cname.value,
      addresses: addresses.values,
      error: txt.error,
    };
  }

  private async txt(name: string): Promise<{ values: string[]; error: string | null }> {
    try {
      const records = await this.resolver.resolveTxt(name);
      /**
       * TXT values arrive as arrays of chunks, because a single string cannot
       * exceed 255 bytes on the wire and long records are split. Joining is
       * what makes a record published as two chunks compare equal to the one
       * value the merchant typed.
       */
      return { values: records.map((chunks) => chunks.join('')), error: null };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'EUNKNOWN';
      // No record is a normal answer for somebody who has not added it yet.
      if (NO_RECORD.has(code)) return { values: [], error: null };
      return { values: [], error: code };
    }
  }

  private async cname(host: string): Promise<{ value: string | null }> {
    try {
      const records = await this.resolver.resolveCname(host);
      return { value: records[0] ?? null };
    } catch {
      // An apex domain has no CNAME and never will; that is not a problem.
      return { value: null };
    }
  }

  private async addresses(host: string): Promise<{ values: string[] }> {
    try {
      return { values: await this.resolver.resolve4(host) };
    } catch {
      return { values: [] };
    }
  }
}
