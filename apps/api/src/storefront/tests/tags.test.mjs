/**
 * Storefront · tests/tags.test.mjs
 * The eight tags, each rendered rather than described.
 *
 * The raw ones matter most here. `{% schema %}` holds JSON and
 * `{% javascript %}` holds JavaScript; both are full of braces that Liquid
 * would try to read as output, so the test that they parse at all is the test
 * that the raw/block distinction was real rather than a tidy-looking design.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThemeEngine, defaultContext } from '../../../dist/storefront/engine/index.js';

const engine = createThemeEngine(defaultContext());
const render = async (source, scope = {}) => (await engine.render(source, scope)).trim();

// ------------------------------------------------------------------ raw

test('schema holds JSON and renders nothing', async () => {
  /**
   * The braces are the point. Parsed as Liquid, `{"name"` is the start of an
   * output expression and the template fails before it renders a byte.
   */
  const source = `before{% schema %}
    { "name": "Rich text", "settings": [{ "type": "text", "id": "heading" }] }
  {% endschema %}after`;

  assert.equal(await render(source), 'beforeafter');
});

test('a schema containing Liquid-looking text is still inert', async () => {
  const source = `{% schema %}{ "default": "{{ product.title }}" }{% endschema %}ok`;
  assert.equal(await render(source), 'ok');
});

test('javascript keeps its braces and its operators', async () => {
  const source = `{% javascript %}
    if (a && b) { document.querySelector('.x').textContent = '{{ not liquid }}'; }
  {% endjavascript %}`;

  const out = await render(source);
  assert.ok(out.startsWith('<script>'), out);
  assert.ok(out.includes('a && b'), out);
  // Untouched: the body was never parsed, so the braces survived verbatim.
  assert.ok(out.includes("'{{ not liquid }}'"), out);
});

test('stylesheet wraps its body in a style element', async () => {
  const out = await render(`{% stylesheet %}.a{color:red}{% endstylesheet %}`);
  assert.equal(out, '<style>.a{color:red}</style>');
});

test('doc renders nothing', async () => {
  assert.equal(await render(`a{% doc %}Explains the snippet's arguments.{% enddoc %}b`), 'ab');
});

// ---------------------------------------------------------------- block

test('style renders Liquid inside, which is the whole point of it', async () => {
  const out = await render(
    `{% style %}.header { color: {{ settings.text_color }}; }{% endstyle %}`,
    { settings: { text_color: '#112233' } },
  );
  assert.equal(out, '<style>.header { color: #112233; }</style>');
});

// ------------------------------------------------------------- paginate

const products = Array.from({ length: 47 }, (_entry, index) => ({ title: `P${index + 1}` }));

test('paginate slices the list and exposes the page object', async () => {
  const out = await render(
    `{% paginate products by 12 %}` +
      `{{ paginate.current_page }}/{{ paginate.pages }} ` +
      `items={{ paginate.items }} shown={{ products | size }} ` +
      `first={{ products[0].title }}` +
      `{% endpaginate %}`,
    { products, request: { page: 1, path: '/collections/all' } },
  );
  assert.equal(out, '1/4 items=47 shown=12 first=P1');
});

test('paginate takes the page from the request, not the template', async () => {
  const out = await render(
    `{% paginate products by 12 %}{{ paginate.current_page }} first={{ products[0].title }}{% endpaginate %}`,
    { products, request: { page: 3, path: '/collections/all' } },
  );
  assert.equal(out, '3 first=P25');
});

test('a page number past the end renders the last page, not an empty one', async () => {
  const out = await render(
    `{% paginate products by 12 %}{{ paginate.current_page }} shown={{ products | size }}{% endpaginate %}`,
    { products, request: { page: 9999, path: '/collections/all' } },
  );
  // 47 items at 12 a page is 4 pages, the last holding 11.
  assert.equal(out, '4 shown=11');
});

test('the paginated variable leaves scope at the closing tag', async () => {
  const out = await render(
    `{% paginate products by 12 %}{{ products | size }}{% endpaginate %}|{{ products | size }}`,
    { products, request: { page: 1, path: '/collections/all' } },
  );
  // Inside: one page. Outside: the whole list again.
  assert.equal(out, '12|47');
});

test('paginate builds URLs that keep other parameters and drop the page', async () => {
  const out = await render(
    `{% paginate products by 12 %}{{ paginate.next.url }}{% endpaginate %}`,
    { products, request: { page: 1, path: '/collections/all?sort_by=price&page=1' } },
  );
  assert.ok(out.includes('sort_by=price'), out);
  assert.ok(out.includes('page=2'), out);
});

// ----------------------------------------------------------------- form

test('form emits the action, not the theme', async () => {
  const out = await render(`{% form 'contact' %}<input name="email">{% endform %}`, {});
  assert.ok(out.startsWith('<form '), out);
  assert.ok(out.includes('action="/contact"'), out);
  assert.ok(out.includes('method="post"'), out);
  assert.ok(out.includes('name="form_type" value="contact"'), out);
  assert.ok(out.endsWith('</form>'), out);
  assert.ok(out.includes('<input name="email">'), out);
});

test('form emits the forgery token so a theme cannot omit it', async () => {
  const out = await render(`{% form 'customer_login' %}{% endform %}`, { form_token: 'tok123' });
  assert.ok(out.includes('name="_token" value="tok123"'), out);
});

test('a form type we do not accept renders a comment, not a form', async () => {
  /**
   * A theme built elsewhere may use a form we have no route for. Posting it
   * somewhere plausible would be worse than not rendering it, and taking the
   * whole page down helps nobody.
   */
  const out = await render(`{% form 'storefront_password' %}x{% endform %}`, {});
  assert.ok(!out.includes('<form'), out);
  assert.ok(out.includes('not a form this platform accepts'), out);
});

test('form will not accept an event handler as an attribute', async () => {
  const out = await render(`{% form 'contact', onsubmit: 'steal()' %}{% endform %}`, {});
  assert.ok(!out.includes('onsubmit'), out);
});

test('form exposes the errors object to its body', async () => {
  const out = await render(
    `{% form 'contact' %}{% if form.errors %}bad{% else %}ok{% endif %}{% endform %}`,
    { form: { errors: { messages: { email: 'is invalid' } } } },
  );
  assert.ok(out.includes('bad'), out);
});

// ------------------------------------------------------------- registry

test('every tag the reference theme needs is registered', () => {
  for (const name of [
    'schema', 'style', 'javascript', 'stylesheet', 'doc',
    'form', 'paginate', 'section', 'sections', 'content_for',
  ]) {
    assert.ok(engine.hasTag(name), `{% ${name} %} is not registered`);
  }
});

test('the tags liquidjs already provides are still there', () => {
  // Registering ours must not have displaced the language itself.
  for (const name of ['if', 'for', 'assign', 'capture', 'render', 'liquid', 'echo', 'case']) {
    assert.ok(engine.hasTag(name), `{% ${name} %} went missing`);
  }
});

test('content_for names what it found nothing for', async () => {
  const out = await render(`{% content_for 'additional_checkout_buttons' %}`, {});
  assert.ok(out.includes('additional_checkout_buttons'), out);
  assert.ok(out.startsWith('<!--'), out);
});

test('an unclosed block tag is an error naming the tag', async () => {
  await assert.rejects(
    () => engine.render(`{% paginate products by 12 %}no end`, { products }),
    /endpaginate/,
  );
});
