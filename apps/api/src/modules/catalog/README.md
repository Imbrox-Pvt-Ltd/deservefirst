# Catalog

Products and their variants for a store. Built to prove the Module Standard: the
entity is declared once in the manifest and the platform composes the rest.

## Bounded context

The merchant's sellable inventory — what a product *is*, what it costs, and where it
is published. Ordering, fulfilment and payment belong to other contexts and reach this
one only through `contracts/`.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Product** | The aggregate root. Owns its variants, options, media and publication state. |
| **Variant** | A purchasable combination of option values under one product. Never addressed outside its root. |
| **Option** | A named axis of variation (Color, Size). At most three per product. |
| **Handle** | The URL-stable slug. Unique per store; changing it emits a 301. |
| **Publication** | The set of sales channels a product is visible on. A rule-checked transition, not a flag. |

## Aggregates

| Aggregate root | Contains | Loaded / saved / authorized by |
|---|---|---|
| `Product` | Variants, options, publication state, price | the root |

A variant is never loaded, saved or authorised independently. Reaching past the root
is the coupling the Standard exists to prevent.

## Published contracts

`contracts/` exports `ProductSummary`, the event payloads, and `productResource` — the
single resource definition from which the GraphQL type, REST endpoints, list engine and
admin screens are derived. Nothing else in this module is importable.

## Events

| Event | Version | Direction | Meaning |
|---|---|---|---|
| `catalog.product.created` | 1 | emits | A product was created. |
| `catalog.product.updated` | 1 | emits | A product's fields changed; carries the previous handle so SEO can record a redirect. |
| `catalog.product.published` | 1 | emits | A product became visible on one or more channels. |
| `catalog.product.archived` | 1 | emits | A product was archived and pulled from every channel. |

## What the declaration buys

Declaring `Product` in the manifest — and writing no UI or list code — produces:

- list, detail and create screens from the four templates
- filter-token search, saved views, sort, column selection and cursor pagination
- metafields (merchant- and category-sourced), tags, timeline, audit trail
- bulk edit / tag / archive / delete / export, and CSV import
- SEO fields, sitemap participation and automatic 301s on handle change
- translations for `title`, `description` and `handle`
- soft delete with restore, and optimistic concurrency on every write

`tests/manifest.test.mjs` asserts each of these.

## Not yet built

Variants are modelled in `domain/` and validated, but have no persistence or screens
yet; collections, inventory, purchase orders and transfers are Phase 3. The repository
returns an empty variant list until then.
