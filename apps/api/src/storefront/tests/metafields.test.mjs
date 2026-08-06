/**
 * Storefront · tests/metafields.test.mjs
 * Which of a merchant's custom fields a public page may show.
 *
 * Values have always been stored — every entity has a `<table>_metafields`
 * side table — but nothing recorded what they MEAN, so nothing could say which
 * were safe to publish. Answering `product.metafields` before this existed
 * would have meant handing a theme every field on the product, cost prices and
 * supplier names included.
 *
 * The control is the join, not a filter applied afterwards, and these tests
 * assert that shape rather than only the result. A LEFT JOIN with a `WHERE`
 * would pass a result-based test today and leak everything the first time
 * somebody edited the clause.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqlStorefrontData } from '../../../dist/storefront/infrastructure/sql-storefront-data.js';
import { withRequestContext, storefrontContext } from '../../../dist/core/tenant-context/index.js';
import { mysqlDialect } from '../../../dist/core/list-engine/dialect.js';

const STORE = 'store_1';

const run = (rows, fn) => {
  const seen = [];
  const executor = {
    async query(sql, parameters) {
      seen.push({ sql, parameters });
      return rows;
    },
  };
  const data = new SqlStorefrontData(executor, 'stores.example', mysqlDialect);
  return withRequestContext(storefrontContext(STORE), () => fn(data)).then((value) => ({
    seen,
    value,
  }));
};

test('only a definition granting public read can produce a value', async () => {
  /**
   * The security control, asserted as SQL. `storefront_access = 'public_read'`
   * lives in the JOIN, so a value whose definition withholds it — or which has
   * no definition at all — cannot be part of the result set in the first place.
   */
  const { seen } = await run([], (data) => data.metafieldsOf('Product', 'p1'));
  const sql = seen[0].sql;

  assert.match(sql, /JOIN\s+`metafield_definitions`/, 'an inner join, never a left one');
  assert.match(sql, /`storefront_access` = 'public_read'/);
  assert.ok(!/LEFT JOIN/.test(sql), 'a left join would return the ungranted values too');
});

test('the definition is matched within the same store', async () => {
  /**
   * Both sides are scoped. Matching a definition across stores would let one
   * merchant publish another's field by defining the same namespace and key.
   */
  const { seen } = await run([], (data) => data.metafieldsOf('Product', 'p1'));
  assert.match(seen[0].sql, /d\.`store_id` = m\.`store_id`/);
  assert.deepEqual(seen[0].parameters, ['Product', STORE, 'p1'], 'bound in the order they appear');
});

test('an owner kind with no side table asks nothing at all', async () => {
  /**
   * The owner kind reaches this from a drop. Interpolating it into a table
   * name would turn `metafields` into a way to name any table in the database,
   * so the mapping is a closed table and an unknown kind is simply empty.
   */
  const { seen, value } = await run([], (data) => data.metafieldsOf('Secrets', 'p1'));
  assert.equal(seen.length, 0, 'no query is built for a kind that cannot carry metafields');
  assert.deepEqual(value, {});
});

test('values are grouped the way a theme addresses them', async () => {
  /**
   * `metafields.namespace.key`, because that is the path a template writes.
   * A flat list would make every theme search it.
   */
  const { value } = await run(
    [
      { namespace: 'information', metafield_key: 'directions', value: 'Wash cool.', value_type: 'single_line_text_field' },
      { namespace: 'information', metafield_key: 'origin', value: 'Portugal', value_type: 'single_line_text_field' },
      { namespace: 'specs', metafield_key: 'weight', value: '250', value_type: 'number_integer' },
    ],
    (data) => data.metafieldsOf('Product', 'p1'),
  );

  assert.deepEqual(Object.keys(value).sort(), ['information', 'specs']);
  assert.equal(value.information.directions.value, 'Wash cool.');
  assert.equal(value.information.directions.type, 'single_line_text_field');
  assert.equal(value.specs.weight.value, '250');
});

test('a json value is parsed so a theme can walk into it', async () => {
  /**
   * `metafield.value` of a json type has to yield something a template can
   * index; handing back the string would make `.value.temperature` nothing.
   */
  const { value } = await run(
    [{ namespace: 'spec', metafield_key: 'burn', value: '{"temperature":700,"unit":"F"}', value_type: 'json' }],
    (data) => data.metafieldsOf('Product', 'p1'),
  );
  assert.equal(value.spec.burn.value.temperature, 700);
});

test('a text value is never reinterpreted as a number', async () => {
  /**
   * Guessing a type out of a text field changes what a merchant typed — a
   * postcode or a part number with leading zeros would lose them.
   */
  const { value } = await run(
    [{ namespace: 'spec', metafield_key: 'code', value: '00420', value_type: 'single_line_text_field' }],
    (data) => data.metafieldsOf('Product', 'p1'),
  );
  assert.equal(value.spec.code.value, '00420');
});

test('a row with no namespace or key is dropped rather than keyed on ""', async () => {
  const { value } = await run(
    [{ namespace: '', metafield_key: 'x', value: 'v', value_type: 'single_line_text_field' }],
    (data) => data.metafieldsOf('Product', 'p1'),
  );
  assert.deepEqual(value, {});
});
