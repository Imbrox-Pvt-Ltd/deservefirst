# Content

Pages and merchant-defined content types.

## Why metaobjects matter

A metaobject definition is a content type the merchant invents — Author, Store
Location, FAQ, Size Chart. Creating one **never triggers a migration**: the
definition and its entries are rows, not tables (§17.4). That is the mechanism
that lets millions of tenants each have their own structure on shared tables, and
it is why entry validation is written against a definition object rather than a
schema.

## Bounded context

Editorial content: what the merchant writes, and the shapes they invent to write
it in. It owns nothing about products or storefront rendering.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Page** | A standalone editorial destination with its own URL. |
| **Definition** | A merchant-authored content type and its fields. |
| **Entry** | One instance of a definition. |
| **Display name key** | Which field names an entry in lists. |

## Aggregates

| Aggregate root | Contains |
|---|---|
| `Page` | body, publication state, SEO fields |
| `MetaobjectDefinition` | field definitions |
| `MetaobjectEntry` | values, validated against its definition |

## SEO applies here first

Products are usually reached through a collection; a page **is** the destination.
`Page` is the first entity to opt into the SEO toolkit, so it gets meta fields,
sitemap participation and a 301 on handle change without this module implementing
any of it.

Publication emits `content.page.published`, which SEO listens for to keep the
sitemap current.

## Two rules worth knowing

**A published page needs content and a date.** A live blank page is almost always
a mistake rather than an intent. A draft may be empty — that is what a draft is
for.

**An unknown field on an entry is rejected, not ignored.** Silently dropping a
value the merchant typed is worse than telling them the field does not exist.

## Not yet built

The page editor, the definition builder, entry forms generated from a definition,
and blogs/posts. Storefront rendering belongs to the Liquid module.
