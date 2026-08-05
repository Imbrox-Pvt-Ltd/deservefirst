/**
 * Storefront · engine/context.ts
 * What a filter is allowed to know about the platform.
 *
 * Storefront filters are not pure. `asset_url` needs to know where this theme's
 * files live, `t` needs the locale and the theme's translations, `money` needs
 * the store's currency and its chosen format. So they close over a context —
 * and this file is the whole of what that context contains.
 *
 * Keeping it explicit is the point. The alternative is filters reaching for
 * services, which would put a database call behind `{{ price | money }}` and
 * make a template a thing that can fail for reasons a theme author cannot see.
 * Everything here is data, resolved before rendering starts.
 * Layer: engine.
 */

import type { CurrencyCode } from '@deservefirst/contracts';

export interface MoneyFormats {
  /**
   * The store's money formats, in the reference product's template syntax.
   *
   * `{{amount}}`, `{{amount_with_comma_separator}}`, `{{amount_no_decimals}}`
   * and friends. Kept as the merchant's string rather than parsed into options,
   * because a merchant who has tuned their format expects it back exactly.
   */
  readonly money: string;
  readonly moneyWithCurrency: string;
}

export interface RenderContext {
  /** Where `asset_url` points — the theme's own files. */
  readonly assetBaseUrl: string;
  /** Where uploaded images live, for `image_url` and friends. */
  readonly cdnBaseUrl: string;
  /** Platform-owned assets, for `shopify_asset_url`'s equivalent. */
  readonly platformAssetBaseUrl: string;

  readonly currency: CurrencyCode;
  readonly moneyFormats: MoneyFormats;

  readonly locale: string;
  /**
   * The theme's own translations for this locale, already flattened to
   * `general.search.title` keys.
   *
   * Flattened here rather than in `t`, so a missing key is a lookup that
   * returns nothing rather than a walk that throws halfway down an object.
   */
  readonly translations: Readonly<Record<string, string>>;

  /** Reads the raw bytes of a theme file, for `inline_asset_content`. */
  readonly readAsset?: (path: string) => string | null;

  /** The routes a theme links to, exposed to it as `routes.*`. */
  readonly routes: Readonly<Record<string, string>>;
}

/**
 * A context for tests and for rendering with nothing configured.
 *
 * Real values everywhere rather than empty strings: a filter that silently
 * produces `//image.png` because a base URL was blank is harder to notice than
 * one producing an obviously fake host.
 */
export function defaultContext(over: Partial<RenderContext> = {}): RenderContext {
  return {
    assetBaseUrl: 'https://cdn.deservefirst.test/assets',
    cdnBaseUrl: 'https://cdn.deservefirst.test/files',
    platformAssetBaseUrl: 'https://cdn.deservefirst.test/platform',
    currency: 'USD' as CurrencyCode,
    moneyFormats: {
      money: '${{amount}}',
      moneyWithCurrency: '${{amount}} USD',
    },
    locale: 'en',
    translations: {},
    routes: {
      root_url: '/',
      cart_url: '/cart',
      search_url: '/search',
      all_products_collection_url: '/collections/all',
      account_url: '/account',
      account_login_url: '/account/login',
      account_logout_url: '/account/logout',
      account_register_url: '/account/register',
    },
    ...over,
  };
}
