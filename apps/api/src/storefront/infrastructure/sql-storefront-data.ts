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
import { postgresDialect, type SqlDialect } from '../../core/list-engine/dialect';
import { requireStoreContext } from '../../core/tenant-context';
import type { StorefrontData } from '../api/storefront-ports';
import type {
  ArticleRow,
  BlogRow,
  CollectionRow,
  ImageRow,
  PageRow,
  ProductRow,
  RedirectRule,
  ShopRow,
  SitemapEntry,
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

  productsOfCollection(collectionId: string): readonly ProductRow[] {
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
