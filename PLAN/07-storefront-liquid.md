# Storefront / Liquid platform — plan

The module `REQUIREMENT/…§23.3` defers the commerce domain to, and `§23.5` calls
"the real distance from Shopify". The platform layer was built for this.

## Decisions taken

**Engine: liquidjs 10.28.0, MIT, behind our own interface.**

Liquid is Shopify's own creation, written in Ruby — the `Shopify/liquid` gem is
the reference implementation, with `liquid-c` for speed. liquidjs is an
independent third-party port that tracks Shopify's semantics closely. It is not
Shopify's code.

So there is a fidelity ceiling, and it is worth stating rather than discovering:
a theme that renders on Shopify may render subtly differently here. The engine
sits behind our own interface so the decision stays reversible — including
towards running the actual Ruby gem out-of-process if fidelity ever matters more
than latency.

**Rendering is server-side.** liquidjs is agnostic about where it runs; Shopify
renders on the server and so do we. SEO comes from that plus the work listed
below, none of which the engine provides.

## What liquidjs actually gives us — measured, not assumed

Probed on install:

| | |
|---|---|
| Liquid **language** — tags, control flow, `date`, `default`, `upcase` … | ✅ provided |
| Shopify **storefront filters** — `money`, `money_with_currency`, `asset_url`, `img_url`, `image_url`, `stylesheet_tag`, `t`, `handleize`, `link_to`, `weight_with_unit` | ❌ **none of them** |

**And the failure is silent.** By default an unknown filter passes the value
through unchanged, so `{{ price | money }}` renders `2999` instead of `$29.99`
and nothing errors. A theme would look almost right and be wrong about money.

Mitigation, verified: `strictFilters` and `strictVariables` turn both into
errors naming the filter and the line. We render strict, always — a missing
filter must be loud in development rather than shipped.

The filter library is therefore ours to build, and it is not a footnote: money
formatting alone has to go through the `Money` value object (§15.2) rather than
formatting numbers, or the storefront becomes the one place on the platform
doing currency maths by hand.

## The security position

A theme is untrusted third-party code, exactly like an app or a Function.
Liquid exists **because** that is true — no arbitrary method calls, no file
access, only the objects the host exposes. That is the same shape as the UI
extension vocabulary and the WASM import table:

> **The drops are the security boundary.** A theme sees precisely what a drop
> exposes and nothing else. Every property added to one is a property every
> theme on the platform can read, and the argument for adding one always sounds
> reasonable in isolation.

Get it wrong and a theme reads another tenant's orders through an object
somebody exposed for convenience.

## Staging

1. **Theme model + settings/section schema** — the input types, block
   definitions, JSON templates. Pure domain, no engine dependency.
2. **Drops** — the object model a theme may see, deliberately small.
3. **Rendering** — liquidjs behind our interface, strict, plus the Shopify
   filter library.
4. **Storefront routing** — `/`, `/products/{handle}`, `/collections/{handle}`,
   `/pages/{handle}`, `/blogs/{blog}/{post}`, on its own host.
5. **SEO** — redirects, sitemap, robots, JSON-LD, canonicals. Alongside routing,
   not bolted on after.
6. **Theme editor** — the largest UI in the product. Last.

## What the first slice is NOT

`§23.3` defers cart, checkout and payments to this same module, and D10 made
Phase-1 commerce request-only. So the first storefront renders a catalogue with
a "request a quote" action — no cart, no checkout. That is coherent for B2B RFQ
and it is not a buyable store. Said here so it is not a surprise at a demo.

## SEO: what exists and what does not

Already built — the entity toolkit gives products, collections, pages and blog
posts a `_seo` table (meta title, description, canonical, OG), and translations
exist for `hreflang`.

Missing, and needed:

- **URL redirects.** A merchant renames a handle and every ranked link 404s.
- **sitemap.xml.** Content already emits `content.page.published` with the
  comment "SEO updates the sitemap" — a sitemap that does not exist.
- **robots.txt**, per store and editable.
- **JSON-LD** — Product/Offer/BreadcrumbList.
- **Canonical policy** so filtered collection URLs are not duplicate content.

## Conformance

A real Shopify theme is the target: "does it render unmodified?" is a better
test of the schema parser, the drops and section rendering than anything
invented here. A language-level conformance corpus should be wired in before the
editor, so divergence from Shopify is a measured number rather than something a
merchant finds.
