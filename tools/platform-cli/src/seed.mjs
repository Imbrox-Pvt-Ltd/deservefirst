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
    await identity.createRole({ id: SEED.role, organizationId: SEED.org, storeId: null, category: 'organization', name: owner.name, description: '', permissions: [...owner.permissions, 'catalog.read', 'catalog.write', 'store.read'], system: true, grantsApproval: true });
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

    return { organizations: 1, businessEntities: 2, stores: 2, users: 1, products: count };
  } finally {
    await pool.end();
  }
}
