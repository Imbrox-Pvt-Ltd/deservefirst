# Overnight run — 2026-08-05

Written before starting, executed unattended. Read the **Morning report** at the
bottom first: it is appended as work completes and is the honest record of what
actually happened, including anything that failed or was left alone.

## Standing rules for this run

1. **Every block ends green or is reverted.** `platform ci` + `platform smoke`
   before each commit. A block that cannot go green gets reverted and written up
   rather than left half-applied.
2. **Nothing destructive without a decision.** The database is not reset, dropped
   or reseeded-with-data-loss. Where a fix needs that, the tool is written with a
   dry run and left unapplied for the morning.
3. **Verify by using it, not by building it.** A green build is not a working
   feature. Each block's exit criterion is a thing observed against the running
   server, quoted in the report.
4. **When a list has failed twice, replace the list.** Recurring theme this week:
   hardcoded discovery lists (test globs, manifest paths) silently skipped real
   work. Prefer convention over enumeration.

## Why these blocks

The app platform shipped working but incomplete in ways that matter. Three of the
four items in Block 1 are things a security review would stop the release on, and
Block 2 is the difference between "the flow works" and "a merchant can use it".
Those come before any new surface area.

---

### Block 1 — OAuth hardening (the gaps a review would stop on)

The flow works and is missing three standard protections.

- **`state` round-trip.** There is no CSRF protection on the callback today. An
  attacker can start an authorization, capture their own code, and trick a
  merchant into completing it against the attacker's account. `state` must be
  accepted, stored with the code, and returned on redirect.
- **PKCE (S256).** A public client — anything with its secret in a browser or a
  binary — can have its code intercepted and spent. `code_challenge` at
  authorize, `code_verifier` at exchange, verified.
- **Restricted-scope gating.** `read_customer_contact` is *marked* restricted and
  nothing stops an app being published that requests it. The mark is currently
  decoration.
- **Rate limiting on `/oauth/token`.** Credential stuffing against client secrets
  is otherwise unbounded.

**Exit:** each protection demonstrated failing correctly against the running
server — a wrong `state`, a wrong verifier, a restricted publish, a burst.

### Block 2 — The install a merchant can actually complete

The authorize endpoint returns JSON. There is no screen, so no merchant can
install anything through a browser; the flow has only ever been driven by curl.

- A consent screen at a real, deep-linkable URL showing the app, its scopes in
  plain words, and the sensitive ones marked.
- Approve → redirect to the app's callback with code and state.
- Deny → redirect with `error=access_denied`, which is a real outcome and not an
  error page.
- Added to the smoke walk.

**Exit:** the full round trip driven through the web app, not the API.

### Block 3 — Apps find out what happened to them

`apps.app.uninstalled` is emitted into the bus and reaches nobody. An app whose
access was revoked keeps trying until it gets a 401, which is a bad way to learn.

- App-owned webhook subscriptions, delivered through the existing outbox.
- The uninstall and scope-change events actually delivered and signed.

**Exit:** a live receiver observes a signed uninstall webhook.

### Block 4 — Timestamp remediation, offered not applied

164 rows still carry local-time `created_at` from before the UTC fix. A reseed
clears it and also destroys anything created by hand, so this run does not do it.

- `platform db:timestamps` reports exactly which tables and rows are affected and
  what it would change. Dry run is the default and the only thing run tonight.

**Exit:** the report exists and is quoted in the morning report. No rows changed.

### Block 5 — Adversarial sweep

Deliberately looking for the class of defect that has kept surfacing: verification
that silently checks nothing, permissions declared but never granted, screens that
exist but are walked by nothing, enumerated lists that should be discovery.

**Exit:** each finding either fixed with a test, or written up with the reason it
was left.

### Block 6 — Status and handover

`PLAN/03-master-build-plan.md` is out of date on what is actually built. Bring it
in line with reality and write the morning report.

---

## Morning report

Six blocks planned, six done. Every block ends with `platform ci` green and a
thing observed against the running server, quoted below. Nothing was left
half-applied and no data was destroyed.

**Commits, newest first**

```
e792c44 An app is never the person, however it got its token
231784d Report pre-UTC-fix timestamps, and do not repair them
05c05aa Apps are told when they are uninstalled, instead of finding out from a 401
cef5666 The consent screen: a merchant can now install an app in a browser
072954b OAuth hardening: state, PKCE, restricted scopes, and a real rate limit
07bd11c The app platform: a third party can install software into a store
```

### The one that matters: a live privilege escalation, found and closed

The sweep in Block 5 found that **an app could act as the person who installed
it**. An online app token carries the user id of whoever authorised it, so a
gate written as `userId !== null` was true for an app. An app holding nothing
but `read_products` listed that person's partner accounts and created a new one
as them. I reproduced it against the running server, fixed it, and confirmed the
same two calls now return 403 while the app's legitimate catalogue access still
returns 200. The partner the exploit created has been deleted.

Scope mapping happened to prevent the worst version — no scope grants
`store.apps.manage`, so an app could not consent on its own behalf. That is luck
rather than design and would evaporate the first time somebody writes a scope
that grants it.

### What each block delivered

**Block 1 — OAuth hardening.** `state` was being dropped entirely, so an app
could not tell its own authorization from one an attacker started. PKCE added,
S256 only. Restricted scopes were decoration and now gate publishing. The token
endpoint — the one place a client secret is presented — was unrate-limited.
Proved: a wrong verifier refused, a *missing* verifier refused, and then the real
client spending the same code successfully, because the check runs before the
code is claimed and a failed attack must not deny service to the app it targeted.

**Block 2 — The consent screen.** The flow had never been completed by a human;
every install to date was curl. Scopes now read as sentences about the merchant's
own data rather than `read_customer_contact`. Declining redirects to the app with
`access_denied`, because an app that never hears back cannot tell "declined" from
"closed the tab" and will ask again. Proved end to end against a real callback
server: `state: browser-state-42, code present: True`, then a token carrying
exactly the two approved scopes.

**Block 3 — Apps are told they were uninstalled.** They previously found out from
a 401, which is indistinguishable from an outage. This exposed a leak worth more
than the feature: deliveries matched on store and event type alone, so with two
apps on one store each would have received the other's lifecycle events — app A
told, with an id, that app B had just been uninstalled. Also found: POST
/oauth/authorize resolved the request context but never entered it, so every
store-scoped write in the install hit the tenant guard.

**Block 4 — Timestamps, reported not repaired.** `platform db:timestamps` is
read-only with no flag to make it otherwise, because the correct offset is not
recoverable from the data. **The number is now 8 of 303 rows, down from 164** —
reseeds during this week's work recreated most of them. What is left is 3
sessions, 3 login flows and 2 timeline rows. **My recommendation is to leave it.**
Nothing was changed.

**Block 5 — The sweep.** The escalation above, plus two more enumeration lists
replaced with discovery: `typecheck` ran a hardcoded array of five projects, and
nothing verified that a manifest on disk is actually registered — a module whose
manifest exists but is never loaded looks exactly like one nobody has written.

**Block 6 — Handover.** `PLAN/03` Phase 4 rewritten against reality, with a new
section listing what the app platform still needs before it is safe to open to
strangers.

### The pattern worth naming

Five separate times this week, a hardcoded list silently skipped real work: test
globs excluded auth's tests, then excluded apps' 12 OAuth tests while CI stayed
green; manifest paths excluded the app tables; typecheck excluded any new
package; `apps/web/tests` was in no glob at all. Every one failed *quietly* and
in the direction of doing less. All are now discovery by convention, and
`manifests-are-registered` fails the build on the remaining case.

If one rule survives from this week, it is: **when a list has failed twice,
replace the list.**

### Numbers

| | before | after |
|---|---|---|
| tests | 391 | 406 |
| fitness rules | 19 | 20 |
| smoke destinations | 59 | 60 |
| API operations documented | 102 | 102 |

### What I would do next, in order

1. **Scope approval workflow.** Restricted scopes fail closed, so no app can be
   published asking for one. Somebody has to be able to say yes.
2. **App suspension.** The status exists and nothing sets it — there is no way
   to stop a misbehaving app across every store at once.
3. **Per-app rate limits** on the API an app calls, not just on the token endpoint.
4. **The dev dashboard and dev stores**, which is the remaining Phase 4 item with
   nothing built.

### Open decisions for you

- **The 8 timestamp rows** — leave them, or reseed and lose hand-created records.
  I recommend leaving them.
- **Platform-admin UI** remains deferred by its explicit trigger: the first store
  you do not own. Partners can now create stores, so that trigger is closer than
  it was.

