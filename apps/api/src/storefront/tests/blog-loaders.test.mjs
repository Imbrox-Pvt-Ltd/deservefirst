/**
 * Storefront · tests/blog-loaders.test.mjs
 * Blogs and articles, and the promises their accessors have to await.
 *
 * The relation loaders are promises behind a synchronous signature — that is
 * what lets a drop be lazy, and it is a trap for any accessor that reads the
 * returned value instead of returning it. `article.url` did exactly that:
 *
 *     const handle = load?.(article.blogId)?.handle
 *
 * `.handle` off a Promise is `undefined`, so the URL fell through to
 * `/articles/<handle>` — a route that does not exist. Every link to a post,
 * from a blog index or from search, was a 404, and nothing failed loudly enough
 * to notice. A `dropList` built over a Promise has the same shape of failure:
 * it renders a list of nothing, which is what every blog index did.
 *
 * The loaders here return promises on purpose. A fake that answered
 * synchronously would pass against the broken code.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { articleDrop, blogDrop, createDropContext } from '../../../dist/storefront/domain/index.js';

const BLOG = { id: 'b1', handle: 'news', title: 'News', commentPolicy: 'closed' };

const ARTICLE = {
  id: 'a1', blogId: 'b1', handle: 'caring-for-linen', title: 'Caring for linen',
  body: '<p>Wash cool.</p>', excerpt: 'How to keep linen new.', author: 'Ada',
};

/** Every loader answers with a promise, exactly as the SQL ones do. */
const context = (overrides = {}) =>
  createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test',
    load: {
      variantsOfProduct: () => [], imagesOfProduct: () => [], image: () => null,
      productsOfCollection: () => [], productCountOfCollection: () => 0,
      blogOfArticle: async () => BLOG,
      articlesOfBlog: async () => [ARTICLE],
      articleCountOfBlog: async () => 1,
      tagsOfBlog: async () => ['linen', 'care'],
      commentsOfArticle: async () => [],
      commentPolicyOfArticle: async () => 'closed',
      ...overrides,
    },
  });

test('an article’s URL is built from its blog, which arrives as a promise', async () => {
  const article = articleDrop(ARTICLE, context());
  assert.equal(await article.url, '/blogs/news/caring-for-linen');
});

test('an article with no blog falls back rather than building a broken URL', async () => {
  /**
   * The fallback is still wrong as a route — it is here so a post orphaned by
   * a deleted blog renders at all. What must not happen is the fallback being
   * taken while the blog is perfectly findable, which is the bug this file
   * exists for.
   */
  const article = articleDrop(ARTICLE, context({ blogOfArticle: async () => null }));
  assert.equal(await article.url, '/articles/caring-for-linen');
});

test('a blog lists its posts', async () => {
  const blog = blogDrop(BLOG, context());
  /**
   * Awaited before the property, unlike in a template. Liquid resolves a
   * promise part-way along a path, so `blog.articles.size` works there — plain
   * JavaScript reads `.size` off the Promise itself and gets undefined.
   */
  const articles = await blog.articles;
  assert.equal(await articles.size, 1, 'a list built over a promise counts zero');
  assert.equal(await articles[0].title, 'Caring for linen');
  assert.equal(await articles[0].url, '/blogs/news/caring-for-linen');
});

test('a blog counts its posts and collects its tags', async () => {
  const blog = blogDrop(BLOG, context());
  assert.equal(await blog.articles_count, 1);
  assert.deepEqual(await blog.all_tags, ['linen', 'care']);
});

test('a blog with no loaders is empty rather than broken', async () => {
  /**
   * The theme editor and the tests both render without a database behind them.
   * A missing loader has to mean "nothing", not a thrown accessor that takes
   * the surrounding section down with it.
   */
  const bare = createDropContext({
    currency: 'USD', locale: 'en', baseUrl: 'https://x.test', load: {},
  });
  const blog = blogDrop(BLOG, bare);
  assert.equal(await (await blog.articles).size, 0);
  assert.equal(await blog.articles_count, 0);
  assert.deepEqual(await blog.all_tags, []);
  assert.equal(await articleDrop(ARTICLE, bare).url, '/articles/caring-for-linen');
});

test('comments stay closed until a policy says otherwise', async () => {
  /**
   * `comments_enabled` compared the loader's return value to a string. A
   * Promise is never equal to 'closed', so the comparison was true whatever the
   * merchant had chosen — a comment form on every article, posting nowhere.
   */
  const closed = articleDrop(ARTICLE, context());
  assert.equal(await closed.comments_enabled, false);

  const open = articleDrop(ARTICLE, context({ commentPolicyOfArticle: async () => 'moderated' }));
  assert.equal(await open.comments_enabled, true);
});
