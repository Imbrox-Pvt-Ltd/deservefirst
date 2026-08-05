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

## The engine layer — built

`apps/api/src/storefront/engine/` is the only place liquidjs is imported, and
`no-direct-liquid` (fitness rule #23) fails the build if that stops being true.
Everything else — filters, callers — is written against `types.ts` and
`context.ts`, so swapping engines is a one-file change rather than an ambition.

```
engine/
  liquid.ts      ← the ONLY liquidjs import
  types.ts       ← FilterDefinition, FilterArgs, ThemeEngine
  context.ts     ← what a filter may know: base URLs, currency, translations
  markup.ts      ← escaping + the attribute allow-list
  color.ts       ← colour maths, pure
  filters/       ← money · string · color · font · url · html · localization · commerce
```

**The gap was measured, not guessed.** The reference theme uses 92 distinct
filters; liquidjs provides 43 of them. The other **49 are ours**, and all 49 now
exist — `filter-coverage.test.mjs` walks the theme, extracts every filter it
uses, and asserts each one resolves. It reports the gap rather than a count, so
adding a theme or a filter needs no edit.

### Three things the implementation taught us

**1. liquidjs cannot distinguish a keyword argument from a two-element array.**
`{{ x | f: width: 200 }}` and `{{ x | f: pair }}` where `pair = ['width', 200]`
arrive at the filter *identically*. Reading the parsed token disambiguates them —
a keyword's token is itself an array, a positional's is a single token — so the
syntax decides and never the shape of the value. Pinned by a test.

**2. Liquid does not escape output**, here or in the reference product. So
`returnsHtml` is a contract between maintainers, not an engine switch: filters
that build markup escape their own inputs through `markup.ts`. Auto-escaping
would have double-escaped every existing theme.

**3. `link_to` escapes its href and not its label**, because the reference theme
writes `{{ '&larr;' | link_to: url }}` and escaping that renders the literal
text. The href has no such requirement and refuses `javascript:`.

### Deliberately empty

`payment_button`, `payment_terms` and `login_button` render nothing. There is no
cart yet (see below). They *exist* because `strictFilters` is on: an absent
filter fails the whole page, so a missing buy button degrades to a page without
one rather than to no page. They gain bodies when checkout does.

## Bring your theme — the compatibility story

**All 146 canonical storefront filters exist**, not just the 92 Broadcast uses.
Two tests hold the line: one asserts every canonical name is registered, the
other actually *invokes* each one, because registration is not implementation.

Foreign names are handled by tooling rather than by carrying someone else's
brand in our vocabulary. `config/theme-compat.json` is **data, not code** — a
table of names we are willing to answer to, with `{slug}` substituted from
`branding.slug` at load. Three ways to use it:

| | |
|---|---|
| `platform theme:check <dir>` | What will not run here, and why. Reports foreign names grouped with their replacement, plus the template lint. |
| `platform theme:port <dir>` | Rewrites them, once, reviewably. `--dry-run` first. |
| `{ compatibility: true }` | Runtime aliasing, **off by default**, for themes that cannot be edited. |

Check and port share one map and one detection routine, so they cannot
disagree — a checker and a fixer that report different things is worse than
either alone. Both only match inside Liquid delimiters: a theme's own
JavaScript may mention any of these strings in a comment or a URL, and
rewriting those would break working code to fix nothing.

Measured on Broadcast: `theme:check` finds 4 uses of 1 foreign name across 2
files and 3 genuine lint warnings; `theme:port` fixes all 4 and re-checking is
clean.

### Why compatibility mode is off by default

Our names are the real ones. A ported theme is a theme the developer owns, in
our vocabulary, with a diff they can read — that is the recommended path, and
making aliasing automatic would quietly turn the foreign names into part of the
platform. Aliases delegate to the filter they point at, so they cannot drift; a
test renders every alias and its target and asserts identical output.

### No foreign filter names in our own vocabulary — decided

There is **no alias table**. The platform-asset filter is
`deservefirst_asset_url`, and its name is built from `branding.slug` so renaming
the platform renames the filter — §33.1 governs the theme vocabulary exactly as
it governs anything else a person reads.

The cost is explicit: a theme written for another platform names this filter
differently and **must be ported**. That is four call sites in the reference
theme, already done locally. Porting is the price of not carrying someone else's
brand in our vocabulary, and it was chosen deliberately.

`competitor-names` was strengthened while doing this. Its patterns used `\b`
word boundaries, which do **not** match `shopify_asset_url` — an underscore is a
word character, so there is no boundary after the name. The rule missed the name
in exactly the form that matters most: an identifier.

## Arrays in Liquid, and the lint that explains them

Liquid has no array literal. `{% assign a = [1, 2, 3] %}` does not error — it
assigns **nothing**, so the loop under it runs zero times and a section silently
disappears. Measured: it renders empty with `size` 0.

Two halves to the fix.

**Filters** (`engine/filters/array.ts`) — `array` builds one (`nil | array` for
an empty accumulator, `'a' | array: 'b', 'c'` for a full one), plus `index_of`
and `without`. Accumulating across a loop now reads plainly:

```liquid
{% assign list = nil | array %}
{% for b in section.blocks %}{% assign list = list | push: b.id %}{% endfor %}
```

**A linter** (`domain/template-lint.ts`) that reports at upload, beside the
schema checks, for the same reason: an error found when a theme is installed is
a message to the person who can fix it; the same error at render is a broken
storefront. Rules: `no-array-literal`, `no-hash-literal`, `increment-prints`,
`forloop-outside-loop`, `append-without-separator`. Each finding carries the fix.

### Checked, so we don't have to guess

- **No array filter mutates its input.** `sort`, `reverse`, `push`, `uniq`,
  `concat` and the rest all copy in liquidjs — verified across the family. This
  matters because a drop can hand a theme an array the platform also holds; an
  in-place sort would let one render reorder data for every render after it. A
  test pins it so an upgrade cannot change it quietly.
- **`nil` is not `null`.** liquidjs passes a `NullDrop` *object*, which is
  truthy — so `nil | array` produced a one-element array containing the
  sentinel. Normalised at the boundary in `liquid.ts`, which is the layer
  earning its keep: one engine quirk, contained in one file, 49 filters
  unaffected.

### The linter's own false-positive lesson

First version: **158 findings on the reference theme, 0 real.** `forloop` was
flagged without tracking block nesting, so every correct use inside a loop was
reported; `append` was flagged without checking whether the value was ever
split, so building a class list looked like a bug.

After tracking `for` depth and requiring a matching `| split:` — **3 findings,
all genuine**: `sections/section-product.liquid` passes `forloop.index` to
`{% render %}` with no enclosing loop, so `index:` arrives empty.

A rule that cries wolf is worse than no rule; it teaches people to skim past the
output, including the real ones.

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

1. ✅ **Theme model + settings/section schema** — the input types, block
   definitions, JSON templates. Pure domain, no engine dependency.
2. **Drops** — the object model a theme may see, deliberately small. ← next
3. ✅ **Rendering** — liquidjs behind our interface, strict, plus the filter
   library. *Tags* (`{% render %}`, `{% section %}`, `{% paginate %}`,
   `{% form %}`) still to come; they need the drops from stage 2 to be useful.
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
