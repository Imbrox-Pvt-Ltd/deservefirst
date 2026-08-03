# imbrox — reuse assessment

> Path: `/Users/isk/ISK/www/PROJECTS/AI/WORK/WILLIAM/imbrox` · 1.5 GB · git repo, branch work from
> `codex/tenant-isolation-feature` · latest commits *"Phase 1: adopt Polaris app frame in web"*,
> *"Phase 1: add tenant-scoped blog module"*. Surveyed 2026-08-03.

## Headline

**imbrox is not reference material — it is a working, ~52k-LOC implementation of most of the DESERVEFIRST
kernel, and its isolation layer is better than anything the spec has yet produced on paper.** The
question is not "is anything useful here" but "which parts do we port, and do we accept its stack
choices or re-decide them."

Its own `SHOPIFY-PARITY-ROADMAP.md` self-assesses the base at **70–80% built**. Having read the code, that
is broadly honest for the *kernel*; it is generous for the *merchant surface* (the store dashboard is a
shell with unwired catalog tables).

## What is actually there

| Area | LOC | State |
|---|---|---|
| `packages/modules/identity` | 23,168 | auth, 2FA (authenticator/SMS/email), sessions, lockout, rate-limit guards, tenant-session resolution, access evaluator, store lifecycle, plans, usage metering, feature flags, support sessions, platform settings, AI provider routing |
| `apps/api/src` | 14,398 | Nest app, RLS context, shard routing + shard-aware stores, runtime outbox (deliver/relay/replay), retention & archival, health, metrics, runtime diagnostics, structured logging, OTel, graceful shutdown, startup validation |
| `apps/web/components` | 14,862 | auth / dashboard / store component trees |
| `packages/modules/ai-gateway` | 6,168 | tenant-scoped AI execution hub, quota, queue dispatch |
| `packages/modules/image-generation` | 4,196 | batches, batch items, CSV upload, provider adapters, execution policy |
| `packages/modules/figma-converter` | 2,675 | + a separate `-contracts` package (correct pattern) |
| `packages/ui` | 1,712 | 24 primitives + brand logo, dashboard/auth/settings shells |
| `packages/modules/blog` | 959 | the newest module — the de-facto template |
| `packages/modules/module-registry` | 460 | runtime plugin contract + registry store |
| `apps/api/tests` | 25 files | incl. `postgres-rls.e2e`, shard-routing, outbox, diagnostics |
| migrations | 39 | TypeORM, timestamped |

Plus: `k8s/` (api, web, config, monitoring), `infra/terraform`, `.github/workflows/ci.yml`, and a real
`ci:validate` script chaining build → `tsc --noEmit` → tests, with separate smoke commands for RLS,
multi-shard routing, runtime diagnostics, infra preflight, production rollout, and perf.

## Port as-is — high value, hard to rebuild

1. **Tenant isolation.** `identity/src/tenant-session.service.ts` resolves the tenant from custom domain
   or subdomain, cross-checks it against `session.tenantId`, and **hard-fails 403 + writes a critical
   audit event on mismatch**, returning an immutable context `{storeId, organizationId, userId, userType,
   accessType, role, permissionScopes, supportSessionId, topology}`. This is spec §5.1 + §5.6 already
   built, and built more defensively than the spec describes.
2. **Postgres RLS.** Migration `1773874200000-add-postgres-tenant-rls.ts` covers 11 tenant tables;
   `postgres-rls-context.ts` injects context via a TypeORM QueryRunner patch;
   `database-isolation.service.ts` validates at startup that the DB role lacks `BYPASSRLS`. Plus an e2e
   test and a standalone smoke script. **Spec §20.1 asks for a fitness test proving store A cannot read
   store B — it exists here.**
3. **Multi-shard routing.** `SHA256(storeId) % N`, shard-aware store services, a remote connection pool,
   and a smoke test. This is spec §11 Stage 3 machinery, present at Stage 1 — the seam is real, not
   aspirational.
4. **Runtime outbox.** `runtime-outbox-{service,delivery,relay,replay}.ts` with leases, retry, cross-shard
   relay, ack columns and a replay CLI. The roadmap's own best insight: **extending this from internal
   relay to external HTTP delivery is how we get webhooks nearly free** (spec §31.9).
5. **Usage metering + plan entitlements + feature flags.** Reservation on queue, consumption on success,
   release on terminal failure; plan limit → feature default → unlimited. This is spec §5.3 + §36.2
   (flags ≠ entitlements) already separated correctly.
6. **Scoped support sessions.** Time-bound, explicitly enumerated permissions, **no wildcards**, dual
   actor+tenant mismatch checks. Spec §28.3 demands exactly this and has no design for it.
7. **Ops scripts + CI shape.** `ci:validate`, the smoke scripts, k8s manifests, terraform. Keep the shape
   even if code changes.
8. **`docs/system-contracts.md`.** A genuinely good frozen-contract document (boundary, request context,
   permission, execution, storage `store-{id}/…`, cache `store:{id}:…`, audit, usage metering). **Adopt it
   verbatim as our contracts baseline** — it is more concrete than the spec's equivalents.

## Port with rework

| Piece | Problem | Rework |
|---|---|---|
| **Module layout** | flat (`blog.controller.ts`, `blog.service.ts`, `entities/`, `dto/`) | restructure to the Module Standard: `domain/ application/ infrastructure/ api/ events/ contracts/ config/ tests/`. Mechanical but touches every module. |
| **Module definition** | `blog.definition.ts` declares key, label, navigationPath, settingsPath, permissions, settings (scope/kind/managedBy), usageFeatures, events, lifecycle, defaultRolePermissions — a genuinely good start | extend to the full manifest (§31.2): entities, migrations, **resources**, routes, navigation, **webhooks, jobs, searchProviders, commands, notifications, integrations, dashboards, ai**, typed `dependsOn`, and **capability contracts** that fail the boot loudly (§31.7) |
| **`packages/ui`** | 24 hand-rolled primitives *and* Polaris 13.9.5 now both present | pick one. Spec §8.1 says Polaris re-themed with brand tokens. Keep `packages/ui` as the *templates* layer (ListScreen/DetailScreen/CreateScreen/SettingsScreen) over Polaris; retire the duplicate primitives. |
| **Roles** | 4 fixed roles (owner / org_admin / store_user_admin / member) + org permission keys | add **role categories**, custom roles, aggregated permission summary, approval primitive (see `01-…§4.6`) |
| **Store settings** | one flat `/store/{handle}/settings` page | expand to the 19-section tree in `01-…§3.5`, rendered as an overlay with real URLs |

## Conflicts with the spec — decide before writing code

imbrox has already *made* four of the seven decisions the architecture spec §10 lists as open. They do
not all match the spec's recommendation.

| §10 decision | Spec recommends | imbrox already is | Note |
|---|---|---|---|
| Backend | NestJS / TypeScript | **NestJS 11 + Fastify** | agree — no conflict |
| Frontend | **Remix** (parity choice) | **Next.js 15 + React 19** | real conflict. Next.js works; the spec's Remix argument is nested-routing ergonomics for modals-as-routes. Next.js App Router does parallel/intercepting routes, which covers it. **Recommend keeping Next.js** — rewriting 15k LOC of components to chase parity ergonomics is not worth it. |
| Design system | Polaris re-themed | **Polaris 13.9.5 + polaris-icons already installed** | agree — already done |
| Admin API | **GraphQL-first**, REST thin | **REST only** (Nest + Swagger via `api-docs`) | real conflict, and the expensive one. See below. |
| ORM | Drizzle or Prisma | **TypeORM 0.3** | TypeORM is the weakest link (migration ergonomics, typing) but 39 migrations and the RLS QueryRunner patch depend on it. **Recommend keeping TypeORM** for v1; revisit only if it blocks. |
| Auth start | managed then self-host behind adapter | **hand-rolled inside `identity`** | conflict with spec §4.1 ("do not hand-roll"). It is already written and has 2FA + lockout + rate limiting. **Recommend: keep it, but put it behind the `AuthProvider` interface** so the option to swap survives. |
| Tenant addressing | path-based `/store/{handle}` | **`/store/[storeHandle]`** | agree — already done |

**On GraphQL.** The spec's §13.1 golden rule (all logic in the service layer; transports are thin
adapters) is what makes this cheap *later*. imbrox already respects that shape. So: **do not stop to add
GraphQL now.** Keep REST as the working transport, hold the service-layer discipline, and add the GraphQL
transport over the same services when the app platform (Phase 5) needs it — at which point it is additive,
not a rewrite. Record this as an ADR.

## What is missing entirely

- **Partner actor** — no partner org, no partner user type, no dev-store creation, no ownership transfer.
  The roadmap correctly flags this as the biggest structural gap.
- **App platform** — no app registry, no OAuth for third parties, no app scopes, no outbound webhooks, no
  app admin UI on either side. Backbone ~40% (the outbox), external 0%.
- **Catalog / commerce** — products, collections, customers, inventory, orders exist only as unwired
  scaffold tables. Everything in `01-…§4.1–4.4` is unbuilt.
- **Entity Toolkit** — no metafields, metaobjects, tags, timeline, saved views, bulk editor, import/export,
  soft-delete as a shared base. This is the single highest-leverage thing to build, because every screen
  in the reference map depends on it.
- **i18n primitives** — no Money value object, no translation store, no locale resolution chain.
- **Dev dashboard** — no equivalent surface at all.
- **Agentic / AI-discoverability** — nothing.

## Recommendation

**Do not start DESERVEFIRST from an empty directory, and do not build inside imbrox either.**

Create the DESERVEFIRST monorepo fresh to the Module Standard, then **port** the eight "as-is" items above
into it as the first commits — they arrive as a hardened kernel rather than as legacy. Treat imbrox as a
read-only donor: copy files, adapt to the layered layout, keep the tests that come with them.

Rationale: imbrox's *foundations* are excellent and expensive to recreate, but its *structure* violates the
one rule the whole spec is built around (§14.1 — fixed folders, layer law, manifest-or-it-doesn't-load).
Retrofitting the Module Standard onto a live 52k-LOC tree while also building the entire merchant surface
is two hard jobs entangled. Porting is one hard job, and it makes the standard true from commit #1 — which
is the entire point of §14.2's fitness functions.

Concretely, the port order is Phase 0 in `03-master-build-plan.md`.
