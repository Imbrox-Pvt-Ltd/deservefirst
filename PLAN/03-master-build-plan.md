# DeserveFirst — Master Build Plan (v1)

> Companion documents: `01-reference-url-and-screen-map.md` (what to build, screen by screen, URL by URL)
> and `02-imbrox-reuse-assessment.md` (what to port). The architecture spec
> `REQUIREMENT/platform_architecture_core_auth.md` remains the *reference*; the module author guide remains
> the *golden path*. **This file is the sequence.**

---

## 0. The four inputs, reconciled

| Input | Role | Standing |
|---|---|---|
| `platform_architecture_core_auth.md` (§0–§36) | the architecture law | authoritative on *structure*; behind on *feature surface* (Spring '26) |
| `module_author_guide.md` | the golden path per module | authoritative, unchanged |
| `PLAN/01-…` (video + HTML + URLs) | the target product surface | authoritative on *what screens and URLs exist* |
| `imbrox` | a working kernel | donor code; not the destination |

Where they disagree: **structure follows the spec, surface follows the reference map, code comes from
imbrox where it exists.**

---

## 1. Decisions to lock before commit #1

Seven of these are the spec's own §10 list; four are already answered by imbrox, and three are new from
the capture. **Nothing below is a research task — each needs a yes/no.**

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Frontend framework | **Next.js 15 App Router** (not Remix) | 15k LOC of components already exist; parallel/intercepting routes cover modals-as-routes |
| D2 | Design system | **Polaris + brand tokens**, `packages/ui` = templates only | already installed; retire the duplicate hand-rolled primitives |
| D3 | Admin API | **REST now, GraphQL later over the same services** | §13.1 makes it additive; adding GraphQL now delays every screen |
| D4 | ORM | **TypeORM** for v1 | 39 migrations + the RLS QueryRunner patch depend on it |
| D5 | Auth | **keep imbrox's identity**, but behind an `AuthProvider` interface | already has 2FA, lockout, rate limiting; the interface preserves §4.1's exit |
| D6 | Tenant addressing | **`admin.<host>/store/{handle}`** | matches both spec and imbrox |
| D7 | Production DB | **Postgres only** (no MySQL/SQLite fallback in prod) | RLS is the isolation guarantee; a fallback path without it is a hole |
| D8 | **Scope model** | adopt **Person / Organization / Business entity / Store / Partner** | the capture shows five; our §4.2 has three |
| D9 | **Dev surface** | ship a **separate `dev.<host>` dashboard** for apps + dev stores | the reference product split app dev out of partners; different audience, different auth |
| D10 | **Commerce depth** | Phase-1 **request/RFQ only**, per spec §25 | defers checkout/payment/tax; the food/perishable wedge still works |

D8, D9 and D10 change the data model. Settle them first.

---

## 2. Phase 0 — Foundation port (2–3 weeks)

**Goal: an empty-but-hardened monorepo where the Module Standard is already enforced by CI.**

1. Scaffold the repo to §3 / §14.1 exactly:
   ```
   apps/api  apps/web
   packages/ui  packages/contracts  packages/config
   apps/api/src/core/{tenant-context,module-registry,entitlements,event-bus,cache,rate-limit,adapters,observability,http}
   apps/api/src/auth
   apps/api/src/modules/<name>/{domain,application,infrastructure,api,events,contracts,config,tests}
   ```
2. **Write the fitness functions before the code they police** (§14.2). Day-one set: cross-module import
   ban, layer law, manifest validity, tenant-scope-on-every-query, file-header presence, competitor-name
   lint, no hardcoded brand string. A rule a test enforces beats a rule in a doc.
3. Port from imbrox, in this order, each adapted to the layered layout and arriving with its tests:
   1. `docs/system-contracts.md` → `docs/contracts.md`, adopted verbatim as the baseline
   2. tenant-session service + request-context guard → `core/tenant-context`
   3. Postgres RLS migration + QueryRunner context patch + startup `BYPASSRLS` validation + the RLS e2e
      test and smoke script
   4. shard routing + shard-aware store services
   5. runtime outbox (service, delivery, relay, replay) + replay CLI
   6. usage metering, plan entitlements, feature flags → `core/entitlements`
   7. scoped support sessions + append-only audit
   8. health, metrics, runtime diagnostics, structured logger, OTel, graceful shutdown
   9. `ci:validate` + the five smoke scripts + k8s + terraform
4. Stand up the `platform` CLI skeleton (§18) with `module:new`, `gen:entity`, `check`, `doctor`. **The CLI
   is what makes the standard survive contact with agents** — it is not a nice-to-have for later.

**Exit criterion:** `platform check` green, RLS + shard smoke green, and `platform module:new demo`
produces a module that boots, registers, and passes every fitness function.

---

## 3. Phase 1 — Entity Toolkit + Core kernel (4–6 weeks)

**This is the highest-leverage phase in the whole plan.** Every screen in `01-…§4` is a projection of the
toolkit. Build it once, or build it forty times.

Deliver §12.1 in full, as a base every entity inherits by declaration:
- global ID (`gid://app/<Entity>/<id>`) + handle/slug + timestamps + **soft delete/restore**
- **metafields** (typed, namespaced, with definitions and validation) — and the generic
  `/settings/custom_data/{entity}/metafields` UI that goes with them
- **metaobjects** (definitions + entries)
- tags · timeline/comments · audit trail
- **the list engine (§12.6)**: filter-token search, filters UI, saved views, sort, cursor pagination,
  column customisation, bulk selection — with the exact URL encoding captured in `01-…§3.4`:
  `?savedViewId=&query=&order=&selectedColumns=`
- **the generic bulk editor route** `/bulk/{entity}?resource_name=&edit=&return_to=`
- import/export (CSV per entity) · draft/published status
- **i18n primitives** (§15.2), non-negotiable and cheap now, agonising later: UTC `timestamptz`
  everywhere, `Money{amount_minor, currency}` value object, BCP-47 locale, `translatable` field
  declaration + translation store keyed `(tenant, resource_type, resource_id, field, locale)`
- **SEO capability** (§34): SEO metafields, sitemap participation, JSON-LD, 301 redirect on slug change

Alongside, finish Core: cache with tag invalidation, central rate limiter, adapter set (Storage, Email,
Queue, Search, Auth), event bus with versioned typed events, and the module registry reading the **full
manifest** with **capability contracts that fail boot loudly** (§31.7).

Then extend the four screen templates (§8.3) over Polaris — ListScreen, DetailScreen, CreateScreen,
SettingsScreen — so they consume the toolkit generically. Prove with one thin entity end to end.

**Exit criterion:** a generated entity gets list + detail + create + settings + metafields + saved views +
bulk edit + CSV + SEO + translations **without a line of bespoke UI**.

---

## 4. Phase 2 — Identity, org & scope model (3–4 weeks)

Extend imbrox's identity to the five-scope model (D8):

- **Person** — port as-is, then add the missing screens from `01-…§3.1`: 2FA enrolment UI, sessions/devices
  list with per-device revoke, backup/recovery codes, security keys/passkeys, secondary email,
  temporary login code.
- **Organization** — new settings scope: org details, users, **roles**, security policy, store list.
- **Business entity** — new entity: legal entity per country, typed, active/archived, referenced by stores.
  This is a *new table*, not a rename — do it now, before billing and tax exist.
- **Store (tenant)** — store lifecycle, types `live | dev | client_transfer | password_protected`,
  per-store **feature previews** with release notes.
- **Roles** — upgrade from 4 fixed roles to: **role category** (Organization / Store / POS / Partner) →
  category-scoped permission tree → custom roles → aggregated **permission summary** on the user screen →
  **approval primitive** (approve another actor's action).
- Login chain with a **`rid` correlation id** threaded through lookup → login → 2FA → landing, and
  `returnPath` round-tripping (`01-…§3.2`).

**Exit criterion:** a user with memberships in two stores across two business entities in one org can log
in once, switch stores, and the isolation e2e test proves store A's data is unreachable from store B.

---

## 5. Phase 3 — The merchant surface (8–12 weeks)

Build the store admin against `01-…§3.4`, `§3.5` and `§4`. Order matters: nav shell → settings → catalog →
orders, because settings and catalog are what every later module extends.

1. **App shell** — left nav exactly as captured (Home · Orders · Products · Customers · Growth ·
   Discounts · Content · Markets · Finance · Analytics · Sales channels · Apps · Add · Settings), with
   module-driven registration so enabling a module adds its nav entry (§8.2).
2. **Settings overlay** — the 19-section tree, rendered as an overlay over the admin with real,
   deep-linkable URLs. Schema-driven from module manifests (§31.9) so modules contribute into shared
   groups rather than adding pages.
3. **Catalog module** — the first real product module and the proof of the template. Products (with
   variants, media, taxonomy category + **category metafields**, pricing with cost/profit/margin,
   inventory per location, shipping attributes, purchase options, SEO listing, publishing to channels and
   markets, theme template), Collections (manual + automated conditions **+ exclusions**), Inventory,
   Purchase orders, Transfers, Gift cards.
4. **Customers** — customers, segments, **Companies (B2B)**.
5. **Orders / RFQ** — per D10, Phase-1 commerce is **request-only**: draft orders, the Request/RFQ object,
   invoices, share-link, order detail with timeline. No checkout, no payment, no tax engine.
6. **Content** — pages, blogs, metaobjects, navigation.
7. **Home / Growth / Finance / Analytics** — dashboards composed from module-contributed widgets (§31.2
   `dashboards`, `metrics`).

**Exit criterion:** the reference map's `§3.4` URL list resolves end to end in our admin, with all view
state in the URL and the §24.5 fitness functions green (no orphan routes, no collisions, list state read
from the URL, no sensitive params).

---

## 6. Phase 4 — Distribution: partner, dev dashboard, app platform (8–12 weeks)

The biggest structural gap in imbrox, and the thing that turns a product into a platform.

1. **Partner org + partner user** — new top-level actor (not a flag on organization), reusing the existing
   membership/invite machinery. Panels per `01-…§3.7`: overview, stores, **leads**, **referral history**,
   **payouts**, apps, **partner API clients**, CLI token.
2. **Dev dashboard** (`dev.<host>`, D9) — apps, dev stores (`?store_type=dev|client_transfer`), catalogs.
3. **App platform:**
   - app registry + install/uninstall lifecycle + per-store install records
   - **OAuth 2.0** authorization-code for third-party apps, **online and offline** token types (§23.2)
   - **app scopes** distinct from staff scopes, grouped `API family → feature → scope`, with
     **per-scope access gating** ("request access") as captured
   - **outbound webhooks** — extend the ported outbox to external HTTP with HMAC signing, retry, replay,
     DLQ; then add **Pub/Sub** and **EventBridge** delivery targets (`01-…§3.6`)
   - **app versions** with a dated webhooks API version, app URLs, embed-in-admin, app proxy, POS embed
   - **app monitoring**: `/monitoring/api_health` with **deprecated-call surfacing**, plus the log taxonomy
     (webhook · function · app event · billing event · GraphQL · REST · UI-extension error · assistant event)
   - **app automation tokens** for CI/CD
   - **app/merchant billing API** so apps can charge merchants through us (§23.2)
4. **Execution tiers** (§22) — UI extensions in a sandboxed runtime on their own tier; Functions as WASM on
   a separate tier. Never third-party code in the core process.
5. **Public versioned API + generated reference** (§26.2) with a **GraphiQL-style explorer** bound to an
   API client, dated — as the partner API does.

**Exit criterion:** a third party can register an app, request scopes, install it on a store via OAuth,
receive a signed webhook, and see its own logs and API-health page.

---

## 7. Phase 5 — Agentic & AI surface (scope to be decided)

Not in the spec at all; see `01-…§5`. Decide deliberately rather than by deferral.

- **Machine-readable catalog + policies** for AI agents; a `Catalog` source and a `Knowledge Base` source.
- **Per-agent channel consent** (per-provider toggles + a master "manage for me").
- **Agent-discoverability as a first-class capability** alongside SEO (§34) — the manifest already reserves
  the `ai` key (§31.2), so this slots in without rework.
- **In-admin assistant** with persistent conversations and its own event type in the log taxonomy.

Minimum viable version, if the full surface is too much: ship the *catalog access* + *policies readable by
agents* toggles and the structured product feed. That is most of the value and little of the cost.

---

## 8. Cross-cutting, from commit #1 (not a phase)

These shape code and are painful to retrofit — spec §16.2, §30, §20:

- fitness functions in CI (§14.2) — the enforcement, without which everything above erodes
- file header comments on every file (§33.2); branding from one config (§33.1); competitor-name lint (§33.3)
- Core-only sanitization/escaping/formatting (§33.4); parameterised queries only
- performance budgets + **structural** perf fitness checks (§30.7): missing index, N+1, `SELECT *`,
  unbounded query, GraphQL depth/complexity, bundle size, cache entry with no declared invalidation
- expand → migrate → contract migrations (§17.2), shard-aware, forward-only in prod
- tenant-isolation e2e test (§20.1) — already ported in Phase 0
- backups with **tested restore** (§19); secret manager; encryption at rest and in transit
- ADR per significant decision — starting with D1–D10 above

---

## 9. What we are deliberately not building

Recording these prevents them being rediscovered as "gaps" every quarter:

- **Checkout, payments, tax, inventory ops, fulfillment, returns, POS** — spec §25 phases 2–4, after RFQ
- **Multi-region, tenant sharding in production, DR drills, SRE on-call, capacity tables** — §16.3
  milestone-gated; the seams exist, the implementations wait for metrics
- **Full codegen** of REST+GraphQL+UI from schema — §13.2's own warning; add incrementally as resources
  repeat
- **A 20-registry extension engine** — §31.4; build the registries module one needs, grow the rest
- **Workflow engine, upgrade engine, package manager/marketplace** — §36.3
- **Shopify first-party analogues** (payments, capital, fulfillment network) — §23.4

---

## 10. Honest risks

1. **The Entity Toolkit is the critical path.** If Phase 1 is rushed, every screen in Phase 3 grows bespoke
   list/filter/metafield code and the "identical screens" promise dies quietly. Do not start Phase 3 until
   a generated entity gets the full toolkit for free.
2. **Porting from imbrox will tempt structural shortcuts.** The identity module is 23k LOC of flat files;
   splitting it into `domain/application/infrastructure/api` is genuinely tedious. Doing it anyway is the
   whole reason to port rather than continue in place.
3. **The reference product is a moving target.** This capture is Spring '26. Treat `01-…` as a snapshot
   with a date on it, not as a live spec; re-capture before any parity claim.
4. **Scope pressure on commerce.** D10 defers checkout. Every stakeholder conversation will push to
   un-defer it. The spec's §25.1 argument — that checkout, payment, shipping rates and tax light up
   together — is correct and worth re-reading before agreeing.
5. **imbrox's `identity` hand-rolls auth.** Spec §4.1 says do not. It already exists and is tested, so we
   keep it — but behind `AuthProvider`, and it should get an independent security review before external
   tenants onboard (its own roadmap says the same).
