/**
 * Content · tests/menu-blog.test.mjs
 * Menu trees and post scheduling.
 *
 * The menu cases are all about a tree that renders on somebody's storefront:
 * a cycle that never terminates, a depth no phone can show, and a `javascript:`
 * link that is stored XSS. The blog cases are about scheduling, where reading
 * the status instead of asking `isVisible` publishes everything at once.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_MENU_DEPTH,
  assertBlogValid,
  assertMenuValid,
  assertPostValid,
  brokenLinks,
  flatten,
  isScheduled,
  isVisible,
} from '../../../../dist/modules/content/domain/index.js';

const item = (over = {}) => ({
  id: 'mi-1', title: 'Home', target: 'home', url: '/', subjectId: null, children: [], ...over,
});
const menu = (over = {}) => ({
  id: 'menu-1', title: 'Main menu', handle: 'main-menu', items: [item()], version: 1, ...over,
});

const post = (over = {}) => ({
  id: 'p-1', blogId: 'b-1', title: 'Hello', handle: 'hello', body: 'Words.',
  excerpt: null, author: null, status: 'draft', publishedAt: null, version: 1, ...over,
});

test('a menu needs a title and a usable handle', () => {
  assert.throws(() => assertMenuValid(menu({ title: ' ' })), /title: is required/);
  assert.throws(() => assertMenuValid(menu({ handle: 'Main Menu' })), /lowercase letters/);
});

test('a menu cannot nest deeper than a drop-down can show', () => {
  const nest = (depth) =>
    depth === 0
      ? []
      : [item({ id: `d-${depth}`, title: `Level ${depth}`, children: nest(depth - 1) })];

  assert.doesNotThrow(() => assertMenuValid(menu({ items: nest(MAX_MENU_DEPTH) })));
  assert.throws(
    () => assertMenuValid(menu({ items: nest(MAX_MENU_DEPTH + 1) })),
    /nest 3 levels deep/,
  );
});

test('the same item cannot appear twice — that is how a cycle looks flattened', () => {
  assert.throws(
    () => assertMenuValid(menu({ items: [item(), item({ title: 'Home again' })] })),
    /appears more than once/,
  );
});

test('an external link cannot be javascript:, which would be stored XSS', () => {
  assert.throws(
    () => assertMenuValid(menu({ items: [item({ target: 'http', url: 'javascript:alert(1)' })] })),
    /must be http or https/,
  );
  assert.doesNotThrow(() =>
    assertMenuValid(menu({ items: [item({ target: 'http', url: 'https://example.test' })] })),
  );
  // An internal link that is not a path would render as a relative URL and
  // resolve somewhere nobody intended.
  assert.throws(
    () => assertMenuValid(menu({ items: [item({ target: 'page', url: 'about', subjectId: 'pg-1' })] })),
    /must start with "\/"/,
  );
});

test('an item pointing at one of our records has to say which', () => {
  assert.throws(
    () => assertMenuValid(menu({ items: [item({ target: 'product', url: '/products/x' })] })),
    /does not say which one/,
  );
  // Home and search point at nothing in particular, which is correct.
  assert.doesNotThrow(() => assertMenuValid(menu({ items: [item({ target: 'search', url: '/search' })] })));
});

test('broken links are reported, not silently removed', () => {
  const withPage = menu({
    items: [item({ id: 'a', target: 'page', url: '/pages/gone', subjectId: 'pg-gone' })],
  });

  // A merchant who deleted a page wants to know their menu points nowhere.
  // Dropping the item hides it and they hear about it from a customer.
  const broken = brokenLinks(withPage, () => false);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].subjectId, 'pg-gone');
  assert.equal(brokenLinks(withPage, () => true).length, 0);
});

test('flatten walks the whole tree', () => {
  const nested = menu({
    items: [item({ id: 'a', children: [item({ id: 'b', children: [item({ id: 'c' })] })] })],
  });
  assert.deepEqual(flatten(nested.items).map((entry) => entry.id), ['a', 'b', 'c']);
});

test('a blog needs a title and a handle', () => {
  assert.throws(() => assertBlogValid({ id: 'b', title: '', handle: 'news', commentPolicy: 'closed', version: 1 }), /title/);
  assert.throws(() => assertBlogValid({ id: 'b', title: 'News', handle: 'News!', commentPolicy: 'closed', version: 1 }), /lowercase/);
});

test('publishing an empty post is refused', () => {
  assert.doesNotThrow(() => assertPostValid(post()));
  assert.throws(
    () => assertPostValid(post({ status: 'published', body: '  ', publishedAt: new Date() })),
    /needs a body/,
  );
  assert.throws(
    () => assertPostValid(post({ status: 'published', publishedAt: null })),
    /needs a date/,
  );
  assert.throws(() => assertPostValid(post({ blogId: '' })), /must belong to a blog/);
});

test('a scheduled post is published with a future date, and is not yet visible', () => {
  const now = new Date('2026-03-01');
  const future = post({ status: 'published', publishedAt: new Date('2026-04-01') });
  const live = post({ status: 'published', publishedAt: new Date('2026-02-01') });

  // The bug this prevents: a storefront filtering on `status === 'published'`
  // publishes every scheduled post the moment it is saved.
  assert.equal(isVisible(future, now), false);
  assert.equal(isScheduled(future, now), true);

  assert.equal(isVisible(live, now), true);
  assert.equal(isScheduled(live, now), false);

  assert.equal(isVisible(post(), now), false);
  assert.equal(isScheduled(post(), now), false);
});
