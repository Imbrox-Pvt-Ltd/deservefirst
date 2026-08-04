/**
 * Platform CLI · seed.mjs
 * Deterministic, idempotent development seed (§17.5). Creates one organization,
 * two legal entities, two stores and a handful of products — enough to exercise
 * the admin against real data, including the case that matters most: the same
 * product handle existing in two stores.
 * Layer: tooling.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export const SEED = {
  org: 'seed-org',
  entityUs: 'seed-entity-us',
  entityIn: 'seed-entity-in',
  storeA: 'seed-store-us',
  storeB: 'seed-store-in',
  user: 'seed-user',
  role: 'seed-role-owner',
};

const PRODUCTS = [
  ['The Collection Snowboard: Liquid', 'liquid-snowboard', 74995, 'Hydrogen Vendor', 'Snowboard', 'active', 50],
  ['The Collection Snowboard: Oxygen', 'oxygen-snowboard', 108500, 'Hydrogen Vendor', 'Snowboard', 'active', 50],
  ['The Multi-managed Snowboard', 'multi-managed-snowboard', 62950, 'Multi-managed Vendor', 'Snowboard', 'active', 500],
  ['The Videographer Snowboard', 'videographer-snowboard', 88500, 'Hydrogen Vendor', 'Snowboard', 'archived', 0],
  ['The Draft Snowboard', 'draft-snowboard', 24950, 'Snowboard Vendor', 'Snowboard', 'draft', 20],
  ['Selling Plans Ski Wax', 'selling-plans-ski-wax', 999, 'Hydrogen Vendor', 'Accessories', 'active', 10],
  ['Gift Card', 'gift-card', 2500, 'Hydrogen Vendor', 'Gift Cards', 'active', 0],
  ['Short Sleeve Tshirt', 'short-sleeve-tshirt', 10000, 'Hydrogen Vendor', 'Apparel', 'active', 25],
];

const COLLECTIONS = [
  ['Snowboards', 'snowboards', 'automated', 'all', [{ field: 'type', operator: 'equals', value: 'Snowboard' }], []],
  // The captured case that only works because exclusions are a first-class rule
  // set: everything tagged Sale, except anything tagged Clearance.
  ['Sale', 'sale', 'automated', 'any', [{ field: 'tag', operator: 'equals', value: 'Sale' }], [{ field: 'tag', operator: 'equals', value: 'Clearance' }]],
  ['Staff picks', 'staff-picks', 'manual', 'all', [], []],
];

const CUSTOMERS = [
  ['Ada', 'Lovelace', 'ada@example.test', 'active', 'subscribed', 4, 24999],
  ['Grace', 'Hopper', 'grace@example.test', 'active', 'not-subscribed', 2, 8500],
  ['Alan', 'Turing', 'alan@example.test', 'invited', 'pending', 0, 0],
  ['Katherine', 'Johnson', 'katherine@example.test', 'disabled', 'unknown', 1, 4999],
];

/** [status, contactName, email, lines[[productId, title, qty, listPrice]], quotedPrice|null] */
const REQUESTS = [
  ['submitted', 'Nordic Outfitters', 'buyer@nordic.test', [['p-liquid', 'The Collection Snowboard: Liquid', 12, 74995]], null],
  ['quoted', 'Alpine Rentals', 'buyer@alpine.test', [['p-oxygen', 'The Collection Snowboard: Oxygen', 40, 108500]], 97650],
  ['accepted', 'Summit Sports', 'buyer@summit.test', [['p-multi', 'The Multi-managed Snowboard', 25, 62950]], 56655],
  ['declined', 'Powder Co', 'buyer@powder.test', [['p-wax', 'Selling Plans Ski Wax', 500, 999]], 950],
];

export async function seed(root, options = {}) {
  const dist = join(root, 'apps/api/dist');
  const { createMysqlPool, MysqlExecutor } = require(join(dist, 'core/database/mysql-executor.js'));
  const { mysqlDialect } = require(join(dist, 'core/list-engine/dialect.js'));
  const { withRequestContext } = require(join(dist, 'core/tenant-context/index.js'));
  const { SqlIdentityRepository } = require(join(dist, 'auth/infrastructure/index.js'));
  const { hashPassword, SYSTEM_ROLES } = require(join(dist, 'auth/domain/index.js'));
  const { ProductRepositoryImpl } = require(join(dist, 'modules/catalog/infrastructure/index.js'));

  const url = options.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL.');

  const pool = await createMysqlPool(url);
  const executor = new MysqlExecutor({ pool });
  const identity = new SqlIdentityRepository(executor, mysqlDialect);

  try {
    // Idempotent: clear the seed's own rows, never anyone else's.
    for (const [table, column, value] of [
      ['products', 'store_id', [SEED.storeA, SEED.storeB]],
      ['role_assignments', 'organization_id', [SEED.org]],
      ['roles', 'organization_id', [SEED.org]],
      ['memberships', 'organization_id', [SEED.org]],
      ['stores', 'organization_id', [SEED.org]],
      ['business_entities', 'organization_id', [SEED.org]],
      ['users', 'id', [SEED.user]],
      ['organizations', 'id', [SEED.org]],
    ]) {
      await executor.query(
        `DELETE FROM \`${table}\` WHERE \`${column}\` IN (${value.map(() => '?').join(',')})`,
        value,
      );
    }

    const now = new Date();
    await identity.createOrganization({ id: SEED.org, name: 'Acme Group', requireSecureSignIn: false, createdAt: now });

    await identity.createBusinessEntity({
      id: SEED.entityUs, organizationId: SEED.org, name: 'Acme Inc.',
      countryCode: 'US', companyType: 'Corporation', taxRegistrationId: null, archivedAt: null,
    });
    await identity.createBusinessEntity({
      id: SEED.entityIn, organizationId: SEED.org, name: 'Acme India Pvt. Ltd.',
      countryCode: 'IN', companyType: 'Private company', taxRegistrationId: null, archivedAt: null,
    });

    const base = { organizationId: SEED.org, type: 'live', status: 'active', defaultLocale: 'en-US', timeZone: 'UTC', featurePreviews: ['extended-variants'], createdAt: now };
    await identity.createStore({ ...base, id: SEED.storeA, handle: 'acme-us', name: 'Acme US', businessEntityId: SEED.entityUs, baseCurrency: 'USD' });
    await identity.createStore({ ...base, id: SEED.storeB, handle: 'acme-in', name: 'Acme India', businessEntityId: SEED.entityIn, baseCurrency: 'INR' });

    await identity.createUser(
      { id: SEED.user, email: 'dev@acme.test', emailVerifiedAt: now, secondaryEmail: null, firstName: 'Dev', lastName: 'User', status: 'active', mfaEnabled: false, providerRef: null, locale: 'en-US', timeZone: 'UTC', createdAt: now },
      await hashPassword('a-perfectly-fine-passphrase'),
    );

    for (const storeId of [SEED.storeA, SEED.storeB]) {
      await identity.createMembership({ id: `seed-m-${storeId}`, userId: SEED.user, storeId, organizationId: SEED.org, status: 'active', invitedBy: null, createdAt: now });
    }

    const owner = SYSTEM_ROLES.find((role) => role.key === 'owner');

    // Every permission every loaded module declares, plus the role's own.
    // Listing a few by hand went stale the moment a module was added, and the
    // symptom is a screen that renders empty for the store owner — which reads
    // as a broken feature rather than a missing grant.
    const { manifestsOf } = await import('./manifests.mjs');
    const declared = manifestsOf(root).flatMap((manifest) =>
      (manifest.permissions ?? []).map((entry) => entry.key),
    );
    const permissions = [...new Set([...owner.permissions, ...declared, 'store.read'])];

    await identity.createRole({ id: SEED.role, organizationId: SEED.org, storeId: null, category: 'organization', name: owner.name, description: '', permissions, system: true, grantsApproval: true });
    await identity.assignRole({ id: 'seed-ra', organizationId: SEED.org, userId: SEED.user, roleId: SEED.role, storeId: null });

    let count = 0;
    for (const [storeId, currency] of [[SEED.storeA, 'USD'], [SEED.storeB, 'INR']]) {
      await withRequestContext(
        { requestId: 'seed', correlationId: 'seed', actorType: 'system', userId: null, organizationId: SEED.org, businessEntityId: null, storeId, partnerId: null, accessType: 'platform', roleKeys: [], permissions: [], supportSessionId: null, entitlementsHash: null, locale: 'en-US', timeZone: 'UTC', shardKey: null },
        async () => {
          const products = new ProductRepositoryImpl(executor, mysqlDialect);
          for (const [title, handle, price, vendor, type, status, inventory] of PRODUCTS) {
            await products.insert({
              id: `seed-${storeId}-${handle}`, handle, title,
              description: `<p>${title} — seeded for development.</p>`,
              status, vendor, productType: type,
              price: { amountMinor: BigInt(price), currency },
              compareAtPrice: null,
              costPerItem: { amountMinor: BigInt(Math.round(price * 0.4)), currency },
              variants: [], optionNames: [],
              publishedChannels: status === 'active' ? ['online-store'] : [],
              version: 1,
            });
            count += 1;
          }
        },
      );
    }

    // Collections and customers, so the generic list screens have real data.
    let collections = 0;
    let customers = 0;
    for (const [storeId, currency] of [[SEED.storeA, 'USD'], [SEED.storeB, 'INR']]) {
      await executor.query('DELETE FROM collections WHERE store_id = ?', [storeId]);
      await executor.query('DELETE FROM customers WHERE store_id = ?', [storeId]);

      for (const [title, handle, type, match, conditions, exclusions] of COLLECTIONS) {
        await executor.query(
          `INSERT INTO collections (id, store_id, handle, title, description, type, \`match\`, conditions, exclusions, product_ids, sort_order, version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
          [`seed-${storeId}-${handle}`, storeId, handle, title, '', type, match,
           JSON.stringify(conditions), JSON.stringify(exclusions), '[]', 'manual'],
        );
        collections += 1;
      }

      for (const [first, last, email, state, consent, orders, spent] of CUSTOMERS) {
        const id = `seed-${storeId}-${email.split('@')[0]}`;
        await executor.query(
          `INSERT INTO customers (id, store_id, handle, first_name, last_name, email, phone, state, email_consent, sms_consent, locale, tax_exempt, orders_count, total_spent_amount_minor, total_spent_currency, default_address, note, version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          [id, storeId, id, first, last, email, null, state, consent, 'unknown', 'en-US', 0,
           orders, String(spent), currency, null, null],
        );
        customers += 1;
      }
    }

    // Requests across the whole status path, so the queue views are not empty.
    let requests = 0;
    for (const [storeId, currency] of [[SEED.storeA, 'USD'], [SEED.storeB, 'INR']]) {
      await executor.query('DELETE FROM request_lines WHERE store_id = ?', [storeId]);
      await executor.query('DELETE FROM requests WHERE store_id = ?', [storeId]);

      let sequence = 1001;
      for (const [status, name, email, lines, quoted] of REQUESTS) {
        const id = `seed-${storeId}-rfq-${sequence}`;
        const lineTotal = lines.reduce((sum, [, , qty, price]) => sum + qty * (quoted ?? price), 0);

        await executor.query(
          `INSERT INTO requests (id, store_id, handle, reference, customer_id, contact_email, contact_name,
             status, currency, line_count, subtotal_amount_minor, subtotal_currency, note, internal_note,
             quote_expires_at, submitted_at, responded_at, version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
          [
            id, storeId, id, `RFQ-${sequence}`, null, email, name, status, currency,
            lines.length, String(lineTotal), currency, null, null,
            status === 'quoted' ? new Date(Date.now() + 14 * 864e5) : null,
            status === 'draft' ? null : new Date(),
            ['quoted', 'accepted', 'declined'].includes(status) ? new Date() : null,
          ],
        );

        let position = 0;
        for (const [productId, title, quantity, price] of lines) {
          await executor.query(
            `INSERT INTO request_lines (id, store_id, handle, request_id, product_id, variant_id, title, sku,
               quantity, list_price_amount_minor, list_price_currency,
               quoted_price_amount_minor, quoted_price_currency, position, note, version)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
            [
              `${id}-l${position}`, storeId, `${id}-l${position}`, id, productId, null, title, null,
              quantity, String(price), currency,
              quoted === null ? null : String(quoted), quoted === null ? null : currency,
              position, null,
            ],
          );
          position += 1;
        }

        sequence += 1;
        requests += 1;
      }
    }

    return { organizations: 1, businessEntities: 2, stores: 2, users: 1, products: count, collections, customers, requests };
  } finally {
    await pool.end();
  }
}
