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
  /**
   * The hostname this store canonically lives at, once one is verified.
   *
   * Carried on the resolution because the transport needs it before it renders
   * anything: a request arriving on any other hostname is redirected here, so
   * that one page has one URL. Null while a store has connected nothing, which
   * is when its platform subdomain IS the canonical name.
   */
  readonly primaryHost?: string | null;
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

/**
 * Where rendered pages are kept between requests.
 *
 * A port rather than a concrete cache, because the two implementations differ
 * in the property that matters: an in-process map is correct on one node and
 * wrong on four, since a publish on the node that received it leaves the other
 * three serving the old theme. A shared cache fixes that and is the production
 * answer; this interface is what lets the second one arrive without the
 * storefront noticing.
 */
export interface PageCache {
  get(key: string): Promise<CachedPage | null>;
  set(key: string, page: CachedPage): Promise<void>;
  /** Retires everything for one store. */
  invalidateStore(storeId: string): Promise<void>;
  /** The store's current generation, which is part of every key. */
  epochFor(storeId: string): number;
  stats(): { entries: number; bytes: number; hits: number; misses: number };
}

export interface CachedPage {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Body and headers with the nonce already swapped for the placeholder. */
  readonly body: string;
  /**
   * The random marker standing in for the nonce, or null when there was none.
   *
   * Stored WITH the entry rather than fixed in code, and never sent to a
   * browser — see `domain/page-cache.ts` for why a predictable marker would let
   * injected markup borrow a live nonce.
   */
  readonly noncePlaceholder: string | null;
  readonly expiresAt: number;
}
