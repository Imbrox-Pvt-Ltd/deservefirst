# Night log — 2026-08-05, 02:00 → 07:00

Appended as each block lands, so you can read it top to bottom in the morning.
Every entry says what was built, what was verified against the running server,
and anything that failed or was deliberately left alone.

## Scope discipline for this run

You asked for Shopify parity **per our documentation**, and not to over-engineer.
So I checked what the docs actually say before queueing anything, and I am
**not** building three things that look like obvious gaps:

| Not building | Why — from our own docs |
|---|---|
| Files | `PLAN/03 §5.1` — needs the CDN story first (§22). Building it without one means inventing a storage design nobody agreed. |
| Gift cards | `PLAN/03 §5.1` — a value-bearing entity, wants a ledger commerce does not have yet. |
| Discounts · Markets | `PLAN/03 §5.1` + decision D10 — Phase-1 commerce is request-only, so both are *deliberately* deferred. |

Those are documented decisions, not oversights. Building them tonight would be
exactly the over-engineering you warned about.

**What I am building**, in order, all of it named in `PLAN/03` or `PLAN/05`:

1. Scope approval — `PLAN/03`, "what the app platform is missing"
2. App suspension — same
3. Per-app rate limits — same
4. App can uninstall itself — same
5. Menus and Blog posts — `PLAN/03 §5.1`, content extension, no stated blocker
6. Sweep, then update `PLAN/03 §5.1`, which is stale on two rows

## Corrections to the plan document itself

`PLAN/03 §5.1` lists these as placeholders and they are built:

- **Home · Growth · Analytics** — the dashboard mechanism shipped
- **Segments · Companies** — the customers module extension shipped

I will fix that table in the last block rather than leave the plan describing a
system that no longer exists.

---

## Log

### 02:4x — Block B · Scope approval, so somebody can say yes

Restricted scopes failed closed, which was safe and also meant no app could ever
be published asking for one. The port that returned `[]` now reads an operator's
decisions.

Approval is **per app and per scope**. Approving an app to read customer contact
details is not approving it for everything else it may later ask for, and one
record per scope is the only shape where that stays true.

Decisions replace rather than append. "May this app have this scope" has one
current answer, and a screen that reduces a history to find it will eventually
reduce it differently from the check that enforces it. The timeline keeps the
history.

Verified end to end against the running server:

| Step | Result |
|---|---|
| Partner registers app wanting `read_customer_contact` | registered |
| Partner tries to publish | refused — needs platform approval |
| Operator's review queue | lists it, with the restricted ask named |
| **Merchant** tries to reach the queue | refused — needs `platform.apps.review` |
| Operator denies with no reason | refused — a denial a partner cannot act on is one they resubmit |
| Operator "approves" an ordinary scope | refused — would imply it needed approval |
| Operator approves the restricted scope | recorded |
| Partner publishes | **published** |
| Queue afterwards | no longer lists it |

### 03:2x — Block C · App suspension across every store

`AppStatus` had `suspended` and nothing set it. There was no way to stop a
misbehaving app everywhere at once.

Two design choices worth knowing about:

**Suspension does not revoke tokens.** It is usually temporary and often a
mistake being investigated; killing every token would force every merchant
through a reinstall to undo it. `tokenIsUsable` reads the app's status on every
call instead — so the stop is immediate *and* reversible.

**The reason travels.** It is carried on the app rather than left in an audit
log, because the people who need it are the merchants who installed it. A
suspended app is still installed and still listed; without the reason it looks
like it is working while every call fails, and the merchant blames their store.

Verified against the running server:

| Step | Result |
|---|---|
| App installed, token working | `http 200` |
| Operator suspends with no reason | refused — merchants will read this |
| Operator suspends with a reason | `status: suspended` |
| The same token, immediately | `http 401` |
| The app's author is told | the suspension reason, not "expired, revoked, or uninstalled" |
| A made-up token | still the vague message — nothing true to say, and inventing one maps which tokens exist |
| Merchant's app list | "Stopped by DeserveFirst" + the reason |

### 03:5x — Block D · Per-app rate limits

The token endpoint was limited; the API an app then called was not, so one app
could exhaust a store's capacity.

**The interesting part is that my first attempt did nothing and looked fine.** I
put the limit on the module-controller loop, ran 80 concurrent calls, and got 80
× 200. There are *two* ways into the data — module controllers and the generic
read surface — and every list endpoint a merchant's data actually lives behind is
on the other one. A limit covering half the API is not a limit. It is one helper
called from both paths now, rather than two copies that drift.

Also found: the request context had no app identity. `actorType: 'app'` said an
app was calling but not which one, so the only handle was the user id an *online*
token carries — null for offline tokens, meaning every offline app on a store
would have shared one bucket and one line in the logs. `appId` is on the context
now.

Verified:

| | result |
|---|---|
| 80 concurrent calls from one app | **40 × 200, 40 × 429** — exactly the capacity |
| the merchant during that burst | `http 200` |
| the 429 | `retry-after: 1`, `code: rate_limited` |

Per app **and** per store, because an app installed on a thousand stores sharing
one allowance means the busiest merchant starves the rest.

### 04:1x — Block F · An app can uninstall itself

A customer cancelling a subscription should not have to ask their merchant to
tidy up afterwards.

Not on the module controller surface, because that authorises by store
permission and **no app scope grants one that would fit**. Inventing a scope so
an app could delete its own row would be vocabulary for its own sake. The
authority is the token: it names one app and one store, so an app can only ever
remove its own install from the store it was issued for.

| Step | Result |
|---|---|
| App installed, token working | `http 200` |
| A **person** calling the self endpoint | refused, pointed at the merchant's own settings |
| The app removing itself | `uninstalled: True` |
| Its own token immediately after | `http 401 invalid_token` |

### 05:1x — Block G · Menus and Blog posts

The two `PLAN/03 §5.1` placeholders with **no stated blocker**. Files stays
deferred (needs the CDN story), gift cards stay deferred (needs a ledger),
discounts and markets stay deferred (D10). Those are documented decisions and I
left them alone.

Menus carry the real complexity, and it is all tree-shaped:

- **depth ≤ 3** — the reference limit, and what a drop-down can show
- **no item twice** — which is what a cycle looks like once flattened and rebuilt
- **no `javascript:`** — a menu item is stored XSS on the storefront otherwise
- **broken links reported, not removed** — a merchant who deleted a page wants to
  know their menu points nowhere; dropping the item silently means they hear it
  from a customer

Blog posts are deliberately near-identical to Pages, with one difference that
matters: a scheduled post is `published` with a **future date**, so the
storefront asks `isVisible` rather than reading the status. A storefront
filtering on status alone publishes every scheduled post the instant it is saved.

Verified against the live API — nested menu created, depth refused,
`javascript:` refused, duplicate handle refused, post created as a draft,
publishing with no date gets "now", publishing an empty post refused.

**Two bugs I wrote and caught:**

1. The depth check fired on an *empty* children array, so a legal three-level
   menu was rejected. The deepest item still recurses once into its own empty
   children.
2. `{...current, ...patch}` — a patch carrying `title: undefined`, which is what
   a controller produces for an omitted field, overwrote the real title with
   nothing and failed later on `undefined.trim()`. **This is the same bug as the
   nav-icon one from earlier in the week**, in a new place. It is the spread that
   is wrong, not the caller.

**62 destinations render.**

### 05:4x — Block E · Sweep, and the handover

**The sweep found nothing new.** The two recurring classes are clean: no other
`{...current, ...patch}` spread that can overwrite with `undefined`, and no
remaining enumerated list that should be discovery — the survivors
(`FAILURE_MARKERS`, `PRODUCTS`) are data, not discovery.

Checked that the operator/merchant split did not take anything away from
merchants: `store.apps.manage`, `store.partners.manage`, `store.webhooks.manage`,
`content.manage`, `catalog.write` all still held, and `platform.*` correctly
none.

`PLAN/03 §5.1` corrected — it listed five sections as placeholders and three of
them shipped. The remaining three now say *why* they are deferred, so the next
reader does not mistake a decision for an oversight.

---

## Morning summary

Seven blocks, all committed, CI green at every one.

```
694f2e9 Menus and blog posts: the two placeholders with no blocker
f483ede An app can uninstall itself
d9cfc9f Per-app rate limits, on both ways into the data
6515336 App suspension: stop a misbehaving app everywhere at once
4d19fc4 Scope approval: an operator can now say yes
6f0b9a1 A merchant is not an operator: close a live cross-tenant defect
981b9d7 Bring the build plan in line with what is built, and write the handover
e792c44 An app is never the person, however it got its token
```

### The one to read first

**A live cross-tenant defect, found while planning rather than while building.**
The seeded store owner held `platform.modules.manage` and
`platform.settings.manage` — one merchant could have disabled a module for
*every store on the platform*. Three independent causes, each of which alone was
the bug: the permissions were declared in the `organization` category, the seed
granted every declared permission to the owner, and the guard checked only that
the permission was present. Fixed at all three, and there is now a `platform`
role category no tenant role can hold — which makes the grant impossible rather
than merely refused.

The new fitness rule caught a real miss immediately: my own edit had changed one
of the two declarations and not the other.

### What this resolves

The platform-admin surface was deferred pending "the first store you do not own".
**That trigger arrived from a direction neither of us predicted** — not a new
tenant, but the platform needing someone to answer for it. Scope approval and app
suspension are operator actions, and until tonight there was no operator.

### Numbers

| | start of night | now |
|---|---|---|
| tests | 412 | 424 |
| fitness rules | 20 | 21 |
| smoke destinations | 60 | 62 |

### Known gaps, stated plainly

- **The operator has no screens.** Scope review and suspension work over the API
  and I drove them with curl. A platform-admin UI is the obvious next block —
  everything it needs now exists behind it.
- **Menus and blog posts have list and create screens, not edit screens.** The
  API supports editing; the detail screens are the follow-on.
- **Blogs are created by API only** — there is no "add blog" screen, because the
  captured nav has none. A merchant needs at least one blog before posting, so
  this wants a decision: either a small blogs screen, or a default blog created
  with the store.

### What I would do next, in order

1. **Platform-admin screens** for the review queue and suspension. The backend is
   done and driving it by curl is not a product.
2. **Detail screens for menus and posts**, so the tree editor and the publish
   toggle exist.
3. **Dev dashboard and dev stores** — the last Phase 4 item with nothing built.

### Decisions waiting for you

- **The 8 pre-UTC-fix rows** — still there, still my recommendation to leave
  them. `platform db:timestamps` reports them.
- **Files, gift cards, discounts, markets** — each blocked on a decision rather
  than on effort. `PLAN/03 §5.1` now records which decision.
- **Blogs**: default blog per store, or a screen to manage them?
