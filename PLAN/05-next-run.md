# Next run — 2026-08-05

## What the review found

I went to plan the next Phase 4 items and found a live cross-tenant
authorization defect first. It changes the order of everything below.

**An ordinary merchant holds platform-wide permissions.** The seeded store owner
carries `platform.modules.manage` and `platform.settings.manage`, and can read —
and by the identical guard, write — the module state that applies to *every store
on the platform*. One merchant could disable a module for all of them.

Three independent causes, each of which alone would be a bug:

1. `platform.*` permissions are declared with `categories: ['organization']`, so
   they are grantable to an organization role at all. They should be grantable to
   nobody except a platform operator.
2. The seed grants every declared permission to the owner role indiscriminately.
   That was reasonable when every permission was store-scoped and stopped being
   reasonable the moment platform-scoped ones existed.
3. `platformGuard` checks only that the permission is present. It never checks
   the caller is a platform operator, so it has exactly the hole `requireUser`
   had last night — an app whose scopes granted a `platform.*` permission would
   pass. No scope grants one today, which is luck rather than design, and it is
   the *second* time this week that particular luck has been load-bearing.

This also resolves a question that has been deferred by an explicit trigger. The
platform-admin surface was to wait for "the first store the user does not own".
It cannot: scope approval and app suspension are operator actions, and there is
currently no such thing as an operator. **The trigger has arrived from a
direction nobody predicted — not from a new tenant, but from the platform
needing someone to answer for it.**

## Blocks

Same standing rules as the last run: every block ends green or is reverted, no
destructive database action without a decision, and each exit criterion is a
thing observed against the running server rather than a passing build.

### Block A — The operator is a real actor, and merchants are not operators

The defect above, fixed at all three causes rather than whichever one is nearest.

- `platform.*` permissions become a `platform` role category, grantable to
  nobody else.
- The seed stops granting platform permissions to a store owner, and grows a
  separate operator account that holds them.
- `platformGuard` requires `accessType: 'platform'`, not just the permission.
- A fitness rule: a permission declared `platform.*` may not appear in any
  non-platform role category. This is the class of mistake that reappears.

**Exit:** the seeded merchant is refused on every `platform/*` endpoint; a
seeded operator is allowed; an app token is refused whatever its scopes.

### Block B — Scope approval, so somebody can say yes

Restricted scopes fail closed today, which is safe and also means no app can
ever be published asking for one. The port returning `[]` is the seam.

- Operator reviews an app: sees what it asks for, approves or denies per scope,
  with a reason.
- Approval is per app and per scope, never global.

**Exit:** a partner publishes an app requesting `read_customer_contact` only
after an operator approves that scope for that app.

### Block C — App suspension

`AppStatus` has `suspended` and nothing sets it. There is no way to stop a
misbehaving app across every store at once.

- Operator suspends with a reason; every token stops on the next request.
- The merchant's app list says why it stopped rather than showing it as working.

**Exit:** a suspended app's live token is refused, and the reason is visible to
the merchants who installed it.

### Block D — Per-app rate limits

The token endpoint is limited; the API an app then calls is not, so one app can
exhaust a store's capacity.

**Exit:** a burst on an app token throttles while a merchant's own session is
unaffected.

### Block E — Sweep and handover

Same adversarial pass as last time, then update `PLAN/03` and write the report.

---

## Report

_Appended as blocks complete._
