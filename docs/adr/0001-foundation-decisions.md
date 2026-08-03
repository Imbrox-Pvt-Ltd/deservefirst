# ADR 0001 — Foundation decisions (D1–D10)

**Status:** accepted · **Date:** 2026-08-04 · **Supersedes:** architecture spec §10 "open decisions"

## Context

The architecture spec left seven decisions open before code. A survey of the donor
codebase (`PLAN/02`) found four of them already answered in a working ~52k-LOC
implementation, and the reference-product capture (`PLAN/01`) surfaced three more that
the spec had not considered. Deciding them together, once, is cheaper than
rediscovering each one mid-phase.

## Decisions

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| D1 | Frontend framework | **Next.js 15 App Router** | The spec recommended Remix for nested-routing ergonomics (modals as routes). App Router's parallel and intercepting routes cover that, and ~15k LOC of components already exist. Rewriting them to chase parity ergonomics buys nothing a user can see. |
| D2 | Design system | **Polaris + brand tokens**; `packages/ui` holds templates only | Already installed in the donor tree. Keeping a second hand-rolled primitive set would mean two systems drifting apart. |
| D3 | Admin API | **REST now; GraphQL later over the same services** | §13.1 keeps all logic in the service layer, which makes adding a transport additive rather than a rewrite. Building GraphQL first would delay every screen for a benefit no merchant sees until the app platform exists (Phase 4). |
| D4 | ORM | **TypeORM** for v1 | Weakest of the choices on ergonomics, but 39 migrations and the RLS QueryRunner patch depend on it. Revisit only if it blocks. |
| D5 | Auth | **Own implementation, behind an `AuthProvider` interface** | Contradicts §4.1 ("do not hand-roll"). Accepted because a tested implementation with 2FA, lockout and rate limiting already exists; the interface preserves the exit. **Requires an independent security review before external tenants onboard.** |
| D6 | Tenant addressing | **`admin.<host>/store/{handle}`** | Path-based, matching both the spec and the reference product. |
| D7 | Production database | **Postgres only** | RLS is the isolation guarantee. A MySQL/SQLite fallback would be a path where the guarantee silently does not apply — a hole, not a fallback. |
| D8 | Scope model | **Person / Organization / Business entity / Store / Partner** | The spec models three. The capture shows five; the missing **business entity** (a legal entity per country) owns tax and invoicing identity, and retrofitting it after billing exists would be expensive. |
| D9 | Developer surface | **A separate `dev.<host>` dashboard** | The reference product split app development out of the partner dashboard. App developers and agencies are different audiences with different auth needs. |
| D10 | Commerce depth | **Phase-1 request/RFQ only** | Per §25: checkout, payment, shipping rates and tax light up together, so "checkout without payment" is just the RFQ flow wearing a costume. Defers the regulated parts while the wedge still works. |

## Consequences

- The spec's §10 is now closed. Any change to D1–D10 needs a superseding ADR, not a
  side conversation.
- D5 carries an open obligation: schedule the security review before the first external
  tenant.
- D3 means the public GraphQL schema does not exist until Phase 4. The service layer
  must stay transport-agnostic in the meantime or D3's cheapness evaporates — this is
  what the `layer-law` fitness function protects.
- D8 changes the identity schema relative to spec §4.2. `BusinessEntity` is a new table
  with its own lifecycle, not a renamed column.
