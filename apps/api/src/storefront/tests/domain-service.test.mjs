/**
 * Storefront · tests/domain-service.test.mjs
 * Claiming a hostname, proving it, and what happens when two stores want one.
 *
 * The rules live in `domain/domains.ts` and are tested next door. What is
 * tested here is ORDER and STATE — the things a service can get wrong even when
 * every rule it calls is right: serving a domain nobody proved, letting a
 * pending claim block the real owner forever, or dropping a working domain
 * because a nameserver blinked.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DomainService, DomainError } from '../../../dist/storefront/application/index.js';

const TARGET = { cname: 'shops.deservefirst.example', ipv4: '203.0.113.10' };
const PLATFORM = ['deservefirst.example', 'stores.deservefirst.example'];

/** An in-memory repository, standing in for one store's rows. */
class FakeRepository {
  constructor(rows = [], others = new Map()) {
    this.rows = rows;
    /** host -> what some OTHER store's claim on it looks like. */
    this.others = others;
    this.nextId = rows.length + 1;
  }

  async all() { return this.rows; }
  async byId(id) { return this.rows.find((row) => row.id === id) ?? null; }

  async findAnyStoreClaiming(host) {
    const mine = this.rows.find((row) => row.host === host);
    // Verified wins over pending, whoever holds it.
    const candidates = [this.others.get(host), mine && { storeId: 'me', status: mine.status }]
      .filter(Boolean)
      .sort((a, b) => (a.status === 'verified' ? -1 : 1));
    return candidates[0] ?? null;
  }

  async create(input) {
    const row = {
      id: `d${this.nextId++}`,
      host: input.host,
      role: input.role,
      status: 'pending',
      verificationToken: input.verificationToken,
      verifiedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async recordCheck(id, result) {
    const row = this.rows.find((entry) => entry.id === id);
    Object.assign(row, { status: result.status, verifiedAt: result.verifiedAt });
  }

  async applyRoles(changes) {
    for (const change of changes) {
      const row = this.rows.find((entry) => entry.id === change.id);
      row.role = change.role;
    }
  }

  async remove(id) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

const probeReturning = (records) => ({ lookup: async () => ({ txt: [], cname: null, addresses: [], ...records }) });

const serviceWith = (repository, probe = probeReturning({})) =>
  new DomainService(repository, probe, TARGET, PLATFORM, () => 'tok-fixed', () => new Date('2026-08-06T00:00:00Z'));

// ----------------------------------------------------------------- claiming

test('a new domain starts pending and serves nothing', async () => {
  /**
   * The security property the whole feature rests on. A row is a claim, and a
   * claim is not a proof.
   */
  const repository = new FakeRepository();
  const entry = await serviceWith(repository).connect('shop.acme-brand.co');

  assert.equal(entry.domain.status, 'pending');
  assert.equal(entry.domain.verifiedAt, null);
  assert.equal(entry.domain.role, 'alias', 'not primary — an unverified primary would take the store dark');
});

test('the records to publish come back with the claim', async () => {
  // A domain without its DNS records is a token nobody can act on.
  const entry = await serviceWith(new FakeRepository()).connect('shop.acme-brand.co');

  assert.equal(entry.records.ownership.name, '_deservefirst.shop.acme-brand.co');
  assert.match(entry.records.ownership.value, /tok-fixed$/);
  assert.equal(entry.records.connectivity.value, TARGET.cname);
});

test('a domain the platform owns is refused', async () => {
  await assert.rejects(
    () => serviceWith(new FakeRepository()).connect('admin.deservefirst.example'),
    (error) => error instanceof DomainError && error.code === 'invalid',
  );
});

test('the same store cannot connect a domain twice', async () => {
  const repository = new FakeRepository();
  const service = serviceWith(repository);
  await service.connect('shop.acme-brand.co');

  await assert.rejects(
    () => service.connect('shop.acme-brand.co'),
    (error) => error.code === 'taken',
  );
});

test('a domain another store has VERIFIED cannot be claimed', async () => {
  /**
   * Somebody proved they own this name. Until they disconnect it, nobody else
   * may have it — and the refusal deliberately does not say who holds it, which
   * would turn this endpoint into a way to ask which competitors are here.
   */
  const others = new Map([['shop.acme-brand.co', { storeId: 'other', status: 'verified' }]]);
  const service = serviceWith(new FakeRepository([], others));

  await assert.rejects(
    () => service.connect('shop.acme-brand.co'),
    (error) => error.code === 'taken' && !/other/.test(error.message),
  );
});

test('a domain another store merely CLAIMED does not block the real owner', async () => {
  /**
   * The denial-of-service this avoids: if a pending row reserved a name, anyone
   * could permanently lock every domain on the internet by typing them into a
   * trial store. A pending claim is worth nothing, so both may hold one and
   * whoever proves ownership first gets it.
   */
  const others = new Map([['shop.acme-brand.co', { storeId: 'other', status: 'pending' }]]);
  const entry = await serviceWith(new FakeRepository([], others)).connect('shop.acme-brand.co');

  assert.equal(entry.domain.status, 'pending');
});

// ----------------------------------------------------------------- proving

const claimed = () =>
  new FakeRepository([
    { id: 'd1', host: 'shop.acme-brand.co', role: 'alias', status: 'pending', verificationToken: 'tok-fixed', verifiedAt: null },
  ]);

test('the wrong TXT record leaves it pending', async () => {
  const repository = claimed();
  const service = serviceWith(repository, probeReturning({ txt: ['deservefirst-site-verification=wrong'] }));

  const { domain } = await service.verify('d1');
  assert.equal(domain.status, 'pending');
  assert.equal(domain.verifiedAt, null);
});

test('the right TXT record verifies and stamps the time', async () => {
  const repository = claimed();
  const service = serviceWith(repository, probeReturning({ txt: ['deservefirst-site-verification=tok-fixed'] }));

  const { domain, result } = await service.verify('d1');
  assert.equal(domain.status, 'verified');
  assert.ok(domain.verifiedAt);
  assert.equal(result.owns, true);
});

test('a verified domain survives a DNS blip', async () => {
  /**
   * DNS fails transiently far more often than a merchant revokes a record.
   * Demoting on the first bad read would take a working storefront offline
   * because a resolver timed out.
   */
  const repository = claimed();
  await serviceWith(repository, probeReturning({ txt: ['deservefirst-site-verification=tok-fixed'] })).verify('d1');

  const { domain } = await serviceWith(repository, probeReturning({ error: 'ETIMEOUT' })).verify('d1');
  assert.equal(domain.status, 'verified', 'still serving');
});

test('re-verifying keeps the original verification time', async () => {
  // The date a merchant proved ownership does not move because they clicked
  // "check" again.
  const repository = claimed();
  const probe = probeReturning({ txt: ['deservefirst-site-verification=tok-fixed'] });

  const first = await serviceWith(repository, probe).verify('d1');
  const again = await serviceWith(repository, probe).verify('d1');

  assert.deepEqual(again.domain.verifiedAt, first.domain.verifiedAt);
});

test('verifying something that is not ours is a not-found', async () => {
  await assert.rejects(
    () => serviceWith(claimed()).verify('someone-elses'),
    (error) => error.code === 'not_found',
  );
});

// --------------------------------------------------------------- choosing

test('only a verified domain may become primary', async () => {
  await assert.rejects(
    () => serviceWith(claimed()).makePrimary('d1'),
    (error) => error instanceof DomainError && error.code === 'not_verified',
  );
});

test('promoting one demotes the previous primary', async () => {
  const repository = new FakeRepository([
    { id: 'd1', host: 'a.acme-brand.co', role: 'primary', status: 'verified', verificationToken: 't', verifiedAt: new Date() },
    { id: 'd2', host: 'b.acme-brand.co', role: 'alias', status: 'verified', verificationToken: 't', verifiedAt: new Date() },
  ]);

  await serviceWith(repository).makePrimary('d2');

  assert.equal(repository.rows.find((row) => row.id === 'd1').role, 'alias');
  assert.equal(repository.rows.find((row) => row.id === 'd2').role, 'primary');
});

test('the primary host is only reported once it is verified', async () => {
  const repository = new FakeRepository([
    { id: 'd1', host: 'a.acme-brand.co', role: 'primary', status: 'pending', verificationToken: 't', verifiedAt: null },
  ]);

  assert.equal(await serviceWith(repository).primaryHost(), null, 'or the store redirects into a void');
});

test('a store with no domains has no primary and keeps working', async () => {
  const service = serviceWith(new FakeRepository());
  assert.equal(await service.primaryHost(), null);
  assert.equal(await service.redirectFor('demo.stores.deservefirst.example', '/', ''), null);
});

test('an alias redirects to the primary', async () => {
  const repository = new FakeRepository([
    { id: 'd1', host: 'acme-brand.co', role: 'primary', status: 'verified', verificationToken: 't', verifiedAt: new Date() },
  ]);

  assert.equal(
    await serviceWith(repository).redirectFor('demo.stores.deservefirst.example', '/products/hat', 'variant=red'),
    'https://acme-brand.co/products/hat?variant=red',
  );
});

// ------------------------------------------------------------ disconnecting

test('the primary may be disconnected, and the store falls back', async () => {
  /**
   * Refusing would trap a merchant who connected a domain they no longer
   * control. The platform subdomain always works and cannot be disconnected,
   * so there is always somewhere to fall back to.
   */
  const repository = new FakeRepository([
    { id: 'd1', host: 'acme-brand.co', role: 'primary', status: 'verified', verificationToken: 't', verifiedAt: new Date() },
  ]);

  await serviceWith(repository).disconnect('d1');
  assert.equal(repository.rows.length, 0);
  assert.equal(await serviceWith(repository).primaryHost(), null);
});

test('disconnecting something that is not ours is a not-found', async () => {
  await assert.rejects(
    () => serviceWith(claimed()).disconnect('someone-elses'),
    (error) => error.code === 'not_found',
  );
});
