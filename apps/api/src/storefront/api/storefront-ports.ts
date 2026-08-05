/**
 * Storefront · api/storefront-ports.ts
 * What the storefront needs from the rest of the platform.
 *
 * Ports rather than imports, for one reason that matters more than tidiness:
 * every method here is called on behalf of an anonymous visitor, so every one
 * must already be scoped to a single store and to published records. Naming
 * them in an interface makes that a contract somebody signs rather than a
 * property four repositories happen to have.
 *
 * `StoreResolver` is the tenant boundary itself. It turns a Host header — which
 * is attacker-controlled — into a store, and everything downstream inherits
 * that decision. Nothing else in the request may widen it.
 * Layer: api.
 */

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
  ThemeSource,
  VariantRow,
} from '../domain';

/**
 * Everything one storefront request may read.
 *
 * Every method is implicitly "…for this store, and published only". A visitor
 * is anonymous: there is no permission to check, which means there is no second
 * line of defence if an implementation forgets.
 */
export interface StorefrontData {
  shop(): Promise<ShopRow>;
  /** Theme settings from `config/settings_data.json`, already resolved. */
  settings(): Promise<Record<string, unknown>>;

  productByHandle(handle: string): Promise<ProductRow | null>;
  collectionByHandle(handle: string): Promise<CollectionRow | null>;
  pageByHandle(handle: string): Promise<PageRow | null>;
  blogByHandle(handle: string): Promise<BlogRow | null>;
  articleByHandle(blogHandle: string, handle: string): Promise<ArticleRow | null>;

  /** Relations, for the drop loaders. Synchronous: they run inside a render. */
  variantsOfProduct(productId: string): readonly VariantRow[];
  imagesOfProduct(productId: string): readonly ImageRow[];
  productsOfCollection(collectionId: string): readonly ProductRow[];
  productCountOfCollection(collectionId: string): number;
  image(imageId: string): ImageRow | null;

  redirects(): Promise<readonly RedirectRule[]>;
  /** URLs for the sitemap, by kind. */
  sitemapEntries(kind: string): Promise<readonly SitemapEntry[]>;
}

export interface ResolvedStore {
  readonly storeId: string;
  /** The theme currently published. */
  readonly theme: ThemeSource & { manifest(): Promise<ReadonlySet<string>> };
  readonly data: StorefrontData;
  /** Absent for a store that cannot yet take submissions. */
  readonly submissions?: StorefrontSubmissions;
  /**
   * A store not yet open. Renders the password page and disallows crawling.
   */
  readonly closed?: boolean;
}

/**
 * Turns a hostname into a store.
 *
 * The Host header is attacker-controlled, so an implementation must look the
 * value up rather than derive a store id from it by string surgery — a
 * subdomain parsed out of the header and trusted is a tenant boundary made of
 * string manipulation.
 *
 * Returns null for a host this platform does not serve, which the transport
 * answers with a 404 rather than with any store's content.
 */
export interface StoreResolver {
  resolve(host: string): Promise<ResolvedStore | null>;
}

/**
 * What a storefront form submission does once it has been admitted.
 *
 * A port, because the storefront must not reach into the orders or customers
 * modules directly (§14.1) — and because "what happens to an enquiry" is a
 * decision that belongs to whoever owns enquiries, not to the transport that
 * received one.
 */
export interface StorefrontSubmissions {
  /**
   * Records a quote request. Phase-1 commerce is request-only (D10), so this is
   * the storefront's conversion action.
   */
  requestQuote(input: {
    readonly contactEmail: string;
    readonly contactName: string | null;
    readonly message: string | null;
    readonly productId: string | null;
    readonly quantity: number;
  }): Promise<{ readonly reference: string }>;

  /** Records a contact-form message. */
  contact(input: {
    readonly email: string;
    readonly name: string | null;
    readonly body: string;
  }): Promise<void>;
}
