/**
 * Storefront · tests/arrays.test.mjs
 * Building arrays in Liquid, and the lint that explains why you cannot.
 *
 * Two halves of one problem. The filters make accumulation in a loop something
 * you can write plainly; the lint catches the three ways people try it first
 * and get a silently empty page instead.
 *
 * The mutation tests are the important ones. A drop can hand a theme an array
 * the platform also holds, so a filter that sorted in place would let one
 * render reorder data for every render after it. liquidjs copies today; these
 * pin it so an upgrade cannot change that quietly.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import { hasBlockingFinding, lintTemplate } from '../../../dist/storefront/domain/index.js';

const engine = createThemeEngine(defaultContext());
const render = async (source, scope = {}) => (await engine.render(source, scope)).trim();

// ---------------------------------------------------------- construction

test('array starts an empty accumulator', async () => {
  assert.equal(await render(`{% assign list = nil | array %}{{ list | size }}`), '0');
});

test('array starts a full one', async () => {
  assert.equal(await render(`{% assign l = 'a' | array: 'b', 'c' %}{{ l | join: '-' }}`), 'a-b-c');
});

test('accumulating across a loop works and reads plainly', async () => {
  const out = await render(
    `{% assign list = nil | array %}` +
      `{% for i in (1..3) %}{% assign list = list | push: i %}{% endfor %}` +
      `{{ list | join: ',' }}`,
  );
  assert.equal(out, '1,2,3');
});

test('accumulating across nested loops keeps every element', async () => {
  const out = await render(
    `{% assign list = nil | array %}` +
      `{% for i in (1..2) %}{% for j in (1..2) %}` +
      `{% assign list = list | push: i %}{% endfor %}{% endfor %}` +
      `{{ list | join: ',' }}`,
  );
  assert.equal(out, '1,1,2,2');
});

test('index_of finds a position and reports -1 for absent', async () => {
  assert.equal(await render(`{{ list | index_of: 'b' }}`, { list: ['a', 'b', 'c'] }), '1');
  assert.equal(await render(`{{ list | index_of: 'z' }}`, { list: ['a', 'b'] }), '-1');
});

test('index_of matches a number against its string form', async () => {
  // Ids arrive as numbers from JSON and as strings from settings.
  assert.equal(await render(`{{ list | index_of: '2' }}`, { list: [1, 2, 3] }), '1');
});

test('without removes by value or by property', async () => {
  assert.equal(await render(`{{ list | without: 'b' | join: ',' }}`, { list: ['a', 'b', 'c'] }), 'a,c');
  assert.equal(
    await render(`{{ items | without: 'id', 2 | map: 'id' | join: ',' }}`, {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    }),
    '1,3',
  );
});

test('array coerces nil and a scalar without inventing a blank element', async () => {
  assert.equal(await render(`{{ nothing | array | size }}`), '0');
  assert.equal(await render(`{{ 'solo' | array | size }}`), '1');
});

// ------------------------------------------------------------- mutation

test('no array filter modifies the array it was given', async () => {
  /**
   * The regression guard. A drop may hand over an array the platform also
   * holds; a filter that sorted it in place would corrupt data for every
   * render afterwards. Checked across the whole family rather than one filter,
   * because the risk is a future liquidjs version changing any of them.
   */
  const sources = [
    `{{ list | sort | join: ',' }}`,
    `{{ list | sort_natural | join: ',' }}`,
    `{{ list | reverse | join: ',' }}`,
    `{{ list | uniq | join: ',' }}`,
    `{{ list | compact | join: ',' }}`,
    `{{ list | push: 'z' | join: ',' }}`,
    `{{ list | pop | join: ',' }}`,
    `{{ list | shift | join: ',' }}`,
    `{{ list | unshift: 'z' | join: ',' }}`,
    `{{ list | concat: other | join: ',' }}`,
    `{{ list | array: 'z' | join: ',' }}`,
    `{{ list | without: 'a' | join: ',' }}`,
  ];

  for (const source of sources) {
    const original = ['c', 'a', 'b'];
    const list = [...original];
    await engine.render(source, { list, other: ['x'] });
    assert.deepEqual(list, original, `${source} modified the array it was handed`);
  }
});

test('sorting objects by key does not reorder the caller list', async () => {
  const items = [{ n: 2 }, { n: 1 }];
  await engine.render(`{{ items | sort: 'n' | map: 'n' | join: ',' }}`, { items });
  assert.deepEqual(items.map((item) => item.n), [2, 1]);
});

// ----------------------------------------------------------------- lint

test('an array literal is reported as an error, not left silent', () => {
  const findings = lintTemplate('sections/x.liquid', `{% assign a = [1, 2, 3] %}`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'no-array-literal');
  assert.equal(findings[0].severity, 'error');
  assert.ok(hasBlockingFinding(findings));
  // The message has to name the fix; a lint without one is a complaint.
  assert.match(findings[0].suggestion, /\| array/);
});

test('the array literal really does render nothing, which is why it is an error', async () => {
  const out = await render(`{% assign a = [1, 2, 3] %}[{{ a }}] size={{ a | size }}`);
  assert.equal(out, '[] size=0');
});

test('a hash literal is reported', () => {
  const findings = lintTemplate('x.liquid', `{% assign h = {} %}`);
  assert.equal(findings[0].rule, 'no-hash-literal');
});

test('a bracket inside a string is not mistaken for an array literal', () => {
  // The false positive that makes people switch a linter off.
  const findings = lintTemplate('x.liquid', `{% assign label = 'Sizes [S, M, L]' %}`);
  assert.deepEqual(findings, []);
});

test('increment is flagged because it prints and keeps its own namespace', () => {
  const findings = lintTemplate('x.liquid', `{% increment counter %}`);
  assert.equal(findings[0].rule, 'increment-prints');
  assert.equal(findings[0].severity, 'warning');
});

test('the increment behaviour the lint describes is real', async () => {
  // It writes 0,1,2 onto the page as a side effect.
  const out = await render(`{% for i in (1..3) %}{% increment n %}{% endfor %}`);
  assert.equal(out, '012');
});

test('statements inside a liquid block are each linted', () => {
  const findings = lintTemplate(
    'x.liquid',
    `{%- liquid
      assign title = 'hello'
      assign items = [1, 2]
    -%}`,
  );
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, 'no-array-literal');
});

test('forloop inside a loop is correct and must not be flagged', () => {
  /**
   * The regression this pins is embarrassing and instructive: the first version
   * of this rule had no notion of block nesting, so it flagged every correct use
   * of `forloop` and reported 64 findings on the reference theme, all wrong.
   */
  const source = `{% for item in list %}{{ forloop.index }}{% endfor %}`;
  assert.deepEqual(lintTemplate('x.liquid', source), []);
});

test('forloop nested two deep is still inside a loop', () => {
  const source = `{% for a in x %}{% for b in y %}{{ forloop.index }}{% endfor %}{% endfor %}`;
  assert.deepEqual(lintTemplate('x.liquid', source), []);
});

test('forloop after the loop has closed is flagged', () => {
  const source = `{% for item in list %}{% endfor %}{{ forloop.index }}`;
  const findings = lintTemplate('x.liquid', source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'forloop-outside-loop');
});

test('forloop inside a liquid block loop is not flagged', () => {
  // Depth has to be tracked across the statements of a {% liquid %} block too.
  const source = `{%- liquid
    for item in list
      echo forloop.index
    endfor
  -%}`;
  assert.deepEqual(lintTemplate('x.liquid', source), []);
});

test('appending without a separator is flagged only when the value is split', () => {
  // Building a class list by appending is ordinary and correct — flagging it
  // produced 94 findings on the reference theme with nothing wrong.
  const harmless = `{% for c in classes %}{% assign s = s | append: c %}{% endfor %}<div class="{{ s }}">`;
  assert.deepEqual(lintTemplate('x.liquid', harmless), []);

  // The same code becomes a bug the moment something splits it.
  const broken =
    `{% for c in classes %}{% assign s = s | append: c %}{% endfor %}{{ s | split: ',' | size }}`;
  const findings = lintTemplate('x.liquid', broken);
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, 'append-without-separator');
  assert.match(findings[0].message, /"s"/);
});

test('appending a separator is the correct idiom and passes', () => {
  const source =
    `{% for c in classes %}{% assign s = s | append: c | append: ',' %}{% endfor %}` +
    `{{ s | split: ',' | size }}`;
  assert.deepEqual(lintTemplate('x.liquid', source), []);
});

test('ordinary theme code produces no findings', () => {
  const source = `
    {%- liquid
      assign heading = section.settings.title | default: ''
      assign list = nil | array
      for block in section.blocks
        assign list = list | push: block.id
      endfor
    -%}
    {{ heading }}{{ list | join: ',' }}
  `;
  assert.deepEqual(lintTemplate('x.liquid', source), []);
});
