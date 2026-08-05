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

## Drops — the machinery and the first nine

`domain/drops/`. A drop is a **declared allow-list**, not an object handed over:
`defineDrop(name, spec)` builds a frozen plain object with one enumerable getter
per declared property, and nothing else is reachable.

**23 drops, 247 properties**, in five files:

| | |
|---|---|
| `catalog` | product, variant, image, collection |
| `global` | shop, request, template, link, linklist, paginate |
| `content` | page, blog, article, comment |
| `commerce` | cart, line_item, customer, address, order |
| `theme` | section, block, form, search |

### The danger is concrete

Our own resources already mark `costPerItem` private and `internalNotes`
internal; `passwordHash`, `mfaSecret` and `webhookSecret` are internal too. A
drop built by spreading an entity would put a merchant's margin — or a
credential — into every theme on the platform.

So `drops-expose-nothing-private` (fitness rule #24) cross-checks the drop files
against **the manifests**, not against a list kept beside them. Marking a new
field private automatically protects it. Verified by planting a leak: the rule
named the file, the line, the field, and where its visibility was declared.

### Three mechanics, each measured against liquidjs

| | |
|---|---|
| **Plain objects with enumerable getters** | Class getters are *invisible* to the engine — a drop written as a class silently exposes nothing. |
| **Getters may return promises** | The engine awaits them in output, in `{% for %}`, and through filters. So drops are lazy by default. |
| **`constructor` / `__proto__` / `toString`** | Already refused by the engine, so prototype walking is not a hole we have to close. |

### Laziness, and the bug it exposed

Reading `product.title` costs no variant query. Reading `price_min` loads them
once.

That second part was wrong at first. Per-property memoisation is not enough:
`price_min`, `price_max`, `price_varies` and `variants` are four properties, each
memoised, each calling the variant loader — **four queries for one answer**, and
on a collection page that multiplies by the number of products. Caching moved to
the *loader* (`createDropContext`), which also covers the case per-property
memoisation never could: the same product appearing twice on one page. The cache
lives exactly one render, because a longer-lived one would serve one shopper's
page from another's data.

`dropList` is lazy too — a 500-element list builds zero drops until an element
is read.

### What the commerce drops deliberately withhold

- **`customer.note`** — private on the customer resource. It is what staff wrote
  about that person; a theme printing it would show a customer the internal
  comment about their own dispute.
- **`order.internalNote`** — staff-facing, while the customer's own `note` on
  the same order is public and themes render it. One word apart, opposite
  meanings.
- **`comment` has no `email` property at all**, so a comment list cannot publish
  every commenter's address.
- **`line_item` hides underscore-prefixed properties** — themes use them for
  their own bookkeeping and do not expect them in an order summary.

`cart` totals are computed from the lines rather than read from a stored total,
so a stale figure cannot render.

### Two names one word apart

Because `note` is private on one resource and public on another, the rule
refuses any read named `.note` in a drop. The order projection therefore names
its row field `customerNote`, which makes the mapping an explicit decision at
the boundary rather than a read indistinguishable from the one that leaks.

### The rule read prose as code

First version matched a full stop, optional space, then the field name — so it
found the sentence *"…about this person. `note` is what staff wrote"*, because a
full stop before a word looks exactly like member access. Comments are now
blanked before matching (offsets preserved, so line numbers stay honest) and the
pattern allows no space. Re-verified by planting two leaks afterwards: both
still caught, on the right lines.

### The rest of the drops

`localization`, `currency`, `country`, `language`; `media`, `media_source`,
`metafield`; `filter`, `filter_value`, `sort_option`, `facets`;
`discount_application`. **35 drops, 313 properties.**

Two decisions worth keeping:

- **Filter values carry their own URLs.** `url_to_add` and `url_to_remove` are
  computed from the request, so a theme never concatenates a filter URL. A theme
  that did gets the second filter wrong, loses the sort order, or keeps the page
  number — and the symptom is a shopper who ticks "Blue" and lands on page four
  of an unfiltered list. `page` is always dropped when a filter changes.
- **`discount_application` reports, never computes.** `total_allocated_amount`
  is what the platform actually deducted. A theme multiplying a percentage by a
  price would disagree with the invoice by a penny — the kind of discrepancy
  customers report and nobody can reproduce.

## Tags — all eight, behind the same boundary

`engine/tags/`. Tags are written against our own `TagDefinition` and translated
in `liquid.ts`, so `no-direct-liquid` still holds. This mattered more than it did
for filters: a tag written against liquidjs's parser and emitter is far more
entangled than a filter, so without the abstraction, adding tags would have
quietly made the engine irreplaceable.

Three kinds, because measuring the engine showed three genuinely different
mechanics rather than one with options:

| kind | tags | why |
|---|---|---|
| **raw** | `schema`, `javascript`, `stylesheet`, `doc` | The body is never parsed. `{% schema %}` is JSON and `{% javascript %}` is JavaScript — Liquid would fail on the first brace. |
| **block** | `style`, `paginate`, `form` | The body *is* Liquid, rendered with extra variables scoped to it. |
| **inline** | `section`, `sections`, `content_for` | No body; renders another file. |

### What the tags take away from themes

- **`form` emits the action and the forgery token.** An allow-list of form types
  maps to routes, so a theme cannot invent one and POST where it chose. An
  unknown type renders a comment rather than a form that posts somewhere
  plausible. `onsubmit:` is refused by the same attribute allow-list as the
  markup helpers.
- **`paginate` takes the page from the *request*, not the template**, so a theme
  cannot paginate to a page the URL disagrees with. `?page=9999` clamps to the
  last page rather than rendering an empty one that looks like a broken
  collection. The sliced variable leaves scope at `{% endpaginate %}`.

### The bug that only a test would find

Block tags must be registered with a **generator** `*render`, not `async render`.
`renderer.renderTemplates` returns a generator liquidjs drives itself; awaiting
it resolves to the generator object and renders nothing. The symptom was precise
and quiet: `{% style %}` emitted `<style></style>` with the body missing, and
`{% form %}` produced a form with no fields. Nothing threw.

## Layout and template resolution — a page renders

**The reference theme renders its homepage: 86 KB, 25 sections, zero failures,
zero unrendered Liquid.** A real commercial theme, unmodified apart from the
four ported filter names, through our engine, filters, drops, tags and template
resolution.

Three pieces:

- **`ThemeSource`** — an interface, not a filesystem, because a theme lives on
  disk in development, in object storage in production, and in an unsaved buffer
  while the editor is open. `FilesystemThemeSource` and `InMemoryThemeSource`
  implement it; the renderer does not know which.
- **`template-resolution.ts`** — pure. Which file renders this page, and what a
  JSON template means.
- **`PageRenderer`** — resolve, render each section, join into
  `content_for_layout`, wrap in the layout.

### Path confinement is one function

A theme names its own files, so every `{% render %}` is attacker-controlled
input to a file read. `confinePath` **refuses** rather than sanitises — stripping
`../` from `....//` leaves `../`, so a cleaner has to be right about every
encoding while a rejection only has to know what a legitimate path looks like:
`<known directory>/<name>`, decoded first, no nesting.

It is wired into liquidjs's own `contains` hook, so the engine refuses the
lookup rather than the source noticing afterwards. `FilesystemThemeSource` adds
`realpath`, because `snippets/card.liquid` can be a symlink to `/etc/passwd`.

### A broken section does not take the page down

A section is the unit a merchant added, and a theme is untrusted code. One that
throws renders as nothing and the other nine still ship — a storefront missing
its testimonials is a bug report; a storefront serving a 500 is lost revenue.
Failures are returned alongside the html rather than swallowed, and explain
themselves in the markup only when `explainFailures` is on: a Liquid error is
exactly what a developer needs and exactly what a customer must never see.

### Two things measurement corrected

**liquidjs passes `.` as the directory** when no root is set, so every lookup
became `./layout/theme.liquid` — three segments, refused by `confinePath`, every
render failing. The directory is now discarded: a theme path is relative to the
theme root, never to the including file.

**`{% render 'card' %}` is bare.** Themes name snippets without their directory,
so a bare name resolves to `snippets/`. Missing this would have broken every
snippet in every theme.

**`contains` had to become async** to satisfy the engine's type — which is worth
noting because if liquidjs truthiness-checked it instead of awaiting, a promise
would always be truthy and confinement would silently open. A test renders
`{% render '../../etc/passwd' %}` through that exact path to prove it still
refuses.

## Routing, and query parameters — a deliberate divergence

`domain/routing.ts` is pure: a URL in, a page type and handle out. The paths are
the reference product's exactly, because they are not ours to choose — a
merchant migrating brings ranked links and other people's bookmarks, and
`/products/{handle}` that became `/product/{handle}` is a store that lost its
search traffic on launch day.

`canonicalPath` drops the collection prefix and the tag filter, so a product
reachable through four collections has one canonical URL rather than five
competing duplicates.

### We expose query parameters. The reference product does not.

This is a considered divergence, requested because themes genuinely need it and
have always worked around it with JavaScript. The two reasons to withhold them
are real, and both are answered rather than waved away:

**Reflected injection.** Liquid does not escape output, so `{{ request.params.q }}`
renders whatever was in the URL — a link sent to a customer becomes script on the
merchant's domain. So values are escaped **before a theme ever sees them**: safe
by construction rather than by the theme remembering `| escape`.

`&` is deliberately left alone. With `<`, `>`, `"` and `'` already gone a value
cannot open a tag or leave an attribute, so escaping the ampersand would only
turn "shirts & ties" into "shirts &amp; ties" on the page for no security gain.

**Cache correctness.** A storefront caches pages by URL; a theme reading
`?utm_source` would bake one visitor's value into everyone else's page. So every
key a render reads is **recorded**, and `cacheKeyFor` builds the key from exactly
those. A page that reads nothing caches by path alone; a page that reads
`?variant` caches per variant. Iterating the parameters records all of them.

Also capped: 30 parameters, 256 bytes each — a URL is attacker-controlled input
that ends up in a page and in memory.

### The hazard testing found

A parameter named **`then`** would make the whole parameter object a *thenable*.
The engine awaits values it renders, so `?then=x` would have made it await
itself. `then`, `catch`, `finally`, `next`, `toLiquid`, `valueOf`, `toString`
and the prototype names are refused outright.

Relatedly, the engine probes every rendered object for `then`, `next` and
`toLiquid` — recording those put three phantom entries in every cache key. Reads
are now recorded only for keys that genuinely exist.

### Dynamic lookup: `all_products[handle]`

A parameter is only useful if it can drive something. `lookup.ts` gives themes
by-handle access, which is the one genuinely dangerous thing a theme can be
handed — so the guards ARE the feature:

- **Published only.** A by-handle lookup is a handle oracle: guess or scrape a
  name and ask. A loader returning drafts would let anyone read an unreleased
  catalogue. The `publishedOnly: true` flag has no `false` — it exists so a
  loader wired without the filter is a visible lie at the call site.
- **A budget of 20 distinct lookups per render.** One lookup is a query; a
  lookup inside `{% for i in (1..1000) %}` is a thousand from one request.
  Repeats are free. Over budget yields nil, so a theme renders an incomplete
  page rather than a failed one.
- **Normalised keys.** Everything is handleized before reaching a loader, so
  `../../etc/passwd` and `' OR 1=1 --` become inert handles that find nothing.
- **Not enumerable.** `{% for p in all_products %}` yields nothing; it must
  never become a request to load the whole catalogue.

#### Three proxy traps, learned the hard way

liquidjs does not read properties with `get`. It resolves them through
**`getOwnPropertyDescriptor`** — a proxy implementing only `get` returned
nothing for every lookup and ran no queries, silently. And `has` is consulted
*before* the read, so returning `false` to block enumeration blocked reads too;
enumeration is `ownKeys`'s job alone. Finally the target must be **extensible** —
a proxy over a frozen target may not report a property the target lacks, which
threw on every miss. Writes are refused by the `set` trap instead.

## Theme editor — the model

`domain/editor.ts` is the document model; `application/editor-service.ts` reads
schemas and holds drafts. The React UI is what remains.

Reordering is the easy part. What isn't:

- **Two editors.** A merchant and their designer both have it open.
  Last-write-wins discards one silently. Every edit carries the version it was
  made against and a mismatch is refused, not merged.
- **Settings are typed.** A `range` value is checked against min, max **and
  step** — a slider can only produce values on its steps, so one that isn't came
  from somewhere else, and the theme's CSS may assume the increments.
- **Limits are the theme's.** `limit`, `max_blocks` and per-block limits are
  declared by the theme author and enforced here, because a section added past
  its limit renders wrongly for every visitor.
- **Disabled ≠ deleted.** Settings stay in the file, so switching a section back
  on restores what the merchant configured rather than the preset.

### The property that makes it safe

**An edit changes the preview and not the live store.** `withDrafts` wraps the
theme source and overlays only the changed templates, so the renderer asks for
`templates/index.json` and gets the draft while every other file comes from the
real theme. Wrapping rather than copying — a duplicated theme would drift the
moment anything else changed. Tested by rendering both and asserting each sees
only what it should.

### A real theme corrected the placement rule

`enabled_on`/`disabled_on` have a `groups` dimension as well as `templates`, and
checking only `templates` fell through to "no restriction". All **55** of the
reference theme's placement declarations use `groups` and **none** uses
`templates` — so nine header and footer sections were being offered in the page
picker, where they render wrongly.

The asymmetry is the rule: `enabled_on` is a whitelist, so naming groups and not
templates means *not on a template*; `disabled_on` is a blacklist, so saying
nothing about templates means templates are fine. Treating them alike would have
removed 46 sections from every picker instead.

Measured after the fix: 48 addable per template (was 54), header 3, footer 6,
aside 5.

## Theme editor — the UI

Three panes: sections left, the store in the middle, settings right.

**The preview is a real render.** An iframe pointed at the storefront, going
through the same engine, filters and drops a customer's page would — not a
mock-up and not a client-side approximation. A preview built from a different
code path is one that lies eventually. It is sandboxed without
`allow-same-origin`, because a theme is third-party code and must not reach the
editor's own session.

**`SettingInput` is the bulk of the surface.** Thirty-five declared types mapped
to real controls, because the mapping *is* the editing experience: a `range`
drawn as a text box lets a merchant type a value off the schema's step, which
the server then refuses — an error they hit without understanding why. So the
schema's own min/max/step reach the slider, a select's options reach the
dropdown, and a colour gets a swatch *and* a hex field (one is how you pick, the
other is how a brand guideline gets entered exactly).

Unknown types degrade to a text field with the type named. A theme built for a
newer version stays editable; a blank space would be a setting nobody can find.

**Reordering is arrow buttons, not drag-and-drop** — keyboard-reachable, works
on touch, and always lands where it says. A half-built drag that drops a section
in the wrong place is worse than a pair of arrows.

**Conflicts stop the editor.** A 409 from the server replaces the panes with
"someone else edited this template — reload", because merging silently would
discard one of two people's afternoon.

### What is NOT wired

`editorController` exists with its four endpoints and is **not mounted**. Two
things block it, and both are real rather than fiddly:

- `sessionFor` needs theme lookup, schema parsing and a preview URL per store.
- `publish` is now built — see below.

## The publish model: immutable versions, one pointer

The design question was atomicity. Theme files live in object storage, which is
**not transactional with the database**, so "write the files, then update the
row" has a window where a store is half-published.

So: a publish writes a **new immutable version** and then moves a pointer. The
only transactional step is a row update, which the database already guarantees,
and nothing a customer can reach is ever partially written.

That one choice answers three questions:

| | |
|---|---|
| **Atomic?** | Yes — the swap is a single row update. |
| **Recoverable?** | Free. The previous version still exists; rollback moves the pointer back. |
| **Duplicated?** | No. A version reference is a content hash, so republishing identical bytes writes nothing. |

`planPublish` handles the case that matters most: publishing the theme that is
**already live** demotes nothing. Treating it as a swap would briefly leave the
store with no main theme — a storefront that answers nothing.

`planRollback` targets the previous **version of the live theme**, not the
previously-live theme. Those differ whenever a merchant published edits to the
theme that was already live, which is the usual case — rolling back should undo
the edit, not swap to a theme abandoned months ago.

### Preflight: a broken theme cannot be published

A publish renders the affected templates **before** writing anything. A publish
that wrote first would already have broken the store by the time it noticed.

Getting the threshold right was the hard part, and it is wrong in both
directions:

- The check renders with **no products or collections**, because one that needed
  real data could never let a new store publish. So a section reaching for
  `product.title` fails here and works perfectly for a customer — blocking on
  that would make most real themes unpublishable.
- But a **missing filter or unclosed tag fails for every visitor**, regardless of
  data. That is not an artefact of checking; it is a page a customer will never
  see rendered.

So `isThemeBug` decides: theme bugs block, data-shaped failures become warnings.
The first draft of this treated *all* section failures as non-blocking, which was
rationalising — a test caught it.

Verified: a theme with `no_such_filter` is refused, and **nothing** is written,
no pointer moves, and the draft is still there.

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
6. **Theme editor** — the largest UI in the product. Model and service done;
   the React UI is what remains.

## What the first slice is NOT

`§23.3` defers cart, checkout and payments to this same module, and D10 made
Phase-1 commerce request-only. So the first storefront renders a catalogue with
a "request a quote" action — no cart, no checkout. That is coherent for B2B RFQ
and it is not a buyable store. Said here so it is not a surprise at a demo.

## The storefront HTTP layer — it serves

`api/storefront.controller.ts`. A URL on the storefront host becomes a response,
and the real theme now serves through the whole pipeline:

| | | |
|---|---|---|
| homepage | 200 | 86 KB |
| product | 200 | 38 KB |
| missing product | **404** | theme's own 404 template |
| renamed handle | **301** | `→ /products/linen-shirt?utm_source=email` |
| robots.txt | 200 | with sitemap line |
| sitemap.xml | 200 | index |
| another host | 404 | nothing |

### The order is load-bearing

1. **resolve the store** — everything after inherits this tenant decision
2. **robots/sitemap** — machine files, before any theme work
3. **redirects** — *before* routing, or a renamed handle 404s on the way past
4. match route, load record
5. render with that page's drops
6. status, headers, cache key

### The tenant boundary is a Host header

A storefront visitor is anonymous. There is no permission check to catch a
mistake, so the Host header — attacker-controlled — is the only thing deciding
whose data renders. It is **looked up, never parsed**: a store id derived from a
substring of a header is a tenant boundary made of string manipulation.

Tests wire up two stores and prove one host cannot reach the other's products,
that the second store genuinely serves them on its own host (so the test is not
vacuous), and that an unknown host reveals nothing about which hosts exist.

### Status codes are SEO

A missing product returns a **real 404** carrying the theme's own 404 template.
A "not found" page served with 200 is a soft 404 — search engines index it as a
real page, and the merchant ends up with results pointing at nothing.

### The cache key is finally wired

`cacheKeyFor` was built two steps ago and unused. Now: a page reading no
parameters caches under `/`; one reading `?variant` caches under
`/?variant=42`; a 404 is never cached. Verified end to end.

### Two headers, stated rather than shipped

`X-Frame-Options` is **deliberately absent** — the theme editor previews a store
in an iframe, and a blanket DENY would break the product's own editor. Framing
belongs in `frame-ancestors`, which can name the admin host.

There is **no CSP yet**, and that is an admission. Themes emit inline
`<script>` and `<style>` through `{% javascript %}` and `{% style %}`, so a
policy worth having needs per-render nonces threaded through those tags.
Shipping a policy every theme violates would teach everyone to ignore the
console.

## The POST surface — the storefront can now take an enquiry

Until now the storefront rendered `<form action="/requests/add">` and answered
**405** to every POST. It could display a catalogue and not receive a single
enquiry — which, with Phase-1 commerce being request-only (D10), meant it had no
conversion action at all.

### The threat model is different here

This is **the one place an anonymous stranger writes data**. Everything else on
the platform is a merchant with a session or an app with a token, and that
changes which defences are worth having:

**CSRF is not the main risk on a public form.** Forging a request on behalf of
an anonymous visitor accomplishes what that visitor could do themselves — send
an enquiry. There is no privileged action to hijack. So public forms are checked
by **Origin**, which a browser sends on every cross-site POST and cannot be made
to lie about. A *missing* Origin is allowed: some privacy tools strip it, and
refusing those would break the form for real people to prevent an attack that
gains the attacker nothing.

The forms that *do* carry authority — login, register, change address — need a
session and a token bound to it. That distinction is what makes the
origin-only approach defensible rather than lazy.

**Spam is the real risk**, so: a rate limit keyed by store *and* visitor (one
merchant's viral moment must not exhaust everyone's bucket), a honeypot emitted
by the `{% form %}` tag rather than left to themes, and refusal before parsing.

A tripped honeypot is answered **as though it succeeded**. Telling a bot it was
detected teaches whoever wrote it to stop filling the field.

### Post / Redirect / Get

A success **redirects** (`?posted=requested&ref=…`); a failure **re-renders** the
page with `form.errors` populated, which is what themes are written for. A
success that re-rendered would resubmit on refresh and a merchant would find the
same enquiry four times.

The outcome travels as a query parameter the theme reads —
`request.params.posted` — which is exactly what the readable-parameters work was
for.

### One shape, not two

`formStateFor` returns the shape the `form` **drop takes**, not the shape it
produces. The first version returned the drop's own output: the error list
rendered correctly and `{{ form.email }}` came back empty, because themes read
fields off the form directly and only the drop puts them there. A test caught
the half-right page.

### Wired to the orders module

A quote request goes through `RequestService` — **create → addLine → submit** —
rather than writing rows. Writing directly would skip the reference sequence,
the timeline entry and the `orders.request.submitted` event, and a merchant
would find a request in their queue that no notification ever mentioned.

**Submitted, not draft.** A draft sits where nobody looks: the customer believes
they asked for a quote and the merchant never sees one.

**The price comes from the catalogue, never the form.** The quantity is the
customer's to choose; the price is not. A list price posted from a browser would
let anyone name their own, and a merchant reading the quote would have no way to
tell it had been changed.

**A deleted product does not lose the enquiry.** Somebody wants to buy something
and got as far as asking — a request with a note and no line is one a merchant
can answer.

Contact messages get their **own entity**, not a `Request` with no lines. A
contact message is not an order at any stage of its life, and putting one in the
quote pipeline would fill the RFQ queue with "do you ship to Ireland?" — which is
how a queue stops being read.

Verified against the live database:

```
RFQ-1001  submitted  buyer@acme.test  "Need 25 by Friday"  lines=1  subtotal=112500
line:     Linen Shirt  ×25  @4500          ← 25 × 4500, price from the catalogue
message:  hello@acme.test  new  "Do you ship to Ireland?"
```

A live submission found a real bug: the contact insert reused a placeholder for
both timestamps, giving **seven placeholders and six values**. A positional
dialect would have caught it; the `?` dialect reported a syntax error near the
end of the statement. Pinned by a test that counts placeholders against values.

### The messages screen

A form that stores a message nobody can read is a form that loses it. `/store/:handle/messages`
is where a merchant finds out somebody asked whether they ship to Ireland.

Reading it needed **no controller**: declaring `contactMessageResource` gives the
generic read surface a list and a get from the declaration alone. Writing one
would have been a second way into the same rows, and the two would eventually
disagree about filtering.

The message is a **visible column**, not something behind a click — the decision
"does this need an answer" is made by reading the first line, and a list ordered
by metadata is one people scan past. Views lead with **New**, because an inbox is
only useful if it can be emptied.

**Nothing is ever deleted.** A message a merchant believes is spam is *marked*
spam, so it can be found again when a customer says "but I did write to you".

### A write that could not be verified

Cross-tenant triage was **refused correctly and reported success**. The row was
never touched — `store_id` in the WHERE clause saw to that — but the caller was
told it worked.

`executor.query` returns rows, and MySQL answers an UPDATE with a *header*
rather than an array, so reading `affectedRows` off the result was `undefined`
and the zero-row check never fired. Nothing leaked; the answer was simply a lie,
which is its own kind of bug.

The platform already had the right contract: `execute()` reports affected rows,
and `SqlAggregateRepository` **refuses to run at all** on an executor that
cannot. The same stance now applies here — a write you cannot count is a write
you cannot verify.

Found by running the thing rather than reading it, and pinned by a test verified
to fail against the old behaviour.

## SEO — built

All four gaps below are now closed, in `domain/`. Every one is a file or a
header read by a machine, and every one has a failure mode where the output
looks fine and is discarded **wholesale**.

### Redirects (`redirects.ts`)

A handle is part of a URL, so renaming a product breaks every link to it. Three
non-obvious rules, each a real defect if skipped:

- **Loops refused at save time.** `a → b → a` makes a browser show its own error
  page — worse than the 404 the redirect replaced, because at least the 404 is
  the theme's.
- **Chains resolved to the end**, so `a → b → c` costs the visitor one hop
  rather than two. Search engines stop following after a handful.
- **No open redirects.** A target on another host turns the merchant's domain
  into a phishing relay carrying their reputation. Relative paths only —
  `//evil.test`, `/\evil.test` and a newline-injected `Location:` are all
  refused.

Campaign parameters survive the redirect, because dropping `?utm_source` loses
attribution the merchant is paying for.

### sitemap.xml (`sitemap.ts`)

The **50,000 URL** ceiling is the protocol's, not a preference: exceeding it
means the file is rejected entirely, so a growing store would silently stop
being indexed. Hence `splitIntoSitemaps` and an index.

XML escaping is the trap — a handle may legitimately contain `&`, and one raw
ampersand invalidates the document so a crawler discards **every** URL in it.
All five entities are escaped. The `xhtml` namespace is declared only when
hreflang alternates use it.

### robots.txt (`robots.ts`)

The defaults matter more than the editing. Beyond `/cart` and `/account`, the
expensive one is **faceted collection URLs**: six filters is thousands of
near-identical pages, and a crawler that indexes them spends its budget there
instead of on products. `/password` is a leak rather than a waste.

Merchant values are stripped of control characters, because robots.txt is
line-oriented and an injected `\nDisallow: /` would hide the entire store from
every crawler — a catastrophic, silent outage.

### JSON-LD (`structured-data.ts`)

Product/Offer, BreadcrumbList, Organization, Article, WebSite. Prices convert
from minor units by **string arithmetic**: `4499 / 100` is `44.989999999999995`,
and a price in a search result that disagrees with the page is the merchant's
problem to explain.

A product with no price emits **no price field** rather than zero — marking up a
price the page does not show is what search engines penalise as structured-data
spam. `<` is escaped so a description containing `</script>` cannot close the
tag it sits in.

Canonicals were already done: `canonicalPath` in `routing.ts` drops the
collection prefix and the tag filter.

## SEO: the original gap list

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
