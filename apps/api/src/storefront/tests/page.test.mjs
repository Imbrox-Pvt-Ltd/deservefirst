/**
 * Storefront · tests/page.test.mjs
 * A whole page, rendered.
 *
 * Everything before this — the engine, 146 filters, 35 drops, 8 tags — is
 * machinery that could each pass its own tests and still not produce a page.
 * These tests render one: a JSON template of sections, wrapped in a layout,
 * reading real drops through real filters.
 *
 * The path tests are the other half, and they are the reason the confinement
 * lives in one function. A theme names its own files, so every `{% render %}`
 * is attacker-controlled input to a file read.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';
import { InMemoryThemeSource } from '../../../dist/storefront/infrastructure/index.js';
import { PageRenderer } from '../../../dist/storefront/application/index.js';
import {
  confinePath,
  createDropContext,
  parseJsonTemplate,
  productDrop,
  resolveTemplate,
} from '../../../dist/storefront/domain/index.js';

/** A small but real theme: a layout, a JSON template, three sections, a snippet. */
const files = {
  'layout/theme.liquid':
    `<!doctype html><html><head><title>{{ page_title }}</title>{{ content_for_header }}</head>` +
    `<body>{{ content_for_layout }}</body></html>`,

  'templates/product.json': JSON.stringify({
    sections: {
      main: { type: 'main-product', settings: { show_vendor: true } },
      related: { type: 'related', settings: {}, disabled: true },
      broken: { type: 'broken', settings: {} },
    },
    order: ['main', 'broken', 'related'],
  }),

  'templates/product.wholesale.json': JSON.stringify({
    sections: { main: { type: 'main-product', settings: {} } },
    order: ['main'],
  }),

  'templates/index.liquid': `<h1>Home</h1>`,

  'sections/main-product.liquid':
    `<section id="{{ section.id }}">` +
    `<h1>{{ product.title }}</h1>` +
    `<p>{{ product.price | money }}</p>` +
    `{% if section.settings.show_vendor %}<span>{{ product.vendor }}</span>{% endif %}` +
    `{% render 'badge', label: product.type %}` +
    `</section>`,

  'sections/related.liquid': `<aside>related</aside>`,
  // Calls a filter that does not exist, so it throws under strictFilters.
  'sections/broken.liquid': `{{ product.title | no_such_filter }}`,

  'snippets/badge.liquid': `<em>{{ label }}</em>`,
};

const source = new InMemoryThemeSource(files);
const engine = createThemeEngine(defaultContext(), { source });

const context = createDropContext({
  currency: 'USD',
  locale: 'en',
  baseUrl: 'https://shop.test',
  load: { variantsOfProduct: () => [], imagesOfProduct: () => [] },
});

const product = productDrop(
  {
    id: 'p1',
    handle: 'linen-shirt',
    title: 'Linen Shirt',
    vendor: 'Atelier',
    productType: 'Shirts',
    priceAmountMinor: '4500',
    inventoryQuantity: 4,
  },
  context,
);

// ------------------------------------------------------------ a real page

test('a JSON template renders its sections into the layout', async () => {
  const renderer = new PageRenderer(engine, source);
  const page = await renderer.render({
    pageType: 'product',
    scope: { product, page_title: 'Linen Shirt' },
  });

  assert.equal(page.templatePath, 'templates/product.json');
  assert.ok(page.html.startsWith('<!doctype html>'), page.html);
  assert.ok(page.html.includes('<title>Linen Shirt</title>'), page.html);
  // The section rendered, with a drop read through a filter.
  assert.ok(page.html.includes('<h1>Linen Shirt</h1>'), page.html);
  assert.ok(page.html.includes('<p>$45.00</p>'), page.html);
  // A section setting reached the template.
  assert.ok(page.html.includes('<span>Atelier</span>'), page.html);
  // A snippet resolved through the theme source.
  assert.ok(page.html.includes('<em>Shirts</em>'), page.html);
});

test('a disabled section is not rendered', async () => {
  const renderer = new PageRenderer(engine, source);
  const page = await renderer.render({ pageType: 'product', scope: { product } });
  assert.ok(!page.html.includes('related'), page.html);
});

test('order decides the sequence, not the key order of the object', async () => {
  const parsed = parseJsonTemplate('templates/product.json', files['templates/product.json']);
  // The object lists main, related, broken; `order` says main, broken, related.
  assert.deepEqual(parsed.sections.map((section) => section.id), ['main', 'broken', 'related']);
});

// -------------------------------------------------- one section failing

test('a broken section does not take the page down', async () => {
  const renderer = new PageRenderer(engine, source);
  const page = await renderer.render({ pageType: 'product', scope: { product } });

  // The good section still rendered.
  assert.ok(page.html.includes('<h1>Linen Shirt</h1>'), page.html);
  // And the failure was reported rather than swallowed.
  assert.equal(page.failures.length, 1);
  assert.equal(page.failures[0].sectionType, 'broken');
  assert.match(page.failures[0].message, /undefined filter/);
});

test('a failure explains itself only when asked', async () => {
  const quiet = new PageRenderer(engine, source);
  const loud = new PageRenderer(engine, source, { explainFailures: true });

  const production = await quiet.render({ pageType: 'product', scope: { product } });
  const development = await loud.render({ pageType: 'product', scope: { product } });

  // A customer must never see a Liquid error; a developer must.
  assert.ok(!production.html.includes('undefined filter'), production.html);
  assert.ok(development.html.includes('undefined filter'), development.html);
});

// ------------------------------------------------------------- resolution

test('a template suffix wins when the theme has it', () => {
  const choice = resolveTemplate(
    { pageType: 'product', suffix: 'wholesale' },
    new Set(Object.keys(files)),
  );
  assert.equal(choice.path, 'templates/product.wholesale.json');
  assert.equal(choice.missingSuffix, undefined);
});

test('a suffix the theme lacks falls back AND says so', () => {
  /**
   * The most common theme support question. Falling back silently renders the
   * ordinary product page, and the merchant reports that their custom template
   * "does not work" with nothing to go on.
   */
  const choice = resolveTemplate(
    { pageType: 'product', suffix: 'seasonal' },
    new Set(Object.keys(files)),
  );
  assert.equal(choice.path, 'templates/product.json');
  assert.equal(choice.missingSuffix, 'seasonal');
});

test('JSON beats Liquid at the same name', () => {
  const choice = resolveTemplate(
    { pageType: 'page' },
    new Set(['templates/page.liquid', 'templates/page.json']),
  );
  assert.equal(choice.path, 'templates/page.json');
});

test('a Liquid template renders as the page body', async () => {
  const renderer = new PageRenderer(engine, source);
  const page = await renderer.render({ pageType: 'index', scope: { page_title: 'Home' } });
  assert.equal(page.templatePath, 'templates/index.liquid');
  assert.ok(page.html.includes('<h1>Home</h1>'), page.html);
  assert.ok(page.html.startsWith('<!doctype html>'), page.html);
});

test('a page type the theme has no template for is reported, not thrown', async () => {
  const renderer = new PageRenderer(engine, source);
  const page = await renderer.render({ pageType: 'search', scope: {} });

  assert.equal(page.templatePath, null);
  assert.equal(page.html, '');
  assert.match(page.failures[0].message, /no template for "search"/);
  // Every path it looked at, so the answer is actionable.
  assert.ok(page.considered.includes('templates/search.json'), page.considered.join(','));
});

// ------------------------------------------------------------ confinement

test('a theme path must be directory/name and nothing else', () => {
  assert.equal(confinePath('snippets/card.liquid'), 'snippets/card.liquid');
  assert.equal(confinePath('templates/product.wholesale.json'), 'templates/product.wholesale.json');

  for (const attempt of [
    '../../etc/passwd',
    'snippets/../../etc/passwd',
    '/etc/passwd',
    'snippets/../../../secrets.env',
    'snippets\\..\\..\\windows',
    '%2e%2e%2fetc%2fpasswd',
    'snippets/sub/dir.liquid',
    'nonsense/card.liquid',
    '',
  ]) {
    assert.throws(() => confinePath(attempt), `"${attempt}" should be refused`);
  }
});

test('percent-encoding is decoded before the check, not after', () => {
  // A loader that decoded later would open a different path from the one checked.
  assert.throws(() => confinePath('snippets/%2e%2e%2f%2e%2e%2fpasswd'));
});

test('a theme cannot render a file outside itself', async () => {
  /**
   * Through the engine's own lookup, which is where `contains` decides. This is
   * the test that keeps `contains: async () => …` honest: if liquidjs
   * truthiness-checked the promise instead of awaiting it, every path would
   * pass and this would render something.
   */
  for (const attempt of ['../../etc/passwd', 'snippets/../../../etc/passwd', '/etc/passwd']) {
    await assert.rejects(
      () => engine.render(`{% render '${attempt}' %}`, {}),
      /Failed to lookup|ENOENT|not a/,
      `${attempt} was not refused`,
    );
  }
});

test('the in-memory source refuses the same paths the real one does', async () => {
  // A test source that read what production refuses would prove nothing.
  assert.equal(await source.read('../../etc/passwd'), null);
  assert.equal(await source.read('snippets/../../secrets'), null);
  assert.equal(await source.exists('/etc/passwd'), false);
  assert.notEqual(await source.read('snippets/badge.liquid'), null);
});

// ----------------------------------------------------------- section group

test('a section group renders its sections in order', async () => {
  const withGroup = new InMemoryThemeSource({
    ...files,
    'sections/header-group.json': JSON.stringify({
      sections: { a: { type: 'related' }, b: { type: 'related' } },
      order: ['a', 'b'],
    }),
  });
  const renderer = new PageRenderer(
    createThemeEngine(defaultContext(), { source: withGroup }),
    withGroup,
  );

  const group = await renderer.renderSectionGroup('header-group', {});
  assert.equal(group.failures.length, 0);
  assert.equal(group.html.match(/<aside>related<\/aside>/g)?.length, 2, group.html);
});

test('a missing section group renders nothing rather than failing', async () => {
  const renderer = new PageRenderer(engine, source);
  const group = await renderer.renderSectionGroup('does-not-exist', {});
  assert.equal(group.html, '');
  assert.deepEqual(group.failures, []);
});

// ==================================================== the real theme

const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
const { FilesystemThemeSource } = await import('../../../dist/storefront/infrastructure/index.js');

const THEME = join(process.cwd(), 'theme', 'broadcast');
const skip = !existsSync(THEME) && 'theme/broadcast is not present';

test('every page type in the reference theme resolves to a template', { skip }, async () => {
  const real = new FilesystemThemeSource(THEME);
  const manifest = await real.manifest();
  assert.ok(manifest.size > 300, `only ${manifest.size} theme files found`);

  for (const pageType of ['index', 'product', 'collection', 'page', 'blog', 'article', 'search', 'cart', '404']) {
    const choice = resolveTemplate({ pageType }, manifest);
    assert.ok(choice.path, `no template resolved for ${pageType}`);
  }
});

test('every JSON template in the reference theme parses', { skip }, async () => {
  const real = new FilesystemThemeSource(THEME);
  const names = await real.list('templates');

  let parsed = 0;
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const path = `templates/${name}`;
    const template = parseJsonTemplate(path, await real.read(path));
    assert.ok(template.sections.length > 0, `${path} declared no sections`);
    parsed++;
  }
  assert.ok(parsed >= 8, `only ${parsed} JSON templates parsed`);
});

test('the reference theme renders a complete homepage', { skip }, async () => {
  /**
   * The test everything else was for. A real commercial theme, unmodified apart
   * from the four ported filter names, rendered through our engine, our filters,
   * our tags and our template resolution — and it has to come out as a document
   * with no Liquid left in it.
   */
  const real = new FilesystemThemeSource(THEME);
  const realEngine = createThemeEngine(defaultContext(), { source: real });
  const renderer = new PageRenderer(realEngine, real, { explainFailures: true });

  const page = await renderer.render({
    pageType: 'index',
    scope: { page_title: 'Home', settings: {}, request: { path: '/', page: 1 } },
  });

  assert.equal(page.templatePath, 'templates/index.json');
  assert.deepEqual(page.failures, []);

  const html = page.html;
  assert.ok(html.length > 20_000, `only ${html.length} bytes rendered`);
  assert.match(html, /^\s*<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);

  // Nothing left unrendered. A stray `{{` means a tag or filter silently
  // failed to parse, which is invisible in a browser until it is not.
  assert.equal(html.match(/\{\{/g), null, 'unrendered output expressions remain');
  assert.equal(html.match(/\{%/g), null, 'unrendered tags remain');

  // And it actually rendered sections rather than an empty shell.
  assert.ok((html.match(/<section/g) ?? []).length > 5, 'too few sections rendered');
});

// ============================================ regressions the suite missed

test('a section that delegates to a snippet still sees the globals', async () => {
  /**
   * The bug that made every real product page render empty, with no error.
   *
   * `{% render %}` isolates its scope — a snippet sees nothing its caller had.
   * The reference theme's entire product section is one line,
   * `{% render 'product' %}`, so passing drops as render SCOPE produced a
   * complete 39 KB page with the product missing from it. They must be engine
   * globals. Every test here passed the scope to a top-level section, which is
   * exactly why none of them caught it.
   */
  const delegating = new InMemoryThemeSource({
    'layout/theme.liquid': `<html>{{ content_for_layout }}</html>`,
    'templates/product.json': JSON.stringify({
      sections: { main: { type: 'main' } },
      order: ['main'],
    }),
    // One line, like the real theme's.
    'sections/main.liquid': `{%- render 'product-card' -%}`,
    'snippets/product-card.liquid': `<h1>{{ product.title }}</h1><p>{{ shop.name }}</p>`,
  });

  const globals = { product: { title: 'Linen Shirt' }, shop: { name: 'Atelier' } };
  const withGlobals = createThemeEngine(defaultContext(), { source: delegating, globals });
  const page = await new PageRenderer(withGlobals, delegating).render({
    pageType: 'product',
    scope: globals,
  });

  assert.ok(page.html.includes('<h1>Linen Shirt</h1>'), page.html);
  assert.ok(page.html.includes('<p>Atelier</p>'), page.html);
});

test('section stays a local, so a snippet does not inherit it', async () => {
  // Matching the reference product: themes pass `section` onward explicitly,
  // and a snippet that saw its caller's section would be a different language.
  const source = new InMemoryThemeSource({
    'layout/theme.liquid': `{{ content_for_layout }}`,
    'templates/index.json': JSON.stringify({ sections: { a: { type: 'a' } }, order: ['a'] }),
    'sections/a.liquid': `in=[{{ section.id }}]{%- render 'peek' -%}`,
    'snippets/peek.liquid': `snippet=[{{ section.id }}]`,
  });
  const engineWithGlobals = createThemeEngine(defaultContext(), { source, globals: {} });
  const page = await new PageRenderer(engineWithGlobals, source).render({
    pageType: 'index',
    scope: {},
  });

  assert.ok(page.html.includes('in=[a]'), page.html);
  assert.ok(page.html.includes('snippet=[]'), page.html);
});
