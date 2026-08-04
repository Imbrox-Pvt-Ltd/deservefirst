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

