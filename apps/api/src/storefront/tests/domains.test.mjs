/**
 * Storefront · tests/domains.test.mjs
 * Connecting a hostname, and proving it belongs to whoever connected it.
 *
 * The tests that matter here are the refusals. A platform that attaches any
 * hostname a merchant types is one where the first name attached is somebody
 * else's — and the damage lands on whoever owns it, not on us.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalRedirect,
  evaluateVerification,
  expectedRecords,
  isServable,
  normaliseDomain,
  planPrimaryChange,
  verificationRecordName,
  verificationValue,
} from '../../../dist/storefront/domain/index.js';

const PLATFORM = ['deservefirst.example', 'stores.deservefirst.example', 'admin.deservefirst.example'];

// ------------------------------------------------------- what a domain is

test('what a merchant pastes is understood rather than refused', () => {
  /**
   * People paste a URL from their browser bar. Rejecting that as malformed
   * would be defensible and would make the form feel broken.
   */
  for (const input of [
    'shop.acme-brand.co',
    'https://shop.acme-brand.co',
    'https://shop.acme-brand.co/collections/all',
    '  SHOP.Acme-Brand.CO  ',
    'shop.acme-brand.co.',
    'https://shop.acme-brand.co:443/',
  ]) {
    const result = normaliseDomain(input, PLATFORM);
    assert.equal(result.ok, true, input);
    assert.equal(result.host, 'shop.acme-brand.co', input);
  }
});

test('an internationalised domain is converted rather than rejected', () => {
  // DNS only knows the ASCII form. Asking a merchant to punycode their own
  // domain is asking them to do a job the platform can do.
  const result = normaliseDomain('münchen.acme-brand.co', PLATFORM);
  assert.equal(result.ok, true);
  assert.equal(result.host, 'xn--mnchen-3ya.acme-brand.co');
});

test('an IP address is not a domain', () => {
  /**
   * Neither can be proved by TXT record, and one of them is a request to serve
   * a store from inside our own network.
   */
  for (const input of ['127.0.0.1', 'http://10.0.0.5', '[::1]', 'http://0x7f.1']) {
    const result = normaliseDomain(input, PLATFORM);
    assert.equal(result.ok, false, input);
    assert.equal(result.reason, 'ip-address', input);
  }
});

test('a single label is not a full domain', () => {
  const result = normaliseDomain('localhost', PLATFORM);
  assert.equal(result.ok, false);
  assert.match(result.message, /full domain/);
});

test('the platform’s own hostnames cannot be connected', () => {
  /**
   * The security-relevant refusal. `admin.<platform>` attached to a merchant's
   * store would let them serve their own markup from the admin's origin — every
   * cookie and every same-origin assumption in the product belongs to that name.
   */
  for (const input of [
    'admin.deservefirst.example',
    'deservefirst.example',
    'anything.stores.deservefirst.example',
    'ADMIN.deservefirst.example',
  ]) {
    const result = normaliseDomain(input, PLATFORM);
    assert.equal(result.ok, false, input);
    assert.equal(result.reason, 'platform-owned', input);
  }
});

test('a lookalike of a platform host is still allowed', () => {
  // `notdeservefirst.example` merely ends in similar text; refusing it would be
  // a suffix check done with `includes`.
  assert.equal(normaliseDomain('notdeservefirst.co', PLATFORM).ok, true);
  assert.equal(normaliseDomain('deservefirst-lookalike.co', PLATFORM).ok, true);
});

test('malformed input is refused rather than half-parsed', () => {
  for (const input of ['', '   ', '-leading.acme-brand.co', 'trailing-.acme-brand.co', 'a..b.com']) {
    assert.equal(normaliseDomain(input, PLATFORM).ok, false, JSON.stringify(input));
  }
});

// --------------------------------------------------------- what to publish

test('ownership goes under a prefixed name, not at the apex', () => {
  /**
   * The apex TXT record is where SPF, DMARC and every other vendor's
   * verification already live. Writing there means a merchant editing one
   * vendor's record breaks another's.
   */
  assert.equal(verificationRecordName('acme-brand.co'), '_deservefirst.acme-brand.co');
  assert.match(verificationValue('abc'), /^deservefirst-site-verification=abc$/);
});

test('an apex gets an A record and a subdomain gets a CNAME', () => {
  // Not a preference: a CNAME at the apex conflicts with the SOA and NS records
  // that have to exist there, and most registrars refuse it outright.
  const target = { cname: 'shops.deservefirst.example', ipv4: '203.0.113.10' };

  assert.equal(expectedRecords('acme-brand.co', 't', target).connectivity.type, 'A');
  assert.equal(expectedRecords('shop.acme-brand.co', 't', target).connectivity.type, 'CNAME');
});

// ------------------------------------------------------------ the verdict

const target = { cname: 'shops.deservefirst.example', ipv4: '203.0.113.10' };
const expected = expectedRecords('shop.acme-brand.co', 'tok123', target);

const observed = (over = {}) => ({ txt: [], cname: null, addresses: [], ...over });

test('nothing published means pending, with the record to add', () => {
  const result = evaluateVerification(observed(), expected);
  assert.equal(result.status, 'pending');
  assert.equal(result.owns, false);
  assert.match(result.message, /_deservefirst\.shop\.acme-brand\.co/);
});

test('a wrong token does not verify', () => {
  // The whole point. A near-miss must not pass.
  const result = evaluateVerification(
    observed({ txt: ['deservefirst-site-verification=someone-elses'] }),
    expected,
  );
  assert.equal(result.owns, false);
  assert.equal(result.status, 'pending');
});

test('the right token verifies, even quoted or padded', () => {
  /**
   * Resolvers return TXT values quoted or split depending on the resolver. A
   * merchant whose record is correct should not fail because of how it was
   * transported.
   */
  for (const value of [
    'deservefirst-site-verification=tok123',
    '"deservefirst-site-verification=tok123"',
    '  deservefirst-site-verification=tok123  ',
  ]) {
    assert.equal(evaluateVerification(observed({ txt: [value] }), expected).owns, true, value);
  }
});

test('other TXT records at the same name are ignored', () => {
  // Every domain has several. Requiring ours to be the only one would fail
  // every real domain on the internet.
  const result = evaluateVerification(
    observed({ txt: ['v=spf1 include:acme.net ~all', 'deservefirst-site-verification=tok123'] }),
    expected,
  );
  assert.equal(result.owns, true);
});

test('ownership without connectivity verifies, and says what is missing', () => {
  /**
   * The two checks are independent on purpose. A domain that verified and then
   * loaded nothing would read as a broken platform.
   */
  const result = evaluateVerification(observed({ txt: [verificationValue('tok123')] }), expected);
  assert.equal(result.status, 'verified');
  assert.equal(result.reachesUs, false);
  assert.match(result.message, /CNAME/);
  assert.match(result.message, /shops\.deservefirst\.example/);
});

test('both checks passing is a connected domain', () => {
  const result = evaluateVerification(
    observed({ txt: [verificationValue('tok123')], cname: 'shops.deservefirst.example.' }),
    expected,
  );
  assert.equal(result.status, 'verified');
  assert.equal(result.reachesUs, true);
  assert.match(result.message, /connected/);
});

test('a failed lookup is pending, never failed', () => {
  /**
   * DNS propagates for minutes to days, and a resolver timeout says nothing
   * about the merchant's records. Calling this a failure tells somebody who did
   * everything right that they did it wrong.
   */
  const result = evaluateVerification(observed({ error: 'ETIMEOUT' }), expected);
  assert.equal(result.status, 'pending');
  assert.match(result.message, /take a while/);
});

test('only a verified domain may serve', () => {
  assert.equal(isServable({ status: 'verified' }), true);
  assert.equal(isServable({ status: 'pending' }), false);
  assert.equal(isServable({ status: 'failed' }), false);
});

// -------------------------------------------------------- one page, one URL

test('an alias redirects to the primary, keeping the path and query', () => {
  /**
   * Two hostnames serving identical pages split the ranking between them, which
   * costs the merchant the traffic they connected a domain to get.
   */
  assert.equal(
    canonicalRedirect({
      requestHost: 'www.acme-brand.co',
      primaryHost: 'acme-brand.co',
      path: '/products/hat',
      query: 'variant=red',
    }),
    'https://acme-brand.co/products/hat?variant=red',
  );
});

test('the primary host is left alone, and so is a store with no primary', () => {
  assert.equal(
    canonicalRedirect({ requestHost: 'acme-brand.co', primaryHost: 'acme-brand.co', path: '/', query: '' }),
    null,
  );
  assert.equal(
    canonicalRedirect({ requestHost: 'anything.test', primaryHost: null, path: '/', query: '' }),
    null,
    'a store that has connected nothing must keep working on its platform subdomain',
  );
});

test('the comparison is case-insensitive, or every request redirects to itself', () => {
  assert.equal(
    canonicalRedirect({ requestHost: 'ACME-BRAND.co', primaryHost: 'acme-brand.co', path: '/', query: '' }),
    null,
  );
});

// ------------------------------------------------------- exactly one primary

const domain = (id, role, status = 'verified') => ({
  id, host: `${id}.acme-brand.co`, role, status, verificationToken: 't', verifiedAt: null,
});

test('promoting one demotes the other, and touches nothing else', () => {
  const changes = planPrimaryChange(
    [domain('a', 'primary'), domain('b', 'alias'), domain('c', 'alias')],
    'b',
  );

  assert.deepEqual(
    [...changes].sort((x, y) => x.id.localeCompare(y.id)),
    [{ id: 'a', role: 'alias' }, { id: 'b', role: 'primary' }],
    'c was already an alias and needs no write',
  );
});

test('promoting the one that is already primary changes nothing', () => {
  assert.deepEqual(planPrimaryChange([domain('a', 'primary')], 'a'), []);
});

test('an unverified domain cannot become primary', () => {
  /**
   * It would redirect the whole storefront to a hostname that does not reach
   * us — the store goes dark, and the merchant did it to themselves with one
   * click.
   */
  assert.throws(
    () => planPrimaryChange([domain('a', 'primary'), domain('b', 'alias', 'pending')], 'b'),
    /verified/,
  );
});

test('a domain from another store is not promotable', () => {
  assert.throws(() => planPrimaryChange([domain('a', 'primary')], 'someone-elses'), /not connected/);
});
