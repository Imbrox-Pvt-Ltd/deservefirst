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

_Appended as blocks complete._
