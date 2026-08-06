/**
 * Storefront · infrastructure/sql-storefront-data.ts
 * The storefront ports, backed by the database.
 *
 * Every query here runs on behalf of an anonymous visitor, which changes what
 * "correct" means. There is no permission to check and no session to fall back
 * on, so two conditions have to be in the SQL itself rather than applied by a
 * caller who might forget:
 *
 *   · **store_id**, from the tenant context rather than from an argument. An
 *     argument can be forged by whatever built it; the context is set once, by
 *     the transport, from the resolved host.
 *   · **published**, because a by-handle lookup is a handle oracle. A visitor
 *     can ask for any name, so a draft that answers is a draft that leaked.
 *
 * The relation loaders are synchronous by signature because drops read them
 * during rendering. They return promises, which the engine awaits — measured,
 * and the reason drops can be lazy at all.
 * Layer: infrastructure.
 */

import { randomUUID } from 'node:crypto';

import type { QueryExecutor } from '../../core/list-engine';
import { Binder, writerFor } from '../../core/database/bind';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import {
  allProductsCollection,
  isAllProducts,
  isRequestToken,
  DEFAULT_SORT,
  FILTER_PARAMS,
  NO_FILTERS,
} from '../domain';
import type { StorefrontData } from '../api/storefront-ports';
import type {
  ArticleRow,
  CartRow,
  BlogRow,
  CollectionRow,
  FilterCriteria,
  FilterRow,
  MetafieldRow,
  MetafieldTree,
  ImageRow,
  PageRow,
  PolicyRow,
  ProductRow,
  RedirectRule,
  SearchResults,
  ShopRow,
  SitemapEntry,
  StoreAvailabilityRow,
  VariantRow,
} from '../domain';

interface Row extends Record<string, unknown> {}

export class SqlStorefrontData implements StorefrontData {
  constructor(
    private readonly executor: QueryExecutor,
    private readonly storefrontHost: string,
    private readonly dialect: SqlDialect = postgresDialect,
  ) {}

  private q(name: string): string {
    return this.dialect.quoteIdentifier(name);
  }

  private p(index: number): string {
    return this.dialect.placeholder(index);
  }

  /**
   * The store this request belongs to.
   *
   * Read from the ambient context on every query rather than captured in the
   * constructor. An instance built once and reused across requests would
   * otherwise serve whichever store happened to construct it — the exact bug
   * the context exists to make impossible.
   */
  /**
   * The current time, as SQL rather than as a value.
   *
   * Both dialects accept `CURRENT_TIMESTAMP(3)`, and letting the database
   * stamp it keeps every row on one clock — an application clock that drifts
   * puts a request's lines before the request that holds them.
   */
  private now(): string {
    return 'CURRENT_TIMESTAMP(3)';
  }

  private storeId(): string {
    return requireStoreContext('storefront.query').storeId;
  }

  async shop(): Promise<ShopRow> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('handle')}, ${this.q('name')},
              ${this.q('base_currency')}, ${this.q('default_locale')}
         FROM ${this.q('stores')}
        WHERE ${this.q('id')} = ${this.p(1)}`,
      [this.storeId()],
    );

    const row = rows[0];
    if (!row) throw new Error('the resolved store no longer exists');

    return {
      id: String(row.id),
      handle: String(row.handle),
      name: String(row.name),
      // Derived rather than stored: custom domains are a later feature, and a
      // half-built column would be a second source of truth for the same thing.
      domain: `${String(row.handle)}.${this.storefrontHost}`,
      currency: String(row.base_currency ?? 'USD'),
      enabledLocales: row.default_locale ? [String(row.default_locale)] : [],
    };
  }

  async settings(): Promise<Record<string, unknown>> {
    // Theme settings live in the theme's own `config/settings_data.json`, which
    // the ThemeSource reads. Nothing store-level overrides them yet.
    return {};
  }

  /**
   * A published product by handle.
   *
   * `status = 'active'` is the published filter, and it is in the SQL rather
   * than applied afterwards for a reason: this is the query `all_products`
   * calls with a handle a visitor supplied.
   */
  async productByHandle(handle: string): Promise<ProductRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('products')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('status')} = 'active'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), handle],
    );
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async collectionByHandle(handle: string): Promise<CollectionRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('collections')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];

    /**
     * The automatic collection, when no real one claims the handle.
     *
     * AFTER the lookup, not before: a merchant who genuinely created a
     * collection called `all` keeps it. Shadowing a real one would hide
     * products they deliberately grouped, with nothing to explain why.
     */
    if (!row && isAllProducts(handle)) {
      const shop = await this.shop();
      return allProductsCollection(shop.name);
    }

    return row
      ? {
          id: String(row.id),
          handle: String(row.handle),
          title: String(row.title),
          description: row.description as string | null,
          updatedAt: row.updated_at as string | null,
        }
      : null;
  }

  async pageByHandle(handle: string): Promise<PageRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('pages')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('status')} = 'published'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          handle: String(row.handle),
          title: String(row.title),
          body: row.body as string | null,
          templateSuffix: row.template_suffix as string | null,
          createdAt: row.created_at as string | null,
          publishedAt: row.published_at as string | null,
          updatedAt: row.updated_at as string | null,
        }
      : null;
  }

  async blogByHandle(handle: string): Promise<BlogRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('blogs')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          handle: String(row.handle),
          title: String(row.title),
          commentPolicy: row.comment_policy as string | null,
        }
      : null;
  }

  /**
   * An article, matched by its blog as well as its own handle.
   *
   * Both, because two blogs may legitimately have a post called
   * "spring-launch" — matching on the article handle alone would serve
   * whichever row came back first.
   */
  async articleByHandle(blogHandle: string, handle: string): Promise<ArticleRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT a.* FROM ${this.q('blog_posts')} a
         JOIN ${this.q('blogs')} b ON b.${this.q('id')} = a.${this.q('blog_id')}
        WHERE a.${this.q('store_id')} = ${this.p(1)}
          AND b.${this.q('handle')} = ${this.p(2)}
          AND a.${this.q('handle')} = ${this.p(3)}
          AND a.${this.q('status')} = 'published'
          AND a.${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), blogHandle, handle],
    );
    const row = rows[0];
    return row ? toArticle(row) : null;
  }

  /**
   * Relations return promises through a synchronous signature.
   *
   * Drops read these while a template renders, and the engine awaits any
   * promise it is handed — verified before the drop layer was designed around
   * it. The alternative is loading every relation before rendering, which is
   * the eager behaviour the laziness exists to avoid.
   */
  variantsOfProduct(productId: string): readonly VariantRow[] {
    return this.executor.query<Row>(
      `SELECT * FROM ${this.q('product_variants')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('product_id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('position')} ASC`,
      [this.storeId(), productId],
    ).then((rows) => rows.map(toVariant)) as unknown as readonly VariantRow[];
  }

  /**
   * A product's images — from a table that does not exist yet.
   *
   * `product_images` is queried here and declared by no manifest, so it is
   * absent from the schema. Pages render today only because the reference theme
   * falls back to its placeholder graphic without ever awaiting this promise;
   * the query throws the moment anything actually reads `product.images`.
   *
   * Left as a query rather than as an empty array on purpose: returning `[]`
   * would make a missing feature look like a merchant with no photographs, and
   * the failure would then only appear once somebody uploaded one. A product
   * image entity on the catalogue manifest is the fix.
   */
  /**
   * The posts of one blog, newest first.
   *
   * Published-only and store-scoped in the SQL, for the same reason every other
   * storefront query is: this renders for an anonymous visitor and there is no
   * caller left to apply the filter.
   *
   * `published_at DESC` with the id as a tiebreak, so two posts published in
   * the same moment do not swap places between one request and the next — a
   * paginated list that reorders itself shows some posts twice and others never.
   */
  articlesOfBlog(blogId: string): readonly ArticleRow[] {
    return this.executor.query<Row>(
      `SELECT * FROM ${this.q('blog_posts')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('blog_id')} = ${this.p(2)}
          AND ${this.q('status')} = 'published'
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('published_at')} DESC, ${this.q('id')} DESC
        LIMIT 250`,
      [this.storeId(), blogId],
    ).then((rows) => rows.map(toArticle)) as unknown as readonly ArticleRow[];
  }

  articleCountOfBlog(blogId: string): number {
    return this.executor.query<Row>(
      `SELECT COUNT(*) AS n FROM ${this.q('blog_posts')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('blog_id')} = ${this.p(2)}
          AND ${this.q('status')} = 'published'
          AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId(), blogId],
    ).then((rows) => Number(rows[0]?.n ?? 0)) as unknown as number;
  }

  /**
   * The blog a post belongs to, which is where its URL comes from.
   *
   * Named for the caller rather than for the argument — the drop holds an
   * article and asks about its blog; that the article already carries the blog
   * id is an implementation detail of the row.
   */
  blogOfArticle(blogId: string): BlogRow | null {
    return this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('handle')}, ${this.q('title')},
              ${this.q('comment_policy')}
         FROM ${this.q('blogs')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), blogId],
    ).then((rows) => {
      const row = rows[0];
      return row
        ? {
            id: String(row.id),
            handle: String(row.handle),
            title: String(row.title),
            commentPolicy: row.comment_policy as string | null,
          }
        : null;
    }) as unknown as BlogRow | null;
  }

  /**
   * Every tag used by a blog's published posts.
   *
   * Joined through the posts rather than read from a blog-level column,
   * because a tag exists only by being applied — a list kept separately drifts
   * the moment a post is deleted, and offers a filter that matches nothing.
   */
  tagsOfBlog(blogId: string): readonly string[] {
    return this.executor.query<Row>(
      `SELECT DISTINCT t.${this.q('tag')} AS tag
         FROM ${this.q('blog_posts_tags')} t
         JOIN ${this.q('blog_posts')} a ON a.${this.q('id')} = t.${this.q('owner_id')}
        WHERE a.${this.q('store_id')} = ${this.p(1)}
          AND a.${this.q('blog_id')} = ${this.p(2)}
          AND a.${this.q('status')} = 'published'
          AND a.${this.q('deleted_at')} IS NULL
        ORDER BY t.${this.q('tag')} ASC`,
      [this.storeId(), blogId],
    ).then((rows) => rows.map((row) => String(row.tag))) as unknown as readonly string[];
  }

  /**
   * The posts either side of this one.
   *
   * Read from the blog's ordered list rather than with two comparison queries.
   * `published_at > x` needs a tiebreak when two posts share a timestamp, and
   * getting that subtly wrong shows a "next" link that goes backwards — using
   * the same ordering the index uses means the arrows agree with the list.
   *
   * "Next" is the newer post, matching the order a blog index is read in.
   */
  async adjacentArticles(
    blogId: string,
    articleId: string,
  ): Promise<{ previous: ArticleRow | null; next: ArticleRow | null }> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('blog_posts')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('blog_id')} = ${this.p(2)}
          AND ${this.q('status')} = 'published'
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('published_at')} DESC, ${this.q('id')} DESC
        LIMIT 250`,
      [this.storeId(), blogId],
    );

    const at = rows.findIndex((row) => String(row.id) === articleId);
    if (at === -1) return { previous: null, next: null };

    // The list is newest first, so the NEWER neighbour is the earlier index.
    const next = at > 0 ? rows[at - 1] : undefined;
    const previous = at + 1 < rows.length ? rows[at + 1] : undefined;
    return {
      previous: previous ? toArticle(previous) : null,
      next: next ? toArticle(next) : null,
    };
  }

  imagesOfProduct(productId: string): readonly ImageRow[] {
    return this.executor.query<Row>(
      `SELECT * FROM ${this.q('product_images')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('product_id')} = ${this.p(2)}
        ORDER BY ${this.q('position')} ASC`,
      [this.storeId(), productId],
    ).then((rows) => rows.map(toImage)) as unknown as readonly ImageRow[];
  }

  /**
   * Products worth showing beside this one.
   *
   * "Same product type, else same vendor, else anything recent", ranked in that
   * order by a CASE rather than by three queries — one round trip, and the
   * ordering is the ranking.
   *
   * Deliberately naive, and worth being honest about: it is not personalised,
   * it does not learn, and it has no idea what sells together. It is the
   * difference between a product page with an empty carousel and one with a
   * plausible row of products, which is the whole gap that matters today. A
   * real recommender replaces this function and nothing else.
   */
  async recommendedProducts(productId: string, limit: number): Promise<readonly ProductRow[]> {
    /**
     * Built through a `Binder`, because this statement names the same two
     * values four times.
     *
     * Written with positional helpers first — `p(1)` for the store twice and
     * `p(2)` for the product twice — which produced four `?` and two values.
     * On Postgres that is correct, because `$1` names a value; on MySQL every
     * `?` takes the NEXT one, so the statement was two parameters short and
     * failed to parse.
     *
     * Then, using `Binder` but calling `add` into NAMED CONSTS above the
     * statement, the count matched and the order did not: the first `?` in the
     * text was the product and the first value added was the store, so the join
     * compared a product id to a store id and matched nothing. No error — an
     * empty carousel.
     *
     * So the calls are inlined where the placeholders appear. Order is then a
     * property of the text rather than something to keep in step by hand, which
     * is the only version of this that stays correct.
     */
    const bind = new Binder(this.dialect);
    const storeId = this.storeId();

    const sql = `SELECT p.*,
              CASE
                WHEN p.${this.q('product_type')} = s.${this.q('product_type')}
                     AND s.${this.q('product_type')} IS NOT NULL
                     AND s.${this.q('product_type')} <> '' THEN 0
                WHEN p.${this.q('vendor')} = s.${this.q('vendor')}
                     AND s.${this.q('vendor')} IS NOT NULL
                     AND s.${this.q('vendor')} <> '' THEN 1
                ELSE 2
              END AS rank_order
         FROM ${this.q('products')} p
         JOIN ${this.q('products')} s
           ON s.${this.q('id')} = ${bind.add(productId)}
          AND s.${this.q('store_id')} = ${bind.add(storeId)}
        WHERE p.${this.q('store_id')} = ${bind.add(storeId)}
          AND p.${this.q('id')} <> ${bind.add(productId)}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
        ORDER BY rank_order ASC, p.${this.q('created_at')} DESC
        LIMIT ${Math.max(1, Math.min(Math.floor(limit), 50))}`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows.map(toProduct);
  }

  /**
   * Where one variant can be collected.
   *
   * Joined from the location side rather than the stock side, so a shop that
   * takes collections and has none of this variant still APPEARS — marked
   * unavailable. A theme shows "not available at Camden" beside the shops that
   * do have it, and dropping the row entirely would leave a customer wondering
   * whether their nearest shop was ever an option.
   *
   * Archived locations are excluded outright: a shop that has closed is not an
   * option a customer should be offered at all.
   */
  availabilitiesOfVariant(variantId: string): readonly StoreAvailabilityRow[] {
    const bind = new Binder(this.dialect);

    const sql = `SELECT l.${this.q('id')} AS location_id,
                        l.${this.q('name')} AS location_name,
                        l.${this.q('address')} AS location_address,
                        l.${this.q('country_code')} AS country_code,
                        l.${this.q('pickup_enabled')} AS pickup_enabled,
                        l.${this.q('pickup_time')} AS pickup_time,
                        COALESCE(v.${this.q('on_hand')}, 0) - COALESCE(v.${this.q('committed')}, 0) AS sellable
           FROM ${this.q('locations')} l
           LEFT JOIN ${this.q('inventory_levels')} v
             ON v.${this.q('location_id')} = l.${this.q('id')}
            AND v.${this.q('variant_id')} = ${bind.add(variantId)}
            AND v.${this.q('deleted_at')} IS NULL
          WHERE l.${this.q('store_id')} = ${bind.add(this.storeId())}
            AND l.${this.q('deleted_at')} IS NULL
            AND l.${this.q('archived_at')} IS NULL
          ORDER BY l.${this.q('name')} ASC`;

    const statement = bind.finish(sql);

    return this.executor.query<Row>(statement.sql, statement.parameters).then((rows) =>
      rows.map((row) => ({
        // Sellable stock, not on-hand: a unit already promised to somebody
        // else's order is not one a customer can collect today.
        available: Number(row.sellable ?? 0) > 0,
        pickUpEnabled: row.pickup_enabled === 1 || row.pickup_enabled === true,
        pickUpTime: (row.pickup_time as string | null) ?? null,
        location: {
          id: String(row.location_id),
          name: String(row.location_name ?? ''),
          address: (row.location_address as string | null) ?? null,
          countryCode: (row.country_code as string | null) ?? null,
        },
      })),
    ) as unknown as readonly StoreAvailabilityRow[];
  }

  /**
   * What a shopper typing this is probably looking for.
   *
   * Four queries in parallel rather than four in sequence: this runs on every
   * keystroke, so the wait is the SLOWEST of them rather than their sum.
   *
   * Matched with `LIKE '%term%'`, which is honest to name as the limitation it
   * is — a leading wildcard cannot use an index, so this reads the table. It is
   * right for a store with hundreds of products and wrong for one with
   * hundreds of thousands, where the answer is a real index rather than a
   * cleverer query. Every result is published-only, because a search box is a
   * handle oracle otherwise: a shopper could discover a draft product by
   * guessing at its name.
   */
  async search(terms: string, limit: number): Promise<SearchResults> {
    const like = `%${terms}%`;
    const cap = Math.max(1, Math.min(Math.floor(limit), 20));

    /**
     * One helper, because the four searches differ only in table and columns.
     *
     * The binder is built INSIDE it and finished against the SQL it produced,
     * so the values can never drift from the placeholders — the mistake that
     * cost two debugging rounds on recommendations.
     */
    const find = <T>(
      table: string,
      columns: readonly string[],
      published: string,
      map: (row: Row) => T,
    ): Promise<T[]> => {
      const bind = new Binder(this.dialect);
      const store = bind.add(this.storeId());
      const matches = columns
        .map((column) => `${this.q(column)} LIKE ${bind.add(like)}`)
        .join(' OR ');

      const sql = `SELECT * FROM ${this.q(table)}
        WHERE ${this.q('store_id')} = ${store}
          AND ${this.q('deleted_at')} IS NULL
          ${published}
          AND (${matches})
        ORDER BY ${this.q('title')} ASC
        LIMIT ${cap}`;

      const statement = bind.finish(sql);
      return this.executor.query<Row>(statement.sql, statement.parameters).then((rows) =>
        rows.map(map),
      );
    };

    const products = find('products', ['title', 'handle', 'vendor'], `AND ${this.q('status')} = 'active'`, toProduct);

    const collections = find('collections', ['title', 'handle'], '', (row) => ({
      id: String(row.id),
      handle: String(row.handle),
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      imageId: null,
    }));

    const pages = find('pages', ['title', 'handle'], `AND ${this.q('status')} = 'published'`, (row) => ({
      id: String(row.id),
      handle: String(row.handle),
      title: String(row.title),
      body: (row.body as string | null) ?? null,
    }));

    const articles = find('blog_posts', ['title', 'handle'], `AND ${this.q('status')} = 'published'`, toArticle);

    const [foundProducts, foundCollections, foundPages, foundArticles] = await Promise.all([
      products, collections, pages, articles,
    ]);

    return {
      products: foundProducts,
      collections: foundCollections,
      pages: foundPages,
      articles: foundArticles,
      // Nothing records what people search for yet, so there is nothing to
      // suggest. Present because the theme counts it.
      queries: [],
    };
  }

  productsOfCollection(
    collectionId: string,
    criteria: FilterCriteria = NO_FILTERS,
    sort: string = DEFAULT_SORT,
  ): readonly ProductRow[] {
    /**
     * The automatic collection is the whole catalogue, so there is no join.
     *
     * Its id is the handle rather than a row's, because there is no row — see
     * `domain/all-products.ts`.
     */
    return this.membersOf(collectionId, false, criteria, sort).then((rows) =>
      rows.map(toProduct),
    ) as unknown as readonly ProductRow[];
  }

  productCountOfCollection(
    collectionId: string,
    criteria: FilterCriteria = NO_FILTERS,
  ): number {
    return this.membersOf(collectionId, true, criteria).then(
      (rows) => rows.length,
    ) as unknown as number;
  }

  /**
   * The products in a collection, however that collection decides.
   *
   * There is no join table. A collection carries its own membership: a manual
   * one lists product ids, an automated one carries conditions — and this
   * previously queried a `collection_products` table that has never existed in
   * any migration, so every real collection page threw. It stayed hidden
   * because the only collection anything rendered was the automatic
   * "all products" one above, which never reaches here.
   *
   * The conditions become SQL rather than a filter over every product, because
   * the alternative is loading the catalogue into memory to render one page.
   * The translation mirrors `matchesCondition` in the catalog's domain exactly,
   * including its unhappy paths — an operator that makes no sense for a field
   * matches nothing there, and must match nothing here, or the storefront shows
   * a different collection than the admin does.
   *
   * `countOnly` skips the row bodies; the caller needs a number, and a
   * collection of 250 products should not serialise 250 rows to produce it.
   */
  private async membersOf(
    collectionId: string,
    countOnly: boolean,
    criteria: FilterCriteria = NO_FILTERS,
    sort: string = DEFAULT_SORT,
  ): Promise<Row[]> {
    const collection = await this.collectionRule(collectionId);
    if (!collection) return [];

    const bind = new Binder(this.dialect);
    const selected = countOnly ? `p.${this.q('id')}` : 'p.*';

    /**
     * Bound FIRST, because it appears first in the SQL below.
     *
     * A binder consumes values in the order they are added and MySQL's `?`
     * takes the next one, so a value added out of text order is silently given
     * to the wrong placeholder. The count still matches, nothing throws, and
     * the query compares a product id to a store id and returns nothing —
     * which is precisely what happened here before this line moved up.
     */
    const store = bind.add(this.storeId());

    const membership = this.membershipWhere(collection, bind);
    if (!membership) return [];

    const where = [...membership, ...this.criteriaWhere(criteria, bind)];

    const sql = `SELECT ${selected} FROM ${this.q('products')} p
        WHERE p.${this.q('store_id')} = ${store}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
          ${where.map((clause) => `AND ${clause}`).join('\n          ')}
        ORDER BY ${this.orderBy(sort)}
        LIMIT 250`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);

    /**
     * A manual collection is ordered by the merchant, and that order lives in
     * the id array rather than in any column — so it cannot be an ORDER BY
     * without `FIELD()`/`array_position`, which differ by dialect. Sorting the
     * page of rows we already hold costs nothing and works on both.
     *
     * Only when the shopper has not chosen an order of their own: "price, low
     * to high" must mean that, not the merchant's order re-applied on top.
     */
    if (collection.isManual && !countOnly && sort === DEFAULT_SORT) {
      const position = new Map(collection.productIds.map((id, index) => [id, index]));
      rows.sort((a, b) => (position.get(String(a.id)) ?? 0) - (position.get(String(b.id)) ?? 0));
    }

    return rows;
  }

  /**
   * The filters a shopper can apply to this collection, with live counts.
   *
   * One query per facet, each counting the collection's products with every
   * OTHER active filter applied but not its own — see `criteriaWhere`. Four
   * queries rather than one grouped monster because the dimensions have
   * different shapes (a tag lives in another table, a price is a range), and a
   * single query that produced all of them would be unreadable and no faster.
   *
   * A facet with one value is dropped. "Vendor: Acme (12)" beside a collection
   * where every product is by Acme is a control that cannot change anything.
   */
  async facetsOfCollection(
    collectionId: string,
    criteria: FilterCriteria,
  ): Promise<readonly FilterRow[]> {
    const collection = await this.collectionRule(collectionId);
    if (!collection) return [];

    const [types, vendors, tags, price] = await Promise.all([
      this.facetCounts(collection, criteria, 'productType', `COALESCE(p.${this.q('product_type')}, '')`),
      this.facetCounts(collection, criteria, 'vendor', `COALESCE(p.${this.q('vendor')}, '')`),
      this.tagCounts(collection, criteria),
      this.priceRange(collection, criteria),
    ]);

    const filters: FilterRow[] = [];

    const listFacet = (
      label: string,
      param: string,
      counted: readonly { value: string; count: number }[],
      active: readonly string[],
    ): void => {
      if (counted.length < 2) return;
      const chosen = new Set(active.map((value) => value.toLowerCase()));
      filters.push({
        label,
        param,
        filterType: 'list',
        values: counted.map((entry) => ({
          value: entry.value,
          label: entry.value,
          count: entry.count,
          active: chosen.has(entry.value.toLowerCase()),
          param,
        })),
      });
    };

    listFacet('Type', FILTER_PARAMS.productType, types, criteria.productTypes);
    listFacet('Vendor', FILTER_PARAMS.vendor, vendors, criteria.vendors);
    listFacet('Tag', FILTER_PARAMS.tag, tags, criteria.tags);

    /**
     * The price range spans the collection, not the current selection.
     *
     * A slider whose ends move as you drag it cannot be dragged back — the
     * bounds have to be the range that exists, with the shopper's own choice
     * shown as the handles inside it.
     */
    if (price && price.max > price.min) {
      filters.push({
        label: 'Price',
        param: FILTER_PARAMS.priceMin,
        filterType: 'price_range',
        values: [],
        // The shopper's own handles, which are absent until they move one —
        // distinct from the bounds below, which always exist.
        minValue: criteria.priceMin,
        maxValue: criteria.priceMax,
        rangeMin: price.min,
        rangeMax: price.max,
      });
    }

    return filters;
  }

  /**
   * How many products a visitor could reach.
   *
   * Active only. A count that included drafts would tell a shopper how many
   * products they are not allowed to see, which is both wrong and a leak.
   */
  productCount(): number {
    return this.executor.query<Row>(
      `SELECT COUNT(*) AS n FROM ${this.q('products')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('status')} = 'active'
          AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId()],
    ).then((rows) => Number(rows[0]?.n ?? 0)) as unknown as number;
  }

  /**
   * How many collections there are.
   *
   * Collections carry no status column — a collection is visible when it
   * exists — so this filters on deletion alone rather than inventing a
   * publication rule the admin does not have.
   */
  collectionCount(): number {
    return this.executor.query<Row>(
      `SELECT COUNT(*) AS n FROM ${this.q('collections')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId()],
    ).then((rows) => Number(rows[0]?.n ?? 0)) as unknown as number;
  }

  productTypes(): readonly string[] {
    return this.distinctColumn('product_type') as unknown as readonly string[];
  }

  productVendors(): readonly string[] {
    return this.distinctColumn('vendor') as unknown as readonly string[];
  }

  /**
   * One column's distinct values across the store's visible products.
   *
   * Blanks are dropped rather than returned as an empty entry: a product with
   * no vendor is not a vendor whose name is "", and a theme rendering these as
   * links would draw one pointing nowhere.
   */
  private distinctColumn(column: string): Promise<string[]> {
    return this.executor.query<Row>(
      `SELECT DISTINCT ${this.q(column)} AS value FROM ${this.q('products')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('status')} = 'active'
          AND ${this.q('deleted_at')} IS NULL
          AND ${this.q(column)} IS NOT NULL
          AND ${this.q(column)} <> ''
        ORDER BY value ASC`,
      [this.storeId()],
    ).then((rows) => rows.map((row) => String(row.value)));
  }

  productTypesOfCollection(collectionId: string): readonly string[] {
    return this.distinctInCollection(collectionId, 'product_type') as unknown as readonly string[];
  }

  productVendorsOfCollection(collectionId: string): readonly string[] {
    return this.distinctInCollection(collectionId, 'vendor') as unknown as readonly string[];
  }

  /**
   * The same, through a collection's membership rule.
   *
   * Reuses the facet counter rather than repeating the membership SQL — these
   * are the facet's own values with the counts thrown away, and a second
   * implementation would be a second thing to get wrong when membership
   * changes. Unfiltered on purpose: `collection.all_vendors` means every vendor
   * in the collection, not the ones left after a shopper has ticked something.
   */
  private async distinctInCollection(collectionId: string, column: string): Promise<string[]> {
    const collection = await this.collectionRule(collectionId);
    if (!collection) return [];

    const counted = await this.facetCounts(
      collection,
      NO_FILTERS,
      column === 'vendor' ? 'vendor' : 'productType',
      `COALESCE(p.${this.q(column)}, '')`,
    );
    return counted.map((entry) => entry.value);
  }

  /**
   * Which collections hold this product.
   *
   * The reverse of the membership question, and it has no reverse index:
   * membership is a JSON array on manual collections and a set of conditions on
   * automated ones, so neither can be looked up from the product side.
   *
   * Both kinds are answered, which is the point — checking only the manual ones
   * would be quietly wrong on exactly the stores that use automation most, and
   * a breadcrumb that omits half a catalogue's collections is worse than none.
   * Manual membership is decided in memory from the ids already loaded;
   * automated membership becomes one query that asks all of them at once, so
   * the cost is two round trips rather than one per collection.
   */
  /**
   * The metafields of one record that a storefront may show.
   *
   * An INNER JOIN onto the definitions, and that join is the security control:
   * a value whose definition is missing, or whose definition has not granted
   * `public_read`, cannot come back at all. Written this way round on purpose —
   * a LEFT JOIN with a filter afterwards is one edit away from leaking
   * everything, and the thing being leaked is a merchant's cost prices and
   * supplier names.
   *
   * Grouped `namespace -> key -> { type, value }` because that is the path a
   * theme reads: `product.metafields.information.directions.value`.
   */
  async metafieldsOf(ownerEntity: string, ownerId: string): Promise<MetafieldTree> {
    const table = METAFIELD_TABLES[ownerEntity];
    // An owner kind with no side table is not an error to report to a visitor;
    // it is simply a record that cannot carry custom data.
    if (!table) return {};

    const bind = new Binder(this.dialect);
    const sql = `SELECT m.${this.q('namespace')} AS namespace,
                        m.${this.q('metafield_key')} AS metafield_key,
                        m.${this.q('value')} AS value,
                        d.${this.q('value_type')} AS value_type
           FROM ${this.q(table)} m
           JOIN ${this.q('metafield_definitions')} d
             ON d.${this.q('store_id')} = m.${this.q('store_id')}
            AND d.${this.q('owner_entity')} = ${bind.add(ownerEntity)}
            AND d.${this.q('namespace')} = m.${this.q('namespace')}
            AND d.${this.q('metafield_key')} = m.${this.q('metafield_key')}
            AND d.${this.q('storefront_access')} = 'public_read'
            AND d.${this.q('deleted_at')} IS NULL
          WHERE m.${this.q('store_id')} = ${bind.add(this.storeId())}
            AND m.${this.q('owner_id')} = ${bind.add(ownerId)}`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);

    const tree: Record<string, Record<string, MetafieldRow>> = {};
    for (const row of rows) {
      const namespace = String(row.namespace ?? '');
      const key = String(row.metafield_key ?? '');
      if (namespace === '' || key === '') continue;
      (tree[namespace] ??= {})[key] = {
        namespace,
        key,
        type: String(row.value_type ?? 'single_line_text_field'),
        value: metafieldValue(row.value, String(row.value_type ?? '')),
      };
    }
    return tree;
  }

  /**
   * A store's policies, keyed by kind.
   *
   * A policy with no body is left out entirely. Themes link a policy from the
   * footer and from a product page, and an unwritten one appearing as a link to
   * an empty page is worse than it simply not being offered — so "not written"
   * and "not present" are deliberately the same thing here.
   */
  async policies(): Promise<Readonly<Record<string, PolicyRow>>> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('policies')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId()],
    );

    const byKind: Record<string, PolicyRow> = {};
    for (const row of rows) {
      const body = (row.body as string | null) ?? '';
      if (body.trim() === '') continue;
      byKind[String(row.policy_type ?? '')] = toPolicy(row);
    }
    return byKind;
  }

  async policyByHandle(handle: string): Promise<PolicyRow | null> {
    const rows = await this.executor.query<Row>(
      `SELECT * FROM ${this.q('policies')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('handle')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), handle],
    );
    const row = rows[0];
    // An unwritten policy is not a page: it 404s rather than rendering blank.
    if (!row || String((row.body as string | null) ?? '').trim() === '') return null;
    return toPolicy(row);
  }

  collectionsOfProduct(productId: string): readonly CollectionRow[] {
    return this.collectionsHolding(productId) as unknown as readonly CollectionRow[];
  }

  private async collectionsHolding(productId: string): Promise<CollectionRow[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('id')}, ${this.q('handle')}, ${this.q('title')},
              ${this.q('description')}, ${this.q('updated_at')}, ${this.q('type')},
              ${this.q('match')}, ${this.q('conditions')}, ${this.q('exclusions')},
              ${this.q('product_ids')}
         FROM ${this.q('collections')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('title')} ASC
        LIMIT 250`,
      [this.storeId()],
    );

    const toRow = (row: Row): CollectionRow => ({
      id: String(row.id),
      handle: String(row.handle),
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
    });

    const held: CollectionRow[] = [];
    const automated: Row[] = [];

    for (const row of rows) {
      if (String(row.type ?? 'manual') !== 'automated') {
        if (parseIdList(row.product_ids).includes(productId)) held.push(toRow(row));
        continue;
      }
      automated.push(row);
    }

    if (automated.length === 0) return held;

    /**
     * Every automated collection asked in one statement.
     *
     * Each branch selects a literal collection id when this one product
     * satisfies that collection's rule, so the answer is the set of branches
     * that matched. One query per collection would be one round trip per
     * collection on a page a shopper is waiting for.
     */
    const bind = new Binder(this.dialect);
    const branches: string[] = [];

    for (const row of automated) {
      const conditions = parseConditions(row.conditions);
      // No conditions selects nothing, exactly as membership does.
      if (conditions.length === 0) continue;

      /**
       * Bound in the order the placeholders appear BELOW, before the
       * predicates that follow them in the text.
       *
       * Building the predicates first would add their values ahead of these
       * three, and a binder consumes values in the order they are added — so
       * every branch would compare a product id to a collection id, match
       * nothing, and throw nothing. That has now happened four times in this
       * file; it is why each of these is a named const rather than an
       * expression inlined into the template.
       */
      const collectionId = bind.add(String(row.id));
      const store = bind.add(this.storeId());
      const product = bind.add(productId);

      const joiner = String(row.match ?? 'all') === 'any' ? ' OR ' : ' AND ';
      const where = [`(${conditions.map((c) => this.predicateFor(c, bind)).join(joiner)})`];
      for (const exclusion of parseConditions(row.exclusions)) {
        where.push(`NOT (${this.predicateFor(exclusion, bind)})`);
      }

      branches.push(
        `SELECT ${collectionId} AS collection_id
           FROM ${this.q('products')} p
          WHERE p.${this.q('store_id')} = ${store}
            AND p.${this.q('id')} = ${product}
            AND p.${this.q('status')} = 'active'
            AND p.${this.q('deleted_at')} IS NULL
            AND ${where.join(' AND ')}`,
      );
    }

    if (branches.length === 0) return held;

    const statement = bind.finish(branches.join('\n         UNION ALL\n'));
    const matched = await this.executor.query<Row>(statement.sql, statement.parameters);
    const ids = new Set(matched.map((row) => String(row.collection_id)));

    for (const row of automated) {
      if (ids.has(String(row.id))) held.push(toRow(row));
    }

    // Re-sorted because the automated ones were appended after the manual ones.
    return held.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * The draft request behind a visitor's token — what a theme calls the cart.
   *
   * An empty cart for an unknown or absent token, never null and never an
   * error. A token can be absent (first visit), stale (the draft was submitted
   * and is no longer a draft) or forged, and all three mean the same thing to a
   * shopper: nothing in the cart yet. Answering with an error would break the
   * header on every page instead.
   */
  async draftRequest(token: string | null): Promise<CartRow> {
    const shop = await this.shop();
    const empty: CartRow = { items: [], currency: shop.currency };
    if (!isRequestToken(token)) return empty;

    const request = await this.draftRow(token);
    if (!request) return empty;

    const bind = new Binder(this.dialect);
    /**
     * The product and variant come back with the line.
     *
     * A cart row prints the product's title and link and the variant's
     * options, and loading each product separately would be one query per line
     * on the one page where a shopper is waiting on a decision already made.
     */
    const sql = `SELECT l.*, p.${this.q('handle')} AS product_handle,
                        p.${this.q('vendor')} AS vendor,
                        p.${this.q('option_names')} AS option_names,
                        v.${this.q('option_values')} AS option_values,
                        v.${this.q('compare_at_price_amount_minor')} AS compare_at_price,
                        v.${this.q('unit_quantity_value')} AS unit_quantity_value,
                        v.${this.q('unit_quantity_unit')} AS unit_quantity_unit,
                        v.${this.q('unit_reference_value')} AS unit_reference_value,
                        v.${this.q('unit_reference_unit')} AS unit_reference_unit
           FROM ${this.q('request_lines')} l
           LEFT JOIN ${this.q('products')} p ON p.${this.q('id')} = l.${this.q('product_id')}
           LEFT JOIN ${this.q('product_variants')} v ON v.${this.q('id')} = l.${this.q('variant_id')}
          WHERE l.${this.q('store_id')} = ${bind.add(this.storeId())}
            AND l.${this.q('request_id')} = ${bind.add(String(request.id))}
            AND l.${this.q('deleted_at')} IS NULL
          ORDER BY l.${this.q('position')} ASC, l.${this.q('id')} ASC`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        productId: String(row.product_id ?? ''),
        variantId: String(row.variant_id ?? ''),
        title: String(row.title ?? ''),
        quantity: Number(row.quantity ?? 0),
        // The price as it was when the line was added, not today's. A shopper
        // returning to a week-old list should see what they were quoted.
        unitPriceMinor: (row.list_price_amount_minor as string | number | null) ?? 0,
        sku: (row.sku as string | null) ?? null,
        vendor: (row.vendor as string | null) ?? null,
        url: row.product_handle ? `/products/${String(row.product_handle)}` : null,
        productHandle: (row.product_handle as string | null) ?? null,
        optionValues: parseStringList(row.option_values),
        optionNames: parseStringList(row.option_names),
        compareAtPriceMinor: (row.compare_at_price as string | number | null) ?? null,
        unitQuantityValue: (row.unit_quantity_value as number | string | null) ?? null,
        unitQuantityUnit: (row.unit_quantity_unit as string | null) ?? null,
        unitReferenceValue: (row.unit_reference_value as number | string | null) ?? null,
        unitReferenceUnit: (row.unit_reference_unit as string | null) ?? null,
      })),
      currency: String(request.currency ?? shop.currency),
      customerMessage: (request.note as string | null) ?? null,
    };
  }

  async addToRequest(
    token: string | null,
    variantId: string,
    quantity: number,
  ): Promise<{ token: string; added: boolean }> {
    const writer = writerFor(this.executor, 'adding to a request');

    /**
     * The variant is read before anything is written, and read through the
     * store scope.
     *
     * A variant id arrives from a form, so it names whatever the sender chose.
     * Without this a visitor could add another store's product to their list —
     * and its title and price would render on this store's cart page.
     */
    const variant = await this.variantForRequest(variantId);
    if (!variant) return { token: isRequestToken(token) ? token : '', added: false };

    const existing = isRequestToken(token) ? await this.draftRow(token) : null;
    const settled = existing ? String(existing.handle) : randomToken();
    const requestId = existing ? String(existing.id) : `req_${randomToken()}`;

    if (!existing) {
      const bind = new Binder(this.dialect);
      const sql = `INSERT INTO ${this.q('requests')}
          (${this.q('id')}, ${this.q('store_id')}, ${this.q('handle')},
           ${this.q('created_at')}, ${this.q('updated_at')}, ${this.q('version')},
           ${this.q('reference')}, ${this.q('status')}, ${this.q('currency')},
           ${this.q('line_count')}, ${this.q('published_channels')})
        VALUES (${bind.add(requestId)}, ${bind.add(this.storeId())}, ${bind.add(settled)},
                ${this.now()}, ${this.now()}, 1,
                ${bind.add(referenceFor(settled))}, 'draft',
                ${bind.add(String((await this.shop()).currency))}, 0, '[]')`;
      const statement = bind.finish(sql);
      await writer.execute(statement.sql, statement.parameters);
    }

    /**
     * One line per variant: asking for two more of something you already asked
     * for is a quantity, not a second line. Themes rely on this — a cart that
     * grows a new row per click looks broken.
     */
    const line = await this.lineForVariant(requestId, variantId);
    if (line) {
      await this.setRequestLine(settled, String(line.id), Number(line.quantity ?? 0) + quantity);
      return { token: settled, added: true };
    }

    const bind = new Binder(this.dialect);
    const sql = `INSERT INTO ${this.q('request_lines')}
        (${this.q('id')}, ${this.q('store_id')}, ${this.q('handle')},
         ${this.q('created_at')}, ${this.q('updated_at')}, ${this.q('version')},
         ${this.q('request_id')}, ${this.q('product_id')}, ${this.q('variant_id')},
         ${this.q('title')}, ${this.q('sku')}, ${this.q('quantity')},
         ${this.q('list_price_amount_minor')}, ${this.q('list_price_currency')},
         ${this.q('position')}, ${this.q('published_channels')})
      VALUES (${bind.add(`rln_${randomToken()}`)}, ${bind.add(this.storeId())},
              ${bind.add(randomToken())}, ${this.now()}, ${this.now()}, 1,
              ${bind.add(requestId)}, ${bind.add(String(variant.product_id ?? ''))},
              ${bind.add(variantId)}, ${bind.add(titleFor(variant))},
              ${bind.add((variant.sku as string | null) ?? '')}, ${bind.add(quantity)},
              ${bind.add(Number(variant.price_amount_minor ?? 0))},
              ${bind.add(String(variant.price_currency ?? 'USD'))},
              ${bind.add(await this.nextPosition(requestId))}, '[]')`;

    const statement = bind.finish(sql);
    await writer.execute(statement.sql, statement.parameters);
    await this.recountRequest(requestId);
    return { token: settled, added: true };
  }

  async setRequestLine(token: string, lineId: string, quantity: number): Promise<void> {
    const request = isRequestToken(token) ? await this.draftRow(token) : null;
    if (!request) return;

    const writer = writerFor(this.executor, 'changing a request line');
    const bind = new Binder(this.dialect);

    /**
     * Scoped to THIS request as well as to the store.
     *
     * A line id comes from a form. Without the request in the WHERE, one
     * visitor could set the quantity of a line in somebody else's cart — the
     * store scope alone does not stop that, because both carts belong to the
     * same store.
     */
    const sql = quantity <= 0
      ? `UPDATE ${this.q('request_lines')}
            SET ${this.q('deleted_at')} = ${this.now()}, ${this.q('updated_at')} = ${this.now()}
          WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
            AND ${this.q('request_id')} = ${bind.add(String(request.id))}
            AND ${this.q('id')} = ${bind.add(lineId)}`
      : `UPDATE ${this.q('request_lines')}
            SET ${this.q('quantity')} = ${bind.add(quantity)},
                ${this.q('updated_at')} = ${this.now()}
          WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
            AND ${this.q('request_id')} = ${bind.add(String(request.id))}
            AND ${this.q('id')} = ${bind.add(lineId)}`;

    const statement = bind.finish(sql);
    await writer.execute(statement.sql, statement.parameters);
    await this.recountRequest(String(request.id));
  }

  async clearRequest(token: string): Promise<void> {
    const request = isRequestToken(token) ? await this.draftRow(token) : null;
    if (!request) return;

    const writer = writerFor(this.executor, 'clearing a request');
    const bind = new Binder(this.dialect);
    const sql = `UPDATE ${this.q('request_lines')}
          SET ${this.q('deleted_at')} = ${this.now()}, ${this.q('updated_at')} = ${this.now()}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('request_id')} = ${bind.add(String(request.id))}
          AND ${this.q('deleted_at')} IS NULL`;
    const statement = bind.finish(sql);
    await writer.execute(statement.sql, statement.parameters);
    await this.recountRequest(String(request.id));
  }

  /** The draft row for a token, or null if there is not one. */
  private async draftRow(token: string): Promise<Row | null> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT * FROM ${this.q('requests')}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('handle')} = ${bind.add(token)}
          AND ${this.q('status')} = 'draft'
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`;
    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows[0] ?? null;
  }

  /** A variant, looked up inside this store so a forged id cannot cross stores. */
  private async variantForRequest(variantId: string): Promise<Row | null> {
    const bind = new Binder(this.dialect);
    /**
     * The product's title comes back with the variant.
     *
     * A variant has no title of its own — only `option_values` — so a line
     * built from the variant row alone would be a nameless entry in the cart.
     */
    const sql = `SELECT v.*, p.${this.q('title')} AS product_title,
                        p.${this.q('handle')} AS product_handle
             FROM ${this.q('product_variants')} v
             JOIN ${this.q('products')} p ON p.${this.q('id')} = v.${this.q('product_id')}
          WHERE v.${this.q('store_id')} = ${bind.add(this.storeId())}
            AND v.${this.q('id')} = ${bind.add(variantId)}
            AND v.${this.q('deleted_at')} IS NULL
            AND p.${this.q('status')} = 'active'
            AND p.${this.q('deleted_at')} IS NULL
          LIMIT 1`;
    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows[0] ?? null;
  }

  private async lineForVariant(requestId: string, variantId: string): Promise<Row | null> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT * FROM ${this.q('request_lines')}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('request_id')} = ${bind.add(requestId)}
          AND ${this.q('variant_id')} = ${bind.add(variantId)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`;
    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows[0] ?? null;
  }

  private async nextPosition(requestId: string): Promise<number> {
    const bind = new Binder(this.dialect);
    const sql = `SELECT COALESCE(MAX(${this.q('position')}), 0) + 1 AS n
        FROM ${this.q('request_lines')}
        WHERE ${this.q('store_id')} = ${bind.add(this.storeId())}
          AND ${this.q('request_id')} = ${bind.add(requestId)}`;
    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return Number(rows[0]?.n ?? 1);
  }

  /**
   * Keeps the stored counts honest after every change.
   *
   * Derived rather than incremented: an increment that runs twice, or not at
   * all, leaves a number nobody can explain and which a merchant sees in the
   * admin. Recomputing is one extra query on an action a shopper takes by hand.
   */
  private async recountRequest(requestId: string): Promise<void> {
    const writer = writerFor(this.executor, 'recounting a request');
    const bind = new Binder(this.dialect);
    const store = bind.add(this.storeId());
    const sql = `UPDATE ${this.q('requests')} r
        SET ${this.q('line_count')} = (
              SELECT COUNT(*) FROM ${this.q('request_lines')} l
               WHERE l.${this.q('request_id')} = r.${this.q('id')}
                 AND l.${this.q('deleted_at')} IS NULL),
            ${this.q('subtotal_amount_minor')} = (
              SELECT COALESCE(SUM(l.${this.q('quantity')} * l.${this.q('list_price_amount_minor')}), 0)
                FROM ${this.q('request_lines')} l
               WHERE l.${this.q('request_id')} = r.${this.q('id')}
                 AND l.${this.q('deleted_at')} IS NULL),
            ${this.q('updated_at')} = ${this.now()}
      WHERE r.${this.q('store_id')} = ${store}
        AND r.${this.q('id')} = ${bind.add(requestId)}`;
    const statement = bind.finish(sql);
    await writer.execute(statement.sql, statement.parameters);
  }

  /** One column's distinct values and how many products each would leave. */
  private async facetCounts(
    collection: CollectionRule,
    criteria: FilterCriteria,
    skip: FacetKind,
    expression: string,
  ): Promise<{ value: string; count: number }[]> {
    const bind = new Binder(this.dialect);
    const store = bind.add(this.storeId());
    const membership = this.membershipWhere(collection, bind);
    if (!membership) return [];

    const where = [...membership, ...this.criteriaWhere(criteria, bind, skip)];

    const sql = `SELECT ${expression} AS value, COUNT(*) AS n
         FROM ${this.q('products')} p
        WHERE p.${this.q('store_id')} = ${store}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
          ${where.map((clause) => `AND ${clause}`).join('\n          ')}
        GROUP BY ${expression}
        ORDER BY value ASC`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);

    // A product with no vendor is not a vendor called "".
    return rows
      .map((row) => ({ value: String(row.value ?? ''), count: Number(row.n ?? 0) }))
      .filter((entry) => entry.value !== '');
  }

  /** The same, for tags, which live one join away. */
  private async tagCounts(
    collection: CollectionRule,
    criteria: FilterCriteria,
  ): Promise<{ value: string; count: number }[]> {
    const bind = new Binder(this.dialect);
    const store = bind.add(this.storeId());
    const membership = this.membershipWhere(collection, bind);
    if (!membership) return [];

    const where = [...membership, ...this.criteriaWhere(criteria, bind, 'tag')];
    const tagStore = bind.add(this.storeId());

    const sql = `SELECT t.${this.q('tag')} AS value, COUNT(DISTINCT p.${this.q('id')}) AS n
         FROM ${this.q('products')} p
         JOIN ${this.q('products_tags')} t ON t.${this.q('owner_id')} = p.${this.q('id')}
        WHERE p.${this.q('store_id')} = ${store}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
          ${where.map((clause) => `AND ${clause}`).join('\n          ')}
          AND t.${this.q('store_id')} = ${tagStore}
        GROUP BY t.${this.q('tag')}
        ORDER BY t.${this.q('tag')} ASC`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    return rows.map((row) => ({ value: String(row.value ?? ''), count: Number(row.n ?? 0) }));
  }

  /** The cheapest and dearest product the other filters leave. */
  private async priceRange(
    collection: CollectionRule,
    criteria: FilterCriteria,
  ): Promise<{ min: number; max: number } | null> {
    const bind = new Binder(this.dialect);
    const store = bind.add(this.storeId());
    const membership = this.membershipWhere(collection, bind);
    if (!membership) return null;

    const where = [...membership, ...this.criteriaWhere(criteria, bind, 'price')];
    const column = `COALESCE(p.${this.q('price_amount_minor')}, 0)`;

    const sql = `SELECT MIN(${column}) AS low, MAX(${column}) AS high
         FROM ${this.q('products')} p
        WHERE p.${this.q('store_id')} = ${store}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
          ${where.map((clause) => `AND ${clause}`).join('\n          ')}`;

    const statement = bind.finish(sql);
    const rows = await this.executor.query<Row>(statement.sql, statement.parameters);
    const row = rows[0];
    if (!row || row.low === null || row.low === undefined) return null;
    return { min: Number(row.low), max: Number(row.high ?? row.low) };
  }

  /** The membership rule of one collection, read once and reused per request. */
  private async collectionRule(collectionId: string): Promise<CollectionRule | null> {
    /**
     * The automatic collection is every product, so it has no row to read and
     * no membership to apply — but it is still filtered and sorted like any
     * other. Handled here rather than short-circuited by its callers, which is
     * how it came to ignore filters entirely: `/collections/all?…tag=Sale`
     * returned the whole catalogue.
     */
    if (isAllProducts(collectionId)) {
      return {
        isAll: true, isManual: false, matchAny: false,
        productIds: [], conditions: [], exclusions: [],
      };
    }

    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('type')}, ${this.q('match')}, ${this.q('conditions')},
              ${this.q('exclusions')}, ${this.q('product_ids')}
         FROM ${this.q('collections')}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${this.q('id')} = ${this.p(2)}
          AND ${this.q('deleted_at')} IS NULL
        LIMIT 1`,
      [this.storeId(), collectionId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      isAll: false,
      isManual: String(row.type ?? 'manual') !== 'automated',
      matchAny: String(row.match ?? 'all') === 'any',
      productIds: parseIdList(row.product_ids),
      conditions: parseConditions(row.conditions),
      exclusions: parseConditions(row.exclusions),
    };
  }

  /**
   * The membership half of the WHERE, or null when the answer is "no products".
   *
   * Null rather than an empty array, because an empty array means "no
   * restriction" — and a membership predicate that is simply omitted returns
   * the entire catalogue under that collection's name, which is the worst
   * possible failure here.
   */
  private membershipWhere(collection: CollectionRule, bind: Binder): string[] | null {
    // No restriction at all, which is what "every product" means — and is
    // distinct from the null below, which means "no products".
    if (collection.isAll) return [];

    if (collection.isManual) {
      if (collection.productIds.length === 0) return null;
      const placeholders = collection.productIds.map((id) => bind.add(id)).join(', ');
      return [`p.${this.q('id')} IN (${placeholders})`];
    }

    // An automated collection with no conditions selects nothing. The domain
    // forbids saving one, so this is a row that predates the rule or was
    // written around it — and the whole catalogue is not a safe reading.
    if (collection.conditions.length === 0) return null;

    const joiner = collection.matchAny ? ' OR ' : ' AND ';
    const where = [
      `(${collection.conditions.map((c) => this.predicateFor(c, bind)).join(joiner)})`,
    ];

    // Exclusions always win, and each acts alone regardless of the match mode —
    // "any" applies to inclusion, not to whether an exclusion counts.
    for (const exclusion of collection.exclusions) {
      where.push(`NOT (${this.predicateFor(exclusion, bind)})`);
    }

    return where;
  }

  /**
   * The shopper's own narrowing, on top of whatever the collection holds.
   *
   * `skip` leaves one facet out, which is what makes the counts beside each
   * checkbox mean anything: "Blue (12)" has to be the number of products you
   * would see having ticked Blue, counted with every OTHER filter applied but
   * not with Blue itself — otherwise ticking one colour shows zero for all the
   * others and the filter looks broken.
   */
  private criteriaWhere(criteria: FilterCriteria, bind: Binder, skip?: FacetKind): string[] {
    const where: string[] = [];

    if (skip !== 'productType' && criteria.productTypes.length > 0) {
      const values = criteria.productTypes.map((value) => `LOWER(${bind.add(value)})`).join(', ');
      where.push(`LOWER(COALESCE(p.${this.q('product_type')}, '')) IN (${values})`);
    }

    if (skip !== 'vendor' && criteria.vendors.length > 0) {
      const values = criteria.vendors.map((value) => `LOWER(${bind.add(value)})`).join(', ');
      where.push(`LOWER(COALESCE(p.${this.q('vendor')}, '')) IN (${values})`);
    }

    if (skip !== 'tag' && criteria.tags.length > 0) {
      /**
       * Every tag, not any tag.
       *
       * Ticking two tags narrows; a shopper who wants both "waterproof" and
       * "lightweight" is not asking for everything that is either. One EXISTS
       * per tag is what expresses that.
       */
      for (const tag of criteria.tags) {
        where.push(`EXISTS (SELECT 1 FROM ${this.q('products_tags')} t
             WHERE t.${this.q('owner_id')} = p.${this.q('id')}
               AND t.${this.q('store_id')} = ${bind.add(this.storeId())}
               AND LOWER(t.${this.q('tag')}) = LOWER(${bind.add(tag)}))`);
      }
    }

    if (skip !== 'price') {
      // Inclusive, because a slider labelled "up to 50" that excludes 50 is a
      // slider a shopper will report as broken.
      if (criteria.priceMin !== null) {
        where.push(`COALESCE(p.${this.q('price_amount_minor')}, 0) >= ${bind.add(criteria.priceMin)}`);
      }
      if (criteria.priceMax !== null) {
        where.push(`COALESCE(p.${this.q('price_amount_minor')}, 0) <= ${bind.add(criteria.priceMax)}`);
      }
    }

    return where;
  }

  /**
   * A validated sort key as an ORDER BY.
   *
   * The key is already narrowed to a known value by `parseSort` in the domain,
   * so nothing from the query string reaches this string — but the mapping is
   * a lookup rather than interpolation anyway, so that stays true if the
   * caller ever changes.
   *
   * The id is always the last term. Two products with the same title or the
   * same price otherwise swap places between one page and the next, which
   * shows a shopper the same product twice and hides another entirely.
   */
  private orderBy(sort: string): string {
    const id = `p.${this.q('id')} DESC`;
    switch (sort) {
      case 'title-ascending': return `p.${this.q('title')} ASC, ${id}`;
      case 'title-descending': return `p.${this.q('title')} DESC, ${id}`;
      case 'price-ascending': return `COALESCE(p.${this.q('price_amount_minor')}, 0) ASC, ${id}`;
      case 'price-descending': return `COALESCE(p.${this.q('price_amount_minor')}, 0) DESC, ${id}`;
      case 'created-ascending': return `p.${this.q('created_at')} ASC, ${id}`;
      // Nothing records units sold yet, so "best selling" would be a made-up
      // order presented as a real one. Newest first until orders can answer it.
      case 'best-selling':
      case 'created-descending':
      default: return `p.${this.q('created_at')} DESC, ${id}`;
    }
  }

  /**
   * One condition, as SQL.
   *
   * Mirrors `matchesCondition` in the catalog domain field by field. Where that
   * function falls through to `false` — "price starts with", "title greater
   * than" — this produces a predicate that is never true, rather than throwing
   * or quietly dropping the condition. A dropped condition would widen the
   * collection, which is the direction that leaks products a merchant meant to
   * keep out.
   */
  private predicateFor(condition: Condition, bind: Binder): string {
    const { field, operator, value } = condition;

    // Tags are a set, so "contains" asks whether the set holds the tag — not
    // whether some concatenation of the tags contains the text.
    if (field === 'tag') {
      // Decided before anything is bound, for the reason given below.
      const holds = operator === 'equals' || operator === 'contains';
      const lacks = operator === 'notEquals' || operator === 'notContains';
      if (!holds && !lacks) return NEVER;

      const exists = `EXISTS (SELECT 1 FROM ${this.q('products_tags')} t
             WHERE t.${this.q('owner_id')} = p.${this.q('id')}
               AND t.${this.q('store_id')} = ${bind.add(this.storeId())}
               AND LOWER(t.${this.q('tag')}) = LOWER(${bind.add(value)}))`;

      return holds ? exists : `NOT ${exists}`;
    }

    const numeric = NUMERIC_COLUMNS[field];
    if (numeric) {
      const expected = Number(value);
      // `Number('abc')` is NaN, which loses every comparison in JavaScript. SQL
      // would compare against NULL and lose them all too, but only by accident
      // — this says so.
      if (!Number.isFinite(expected)) return NEVER;

      // A null compare-at price reads as zero, exactly as the domain's
      // `valueFor` does, so "compare-at price less than 100" includes the
      // products that have no compare-at price at all.
      const column = `COALESCE(p.${this.q(numeric)}, 0)`;

      /**
       * Checked BEFORE the value is bound.
       *
       * Binding first and then returning `NEVER` leaves a value in the binder
       * that no placeholder will ever consume, and `finish` refuses the
       * statement — so one nonsensical condition took down the whole
       * collection rather than matching nothing.
       */
      const comparison = NUMERIC_OPERATORS[operator];
      if (!comparison) return NEVER;
      return `${column} ${comparison} ${bind.add(expected)}`;
    }

    const column = `LOWER(COALESCE(p.${this.q(TEXT_COLUMNS[field]!)}, ''))`;
    const escaped = escapeLike(value.toLowerCase());
    switch (operator) {
      case 'equals': return `${column} = LOWER(${bind.add(value)})`;
      case 'notEquals': return `${column} <> LOWER(${bind.add(value)})`;
      case 'contains': return `${column} LIKE ${bind.add(`%${escaped}%`)}`;
      case 'notContains': return `${column} NOT LIKE ${bind.add(`%${escaped}%`)}`;
      case 'startsWith': return `${column} LIKE ${bind.add(`${escaped}%`)}`;
      case 'endsWith': return `${column} LIKE ${bind.add(`%${escaped}`)}`;
      default: return NEVER;
    }
  }

  image(imageId: string): ImageRow | null {
    return this.executor.query<Row>(
      `SELECT * FROM ${this.q('product_images')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('id')} = ${this.p(2)} LIMIT 1`,
      [this.storeId(), imageId],
    ).then((rows) => (rows[0] ? toImage(rows[0]) : null)) as unknown as ImageRow | null;
  }

  async redirects(): Promise<readonly RedirectRule[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('path')}, ${this.q('target')} FROM ${this.q('url_redirects')}
        WHERE ${this.q('store_id')} = ${this.p(1)} AND ${this.q('deleted_at')} IS NULL`,
      [this.storeId()],
    );
    return rows.map((row) => ({ from: String(row.path), to: String(row.target) }));
  }

  async sitemapEntries(kind: string): Promise<readonly SitemapEntry[]> {
    const shop = await this.shop();
    const origin = `https://${shop.domain}`;

    /**
     * One query per kind rather than a union.
     *
     * The sitemap is fetched by crawlers a handful of times a day, so clarity
     * beats cleverness — and each kind has a different published condition,
     * which a union would have to carry in a CASE nobody could read.
     */
    switch (kind) {
      case 'product':
        return this.urlsFrom('products', `/products/`, origin, `${this.q('status')} = 'active'`, 0.8);
      case 'collection':
        return this.urlsFrom('collections', `/collections/`, origin, '1=1', 0.8);
      case 'page':
        return this.urlsFrom('pages', `/pages/`, origin, `${this.q('status')} = 'published'`, 0.5);
      case 'index':
        return [{ loc: `${origin}/`, priority: 1.0, changefreq: 'daily' }];
      default:
        return [];
    }
  }

  private async urlsFrom(
    table: string,
    prefix: string,
    origin: string,
    published: string,
    priority: number,
  ): Promise<readonly SitemapEntry[]> {
    const rows = await this.executor.query<Row>(
      `SELECT ${this.q('handle')}, ${this.q('updated_at')} FROM ${this.q(table)}
        WHERE ${this.q('store_id')} = ${this.p(1)}
          AND ${published}
          AND ${this.q('deleted_at')} IS NULL
        ORDER BY ${this.q('updated_at')} DESC
        LIMIT 50000`,
      [this.storeId()],
    );

    return rows.map((row) => ({
      loc: `${origin}${prefix}${String(row.handle)}`,
      lastmod: row.updated_at as string | null,
      priority,
    }));
  }
}

function toProduct(row: Row): ProductRow {
  return {
    unitQuantityValue: (row.unit_quantity_value as number | string | null) ?? null,
    unitQuantityUnit: (row.unit_quantity_unit as string | null) ?? null,
    unitReferenceValue: (row.unit_reference_value as number | string | null) ?? null,
    unitReferenceUnit: (row.unit_reference_unit as string | null) ?? null,
    id: String(row.id),
    handle: String(row.handle),
    title: String(row.title),
    description: row.description as string | null,
    status: row.status as string,
    vendor: row.vendor as string | null,
    productType: row.product_type as string | null,
    sku: row.sku as string | null,
    // `price_amount_minor` / `price_currency` is what the entity toolkit emits
    // for a money field. Reading `price_amount` returned undefined and every
    // price rendered as nothing, with no error anywhere.
    priceAmountMinor: row.price_amount_minor as string | null,
    compareAtPriceAmountMinor: row.compare_at_price_amount_minor as string | null,
    inventoryQuantity: row.inventory_quantity as number | null,
    optionNames: parseJson<string[]>(row.option_names) ?? [],
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
    publishedAt: row.published_at as string | null,
  };
}

/**
 * One blog post row, as the drops read it.
 *
 * Shared by the by-handle lookup, a blog's index and search, which mapped this
 * three separate ways — and search's copy omitted `blogId`, so the articles it
 * found could not build their own URLs.
 */
function toArticle(row: Row): ArticleRow {
  return {
    id: String(row.id),
    blogId: String(row.blog_id ?? ''),
    handle: String(row.handle),
    title: String(row.title),
    body: row.body as string | null,
    excerpt: row.excerpt as string | null,
    author: row.author as string | null,
    createdAt: row.created_at as string | null,
    publishedAt: row.published_at as string | null,
    updatedAt: row.updated_at as string | null,
  };
}

function toVariant(row: Row): VariantRow {
  return {
    unitQuantityValue: (row.unit_quantity_value as number | string | null) ?? null,
    unitQuantityUnit: (row.unit_quantity_unit as string | null) ?? null,
    unitReferenceValue: (row.unit_reference_value as number | string | null) ?? null,
    unitReferenceUnit: (row.unit_reference_unit as string | null) ?? null,
    id: String(row.id),
    productId: String(row.product_id),
    title: row.title as string | null,
    sku: row.sku as string | null,
    // `price_amount_minor` / `price_currency` is what the entity toolkit emits
    // for a money field. Reading `price_amount` returned undefined and every
    // price rendered as nothing, with no error anywhere.
    priceAmountMinor: row.price_amount_minor as string | null,
    compareAtPriceAmountMinor: row.compare_at_price_amount_minor as string | null,
    optionValues: parseJson<string[]>(row.option_values) ?? [],
    inventoryQuantity: row.inventory_quantity as number | null,
    barcode: row.barcode as string | null,
    imageId: row.image_id as string | null,
  };
}

function toImage(row: Row): ImageRow {
  return {
    id: String(row.id),
    src: String(row.src),
    width: row.width as number | null,
    height: row.height as number | null,
    alt: row.alt as string | null,
    position: row.position as number | null,
  };
}

/**
 * A collection's membership rule, as the catalog module writes it.
 *
 * Declared here rather than imported from `modules/catalog`, which a module may
 * only reach through its contracts. Widening those contracts to export the
 * matcher would not help: this needs the rule as SQL, not as a predicate over
 * products already in memory.
 */
interface Condition {
  readonly field: string;
  readonly operator: string;
  readonly value: string;
}

/** A collection's membership rule, parsed once from its row. */
interface CollectionRule {
  /** The automatic "all products" collection, which has no row and no rule. */
  readonly isAll: boolean;
  readonly isManual: boolean;
  readonly matchAny: boolean;
  readonly productIds: readonly string[];
  readonly conditions: readonly Condition[];
  readonly exclusions: readonly Condition[];
}

/** Which facet a query is counting, so it can leave that one out. */
type FacetKind = 'productType' | 'vendor' | 'tag' | 'price';

/** A predicate that is never true, for a condition the field cannot answer. */
const NEVER = '1 = 0';

const TEXT_COLUMNS: Record<string, string | undefined> = {
  title: 'title',
  handle: 'handle',
  type: 'product_type',
  vendor: 'vendor',
};

/** The comparisons a number can answer. Anything else matches nothing. */
const NUMERIC_OPERATORS: Record<string, string | undefined> = {
  equals: '=',
  notEquals: '<>',
  greaterThan: '>',
  lessThan: '<',
};

const NUMERIC_COLUMNS: Record<string, string | undefined> = {
  price: 'price_amount_minor',
  compareAtPrice: 'compare_at_price_amount_minor',
  inventoryQuantity: 'inventory_quantity',
};

/**
 * Wildcards in a merchant's own condition value, made literal.
 *
 * A rule saying the title contains "50%" means those characters. Unescaped, the
 * `%` matches the rest of the title and the collection quietly swallows
 * products the merchant never chose.
 */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (character) => `\\${character}`);
}

/**
 * Where each kind of record keeps its metafields.
 *
 * A closed table rather than `${ownerEntity}_metafields` built by hand: the
 * owner kind reaches this from a drop, and interpolating it into a table name
 * would make it a way to name any table in the database.
 */
const METAFIELD_TABLES: Record<string, string | undefined> = {
  Product: 'products_metafields',
  ProductVariant: 'product_variants_metafields',
  Collection: 'collections_metafields',
  Page: 'pages_metafields',
  Blog: 'blogs_metafields',
  Article: 'blog_posts_metafields',
};

/**
 * A stored metafield value, typed as its definition says.
 *
 * JSON types are parsed so a theme can walk them — the reference behaviour is
 * that `metafield.value` of a json type yields an object a template can index
 * into. Everything else stays the string it was stored as; guessing a number
 * out of a text field would change what a merchant typed.
 */
function metafieldValue(raw: unknown, valueType: string): unknown {
  if (raw === null || raw === undefined) return null;
  if (!valueType.startsWith('json') && !valueType.startsWith('list.')) return String(raw);
  const parsed = parseJson<unknown>(raw);
  return parsed ?? String(raw);
}

function toPolicy(row: Row): PolicyRow {
  return {
    id: String(row.id),
    policyType: String(row.policy_type ?? ''),
    handle: String(row.handle),
    title: String(row.title),
    body: (row.body as string | null) ?? null,
  };
}

/** A JSON array column as strings, ignoring anything that is not one. */
function parseStringList(value: unknown): string[] {
  const parsed = parseJson<unknown[]>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

/** The ids of a manual collection, ignoring anything that is not one. */
function parseIdList(value: unknown): string[] {
  const parsed = parseJson<unknown[]>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

/**
 * The conditions of an automated collection.
 *
 * A malformed entry is dropped rather than guessed at, and the caller treats
 * "no conditions" as "no products" — so a corrupt rule empties a collection
 * instead of publishing the whole catalogue under its name.
 */
function parseConditions(value: unknown): Condition[] {
  const parsed = parseJson<unknown[]>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { field, operator, value: expected } = entry as Record<string, unknown>;
    if (typeof field !== 'string' || typeof operator !== 'string') return [];
    return [{ field, operator, value: String(expected ?? '') }];
  });
}

/**
 * What a cart line is called.
 *
 * The product's title, with the variant's own options after it when there is
 * more than the implicit single variant — "Linen Shirt · Medium". A variant
 * carries no title of its own, so building the line from the variant row alone
 * produces a nameless entry.
 */
function titleFor(variant: Row): string {
  const product = String(variant.product_title ?? '');
  const options = parseJson<unknown[]>(variant.option_values);
  if (!Array.isArray(options) || options.length === 0) return product;
  const labels = options.map((value) => String(value ?? '').trim()).filter(Boolean);
  return labels.length > 0 ? `${product} · ${labels.join(' / ')}` : product;
}

/**
 * An unguessable name for a draft request.
 *
 * This is the value that ends up in a cookie and is the only thing standing
 * between one shopper's list and another's, so it comes from the platform's
 * random source rather than from a counter or a timestamp.
 */
function randomToken(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * What a merchant sees instead of the token.
 *
 * The token must never be shown: it is a session secret, and a merchant
 * reading it out of an admin screen could open somebody's cart. This is a
 * short, stable label derived from it for display only.
 */
function referenceFor(token: string): string {
  return `R-${token.slice(0, 8).toUpperCase()}`;
}

/** JSON columns arrive as a string on some drivers and parsed on others. */
function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
