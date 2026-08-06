# Storefront objects

Every object a theme can address, generated from the drops that define them.
Run `platform storefront:objects --write` after changing a drop; CI checks that
the committed copy still matches.

A property listed as **pending** is declared and answers with an honest empty
value — an empty list, a null, a false — but is not yet backed by real data. In
Liquid an empty answer and a missing one render identically, so this table is
the only place that difference is visible.

## `address`

15 implemented, 0 pending.

`id`, `first_name`, `last_name`, `name`, `company`, `address1`, `address2`, `street`, `city`, `province`, `province_code`, `country`, `country_code`, `zip`, `phone`

## `article`

19 implemented, 0 pending.

`object_type`, `user`, `id`, `handle`, `title`, `content`, `excerpt`, `excerpt_or_content`, `author`, `tags`, `image`, `comments`, `comments_count`, `comments_enabled`, `url`, `created_at`, `published_at`, `updated_at`, `summary`

## `block`

6 implemented, 0 pending.

`id`, `type`, `settings`, `index`, `index0`, `editor_attributes`

Also answers to, for themes written elsewhere:

- `block.shopify_attributes` → `block.editor_attributes`

## `blog`

11 implemented, 0 pending.

`id`, `handle`, `title`, `url`, `comments_enabled`, `moderated`, `articles`, `articles_count`, `previous_article`, `next_article`, `all_tags`

## `cart`

11 implemented, 3 pending.

`items`, `item_count`, `total_price`, `original_total_price`, `total_weight`, `currency`, `empty`, `note`, `attributes`, `requires_shipping`, `cart_level_discount_applications`

| Pending | Why |
| --- | --- |
| `discount_applications` | Discounts are Phase 3 (§25), so nothing has been applied to this cart. |
| `duties_included` | No duty is calculated in Phase 1 (§25). |
| `taxes_included` | No tax engine in Phase 1 (§25), so no price here has had tax applied to it. |

## `collection`

16 implemented, 0 pending.

`object_type`, `id`, `handle`, `title`, `description`, `url`, `updated_at`, `image`, `products`, `products_count`, `all_types`, `all_vendors`, `filters`, `sort_by`, `default_sort_by`, `sort_options`

## `comment`

5 implemented, 0 pending.

`id`, `author`, `content`, `status`, `created_at`

## `country`

4 implemented, 0 pending.

`iso_code`, `name`, `currency`, `available`

## `currency`

3 implemented, 0 pending.

`iso_code`, `name`, `symbol`

## `customer`

15 implemented, 0 pending.

`id`, `first_name`, `last_name`, `name`, `email`, `phone`, `accepts_marketing`, `tax_exempt`, `orders_count`, `total_spent`, `default_address`, `addresses`, `addresses_count`, `orders`, `tags`

## `discount_application`

5 implemented, 0 pending.

`title`, `target_type`, `value_type`, `value`, `total_allocated_amount`

## `facets`

5 implemented, 0 pending.

`filters`, `sort_options`, `sort_by`, `filtered`, `url_to_clear`

## `filter`

11 implemented, 0 pending.

`label`, `param_name`, `type`, `values`, `active_values`, `url_to_remove`, `min_value`, `max_value`, `range_min`, `range_max`, `presentation`

## `filter_value`

7 implemented, 2 pending.

`value`, `label`, `count`, `active`, `param_name`, `url_to_add`, `url_to_remove`

| Pending | Why |
| --- | --- |
| `image` | No swatch content is modelled; themes fall back to the label. |
| `swatch` | No swatch content is modelled; themes fall back to the label. |

## `form`

17 implemented, 0 pending.

`id`, `errors`, `type`, `posted_successfully`, `email`, `first_name`, `last_name`, `body`, `author`, `company`, `address1`, `address2`, `city`, `province`, `zip`, `country`, `phone`

## `image`

8 implemented, 1 pending.

`preview_image`, `id`, `src`, `width`, `height`, `alt`, `position`, `aspect_ratio`

| Pending | Why |
| --- | --- |
| `presentation` | Image presentation — focal point and cropping — is not modelled, so a theme centres the image, which is the right default. |

## `language`

4 implemented, 0 pending.

`iso_code`, `endonym_name`, `name`, `primary`

## `line_item`

24 implemented, 2 pending.

`id`, `key`, `product_id`, `variant_id`, `title`, `product_title`, `variant_title`, `quantity`, `sku`, `vendor`, `price`, `line_price`, `final_price`, `final_line_price`, `image`, `url`, `properties`, `product`, `variant`, `options_with_values`, `original_price`, `original_line_price`, `unit_price`, `unit_price_measurement`

| Pending | Why |
| --- | --- |
| `line_level_discount_allocations` | Discounts are Phase 3 (§25). |
| `selling_plan_allocation` | Subscriptions are Phase 4 (§25). |

## `link`

7 implemented, 0 pending.

`title`, `url`, `type`, `active`, `links`, `levels`, `object`

## `linklist`

3 implemented, 0 pending.

`handle`, `title`, `links`

## `localization`

5 implemented, 0 pending.

`country`, `language`, `available_countries`, `available_languages`, `market`

## `location`

3 implemented, 0 pending.

`id`, `name`, `address`

## `media`

12 implemented, 0 pending.

`id`, `media_type`, `alt`, `position`, `preview_image`, `sources`, `host`, `external_id`, `src`, `width`, `height`, `aspect_ratio`

## `media_source`

5 implemented, 0 pending.

`url`, `mime_type`, `format`, `width`, `height`

## `metafield`

5 implemented, 0 pending.

`namespace`, `key`, `type`, `value`, `empty`

## `order`

15 implemented, 0 pending.

`id`, `name`, `order_number`, `status`, `currency`, `email`, `customer_name`, `subtotal_price`, `total_price`, `item_count`, `line_items`, `note`, `created_at`, `quote_expires_at`, `url`

## `page`

11 implemented, 0 pending.

`object_type`, `id`, `handle`, `title`, `content`, `author`, `url`, `template_suffix`, `published_at`, `created_at`, `updated_at`

## `paginate`

8 implemented, 0 pending.

`current_page`, `current_offset`, `items`, `page_size`, `pages`, `previous`, `next`, `parts`

## `policy`

5 implemented, 0 pending.

`id`, `title`, `body`, `handle`, `url`

## `predictive_search`

3 implemented, 0 pending.

`performed`, `terms`, `resources`

## `predictive_search_resources`

5 implemented, 0 pending.

`products`, `collections`, `pages`, `articles`, `queries`

## `product`

38 implemented, 1 pending.

`id`, `handle`, `title`, `description`, `content`, `vendor`, `type`, `tags`, `price`, `compare_at_price`, `price_min`, `price_max`, `price_varies`, `sku`, `unit_price`, `unit_price_measurement`, `object_type`, `metafields`, `collections`, `compare_at_price_min`, `compare_at_price_max`, `compare_at_price_varies`, `has_only_default_variant`, `options_by_name`, `available`, `options`, `options_with_values`, `variants`, `first_available_variant`, `selected_or_first_available_variant`, `images`, `featured_image`, `media`, `featured_media`, `url`, `created_at`, `updated_at`, `published_at`

| Pending | Why |
| --- | --- |
| `gift_card` | Gift cards are Phase 4 (§25). |

## `recommendations`

4 implemented, 0 pending.

`performed`, `intent`, `products`, `products_count`

## `request`

11 implemented, 0 pending.

`path`, `host`, `origin`, `page_type`, `locale`, `url`, `query_string`, `params`, `page`, `design_mode`, `visual_preview_mode`

## `routes`

17 implemented, 0 pending.

`root_url`, `all_products_collection_url`, `collections_url`, `search_url`, `predictive_search_url`, `cart_url`, `cart_add_url`, `cart_change_url`, `cart_update_url`, `cart_clear_url`, `product_recommendations_url`, `account_url`, `account_login_url`, `account_logout_url`, `account_register_url`, `account_addresses_url`, `account_recover_url`

## `search`

8 implemented, 1 pending.

`terms`, `performed`, `results_count`, `results`, `types`, `sort_by`, `default_sort_by`, `sort_options`

| Pending | Why |
| --- | --- |
| `filters` | Faceting a search result needs counts across products, pages and articles at once, which the collection facets do not compute. |

## `search_query`

3 implemented, 0 pending.

`text`, `styled_text`, `url`

## `section`

9 implemented, 0 pending.

`id`, `type`, `settings`, `index`, `index0`, `location`, `blocks`, `blocks_by_id`, `editor_attributes`

Also answers to, for themes written elsewhere:

- `section.shopify_attributes` → `section.editor_attributes`

## `shop`

24 implemented, 2 pending.

`id`, `name`, `description`, `domain`, `permanent_domain`, `url`, `secure_url`, `currency`, `enabled_currencies`, `enabled_locales`, `email`, `phone`, `address`, `privacy_policy`, `refund_policy`, `shipping_policy`, `terms_of_service`, `subscription_policy`, `money_format`, `money_with_currency_format`, `products_count`, `collections_count`, `types`, `vendors`

| Pending | Why |
| --- | --- |
| `customer_accounts_enabled` | Shoppers have no accounts yet: no credential storage, no storefront session, and /account/* is handed back to the platform rather than to a theme. |
| `enabled_payment_types` | Phase 1 takes no payments (§25), so no method is enabled. Declared rather than missing because themes count this before drawing a row of icons. |

## `sort_option`

3 implemented, 0 pending.

`value`, `name`, `active`

## `store_availability`

4 implemented, 0 pending.

`available`, `pick_up_enabled`, `pick_up_time`, `location`

## `template`

3 implemented, 0 pending.

`name`, `suffix`, `directory`

## `variant`

20 implemented, 0 pending.

`id`, `product_id`, `title`, `sku`, `barcode`, `store_availabilities`, `unit_price`, `unit_price_measurement`, `price`, `compare_at_price`, `options`, `option1`, `option2`, `option3`, `available`, `inventory_quantity`, `weight`, `weight_unit`, `featured_image`, `url`

