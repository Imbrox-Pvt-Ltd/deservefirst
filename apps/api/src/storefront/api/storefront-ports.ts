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
  CartRow,
  CollectionRow,
  FilterCriteria,
  FilterRow,
  ImageRow,
  PageRow,
  ProductRow,
  RedirectRule,
  SearchResults,
  ShopRow,
  SitemapEntry,
  StoreAvailabilityRow,
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

  /**
   * The posts of one blog, newest first.
   *
   * Without this a blog's index page rendered its title, its layout and no
   * posts at all — the drop asked for a loader nobody had written.
   */
  articlesOfBlog(blogId: string): readonly ArticleRow[];
  articleCountOfBlog(blogId: string): number;

  /**
   * The blog a post belongs to.
   *
   * An article's URL is built from its blog's handle, so without this every
   * link to a post fell back to `/articles/<handle>` — a route that does not
   * exist. Search results and blog listings pointed at a 404.
   */
  blogOfArticle(blogId: string): BlogRow | null;

  /**
   * The posts either side of this one, for an article's prev/next links.
   *
   * One call rather than two, because they come from the same ordered list and
   * two queries could disagree if a post were published between them.
   */
  adjacentArticles(
    blogId: string,
    articleId: string,
  ): Promise<{ previous: ArticleRow | null; next: ArticleRow | null }>;

  /** Every tag used by a blog's posts, for its tag filter. */
  tagsOfBlog(blogId: string): readonly string[];
  imagesOfProduct(productId: string): readonly ImageRow[];
  /**
   * A collection's products, narrowed and ordered by the shopper.
   *
   * The criteria and the sort are optional so every other caller — a section
   * rendering a featured collection, a sitemap — keeps the merchant's own view
   * of the collection rather than one visitor's filtered slice of it.
   */
  productsOfCollection(
    collectionId: string,
    criteria?: FilterCriteria,
    sort?: string,
  ): readonly ProductRow[];

  /**
   * How much of a catalogue there is, for the shop object.
   *
   * Published only, because these are read by anonymous visitors — a count
   * that includes drafts tells a shopper how many products they cannot see.
   */
  productCount(): number;
  collectionCount(): number;

  /**
   * Every product type and vendor in the store, for a theme's own navigation.
   *
   * Distinct values rather than counts: themes render these as links to a
   * filtered view, and the count belongs to the facet that view builds.
   */
  productTypes(): readonly string[];
  productVendors(): readonly string[];

  /** Which collections hold this product, for a theme's breadcrumbs. */
  collectionsOfProduct(productId: string): readonly CollectionRow[];

  /** The same, narrowed to one collection. */
  productTypesOfCollection(collectionId: string): readonly string[];
  productVendorsOfCollection(collectionId: string): readonly string[];

  /**
   * The draft request this visitor is building — what a theme calls the cart.
   *
   * Phase 1 sells nothing (§25): a shopper assembles a Request/RFQ and the
   * merchant answers it. Returns an empty one rather than null, because every
   * page renders `cart.item_count` and a missing cart is a broken header.
   */
  draftRequest(token: string | null): Promise<CartRow>;

  /**
   * Adds to the draft, creating it if this is the first thing added.
   *
   * Returns the token, which the caller sets as a cookie — the row cannot be
   * found again otherwise, and creating one per request would give every
   * shopper a new empty cart on every page.
   */
  addToRequest(
    token: string | null,
    variantId: string,
    quantity: number,
  ): Promise<{ token: string; added: boolean }>;

  /** Sets one line's quantity; zero removes it. */
  setRequestLine(token: string, lineId: string, quantity: number): Promise<void>;

  /** Empties the draft without deleting it, so the token stays valid. */
  clearRequest(token: string): Promise<void>;

  /** The filters this collection offers, with counts for the current selection. */
  facetsOfCollection(
    collectionId: string,
    criteria: FilterCriteria,
  ): Promise<readonly FilterRow[]>;
  productCountOfCollection(collectionId: string, criteria?: FilterCriteria): number;
  image(imageId: string): ImageRow | null;

  /**
   * Products worth showing beside this one.
   *
   * Async and by id, unlike the relation loaders above, because this is not a
   * relation — nothing links these rows together. It is a query with an
   * opinion, and the opinion will change: the first one is "same type, then
   * same vendor", and a better one later must not require every caller to
   * learn a new shape.
   */
  recommendedProducts(productId: string, limit: number): Promise<readonly ProductRow[]>;

  /**
   * Where one variant can be collected.
   *
   * Synchronous by signature like the other relation loaders, because a drop
   * reads it during a render — see `syncOf` in the handler.
   */
  availabilitiesOfVariant(variantId: string): readonly StoreAvailabilityRow[];

  /**
   * What a shopper typing this is probably looking for.
   *
   * One call for every kind of result, because a search box fetches once per
   * keystroke and five round trips per letter is not a search box.
   */
  search(terms: string, limit: number): Promise<SearchResults>;

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
  /**
   * The published version of the theme being served.
   *
   * Travels with the resolution so `asset_url` can put it in every asset URL —
   * which is what lets those responses be cached for a year instead of five
   * minutes, because publishing a change produces different URLs.
   */
  readonly themeVersion?: string | null;
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
