# ADR 0002 — MySQL/MariaDB as the interim database

**Status:** accepted · **Date:** 2026-08-04 · **Amends:** ADR 0001 D7 (Postgres only)

## Context

ADR 0001 D7 chose Postgres exclusively, on the grounds that row-level security is the
tenant isolation guarantee and a driver without it is a hole rather than a fallback.

The available database is MariaDB 11.7 (`deservefirst_db`), and development needs to
proceed now; Postgres will be stood up later.

**MySQL and MariaDB have no row-level security.** There is no server-side mechanism
that constrains a query to one tenant. On Postgres, a repository that forgets
`WHERE store_id = …` returns nothing, because the policy filters it. On MySQL the same
query returns every tenant's rows. This is not a performance difference or an
ergonomics difference — it removes the platform's primary isolation control.

## Decision

Support MySQL/MariaDB as an **interim** database, with a compensating control, and keep
the Postgres path intact so the move back is configuration rather than a rewrite.

1. **A SQL dialect abstraction** (`core/list-engine/dialect.ts`) isolates every
   difference: placeholder style, case-insensitive comparison, identifier quoting,
   count casts. Nothing else in the codebase branches on database.
2. **A query guard** (`core/tenant-context/query-guard.ts`) inspects every statement
   before execution and refuses any that touches a store-scoped table without a
   `store_id` predicate. It **fails closed**: a statement it cannot prove safe is
   rejected. It is applied at the executor, so no repository can bypass it.
3. **The guard is enforcing on MySQL and reporting-only on Postgres**, where RLS is
   already the backstop and a false positive would block correct code for no gain.
4. Integration tests assert the boundary holds under the interim database, including a
   test that deliberately runs an unguarded cross-tenant query to prove the guard is
   load-bearing rather than decorative.

## Consequences

- **Isolation is now enforced by application code plus a guard, not by the database.**
  That is materially weaker. A bug in the guard, or a query shape it cannot parse
  correctly, is a cross-tenant read. The guard is a mitigation, not an equivalent.
- **No external tenants on the interim database.** The guarantee this platform sells is
  isolation; until Postgres and RLS are in place, the honest posture is that isolation
  is enforced best-effort. This should gate onboarding, not just be noted.
- The dialect layer costs little and pays for itself twice: it made the interim
  possible and it makes the return trivial.
- `platform db:sync` applies the manifest-derived schema on MySQL. It is additive-only
  and for development; production uses versioned expand → migrate → contract
  migrations (§17.2).

## Migration back to Postgres

1. Point `DATABASE_URL` at Postgres. The dialect is selected from the URL scheme.
2. Run the Postgres migrations, including the RLS policies (the Phase 0 port already
   contains the context injection and the startup `BYPASSRLS` validation).
3. Flip the guard to reporting-only for Postgres — already the default behaviour.
4. Re-run the integration suite; the isolation tests are dialect-agnostic.

Nothing in `domain/`, `application/` or `api/` changes.

## What execution against a real database caught

These are recorded because they are the argument for integration tests over
shape-only tests. All three passed unit tests and failed on first contact with MariaDB:

- The query compiler projected `money` as one column while the schema builder created
  two — SQL naming a column that did not exist. Fixed by a single shared column mapping
  both now read.
- Free-text search bound one parameter and emitted four `?` placeholders. Valid on
  Postgres, where `$5` can repeat; an arity error on MySQL.
- The optimistic-concurrency check re-read the row to decide whether its versioned
  UPDATE matched. By then the winning writer had already stored the version the loser
  expected, so the losing write reported success and was silently discarded. Now the
  driver's `affectedRows` answers it.
