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

import type { QueryExecutor } from '../../core/list-engine';
import { Binder } from '../../core/database/bind';
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import { allProductsCollection, isAllProducts } from '../domain';
import type { StorefrontData } from '../api/storefront-ports';
import type {
  ArticleRow,
  BlogRow,
  CollectionRow,
  ImageRow,
  PageRow,
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
    return row
      ? {
          id: String(row.id),
          blogId: String(row.blog_id),
          handle: String(row.handle),
          title: String(row.title),
          body: row.body as string | null,
          excerpt: row.excerpt as string | null,
          author: row.author as string | null,
          publishedAt: row.published_at as string | null,
          updatedAt: row.updated_at as string | null,
        }
      : null;
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

    const articles = find('blog_posts', ['title', 'handle'], `AND ${this.q('status')} = 'published'`, (row) => ({
      id: String(row.id),
      handle: String(row.handle),
      title: String(row.title),
      body: (row.body as string | null) ?? null,
      excerpt: (row.excerpt as string | null) ?? null,
      author: (row.author as string | null) ?? null,
      publishedAt: (row.published_at as string | null) ?? null,
      // The blog it belongs to, which the article's URL is built from.
      blogId: String(row.blog_id ?? ''),
    }));

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

  productsOfCollection(collectionId: string): readonly ProductRow[] {
    /**
     * The automatic collection is the whole catalogue, so there is no join.
     *
     * Its id is the handle rather than a row's, because there is no row — see
     * `domain/all-products.ts`.
     */
    if (isAllProducts(collectionId)) {
      return this.executor.query<Row>(
        `SELECT * FROM ${this.q('products')}
          WHERE ${this.q('store_id')} = ${this.p(1)}
            AND ${this.q('status')} = 'active'
            AND ${this.q('deleted_at')} IS NULL
          ORDER BY ${this.q('created_at')} DESC
          LIMIT 250`,
        [this.storeId()],
      ).then((rows) => rows.map(toProduct)) as unknown as readonly ProductRow[];
    }

    return this.executor.query<Row>(
      `SELECT p.* FROM ${this.q('products')} p
         JOIN ${this.q('collection_products')} cp ON cp.${this.q('product_id')} = p.${this.q('id')}
        WHERE p.${this.q('store_id')} = ${this.p(1)}
          AND cp.${this.q('collection_id')} = ${this.p(2)}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL
        ORDER BY cp.${this.q('position')} ASC
        LIMIT 250`,
      [this.storeId(), collectionId],
    ).then((rows) => rows.map(toProduct)) as unknown as readonly ProductRow[];
  }

  productCountOfCollection(collectionId: string): number {
    if (isAllProducts(collectionId)) {
      return this.executor.query<Row>(
        `SELECT COUNT(*) AS n FROM ${this.q('products')}
          WHERE ${this.q('store_id')} = ${this.p(1)}
            AND ${this.q('status')} = 'active'
            AND ${this.q('deleted_at')} IS NULL`,
        [this.storeId()],
      ).then((rows) => Number(rows[0]?.n ?? 0)) as unknown as number;
    }

    return this.executor.query<Row>(
      `SELECT COUNT(*) AS n FROM ${this.q('collection_products')} cp
         JOIN ${this.q('products')} p ON p.${this.q('id')} = cp.${this.q('product_id')}
        WHERE p.${this.q('store_id')} = ${this.p(1)}
          AND cp.${this.q('collection_id')} = ${this.p(2)}
          AND p.${this.q('status')} = 'active'
          AND p.${this.q('deleted_at')} IS NULL`,
      [this.storeId(), collectionId],
    ).then((rows) => Number(rows[0]?.n ?? 0)) as unknown as number;
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

function toVariant(row: Row): VariantRow {
  return {
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
