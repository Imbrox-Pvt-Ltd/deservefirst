# Module Author Guide — building a module on the platform (DeserveFirst)

> The practical companion to the architecture spec. If the spec is the *reference*, this is the *golden path*: the exact steps to add a module. The CLI scaffolds the structure and CI enforces it, so you (or an AI agent) only write **domain logic**, never boilerplate or architecture decisions.
>
> **Stack:** TypeScript / NestJS · Nx monorepo · PostgreSQL + Drizzle (or Prisma) · Remix + Polaris · GraphQL-first.

## Who this is for
Any developer or AI coding agent adding a module. No platform-internals knowledge needed beyond this guide plus a few spec sections: the **Module Standard (§14.1)**, the **Entity Toolkit (§12.1)**, the **manifest/capabilities (§31)**, **i18n (§15)**, and **code standards (§33)**.

## Prerequisites
- Repo cloned; `platform` CLI on PATH; `platform dev` runs.
- Skim §14.1 (folder + layer law), §12.1 (what every entity inherits), §31.2/§31.7 (manifest + capabilities).

---

## The golden path

**Step 0 — Design (before you scaffold).** Answer four questions first, so the module aligns with the domain model before any code is generated: **Bounded context** (what business area?), **Aggregates** (roots + boundaries), **Capabilities** (entities, settings, search, jobs, ai…), **Events** (what it emits/consumes). Only then run `module:new`.

1. **Scaffold** — `platform module:new <name>`. Creates the full skeleton (`domain/ application/ infrastructure/ api/ events/ contracts/ config/ tests/`), a valid **manifest**, a sample entity, tests, README, and **file-header comments (§33.2)** on every file.
2. **Define the domain (DDD)** — in the README, write the **ubiquitous language** and the **aggregate(s)** with their roots (§14.3).
3. **Generate entities** — `platform gen:entity <name> <Entity>`. Wires the **Entity Toolkit** (metafields, metaobjects, tags, timeline, audit, saved-views/search) **plus i18n (translatable fields, Money, UTC)** + CRUD service + GraphQL/REST + List/Detail screens + a fluent migration (§35.1).
4. **Write domain logic** — fill `domain/` (pure) and `application/` (use-cases). **No logic in `api/`.** Use **Core shared services** (DateTime, Money, translation, formatting/sanitization) — never re-implement them (§32, §33.4).
5. **Declare the manifest** — capabilities + their **contracts**, resources, routes + navigation, **schema-driven settings** (into shared groups), permissions, versioned events, webhooks, **jobs** (central scheduler §35.4), searchProviders, commands, notifications, integrations, dashboards, the **SEO capability** (§34.5) for public content, and **typed `dependsOn`** (§31.9). *If it isn't declared, the platform won't load it* — and a missing capability-contract piece **fails the build** (§31.7).
6. **Migrations** — `platform gen:migration` (fluent DSL, §35.1), following **expand → migrate → contract** (§17.2).
7. **API** — GraphQL + REST are generated from resources (§13.2); set **visibility** `public|private|internal` (§26.4); custom operations only as service methods.
8. **UI** — build from the standard **List / Detail / Create / Settings** templates; register nav; URLs follow §8.4/§8.5 with **all view state in the URL**. To extend *another* module's page, render into its **declared slots** (§31.8) — never touch its code.
9. **Events & hooks** — emit **versioned** events; consume others' via their `contracts/`; DB lifecycle events are available (§35.3). Never import another module's internals.
10. **Verify & ship** — `platform check` (fitness functions incl. structural perf §30.7) + `platform ci`, then open a PR.

---

## Wiring modules together — the ONLY allowed couplings
1. **Depend** via published `contracts/` (typed interface) — never tables or internals.
2. **React** via published, **versioned events**.
3. **Shared data** (tenant, user, entitlements) via **Core / Identity** services.
4. **Extend** via declared **hooks and UI slots** (§31.8).

Never modify another module's domain model (§31.3/§31.10). Fitness functions fail the build on any other coupling.

---

## Definition of Done checklist
- [ ] `platform doctor <mod>` green — skeleton + **manifest & capability contracts** valid (§31.7)
- [ ] Every file has a **header comment** (§33.2)
- [ ] Uses **Core shared services** — no re-implemented DateTime / Money / formatting (§32, §33.4)
- [ ] Entities use the Entity Toolkit (metafields / metaobjects / tags / timeline / audit / saved-views)
- [ ] **i18n:** Money value objects, UTC timestamps, translatable fields declared (§15)
- [ ] **SEO:** SEO fields + capability where content is public (§34)
- [ ] Migrations **fluent** + expand→contract + shard-aware (§17, §35)
- [ ] GraphQL + REST generated; **visibility** set; custom logic only in services
- [ ] UI from templates; nav registered; **all view state in the URL**; cross-module UI via **slots**
- [ ] Events **versioned**; zero cross-module internal imports
- [ ] Every query **tenant-scoped** (isolation test passes)
- [ ] **Entitlement-gated** — enable/disable toggles the whole module
- [ ] **No competitor names** in code/comments (§33.3); input sanitized / output escaped via Core (§33.4)
- [ ] `platform ci` green (fitness + structural-perf + coverage) + tests pass
- [ ] ADR added for any significant decision

---

## What CI enforces automatically (so code can't drift)
On every PR the fitness suite fails the build on: a cross-module internal import, a layer-law violation, a missing/invalid manifest or **unmet capability contract**, a backward-incompatible event without a version bump, an endpoint missing auth/pagination/error-envelope, a query without tenant scope, a **structural performance** violation (missing index, N+1, GraphQL over-complexity, bundle bloat — §30.7), a **competitor name** in code, a file **missing its header**, or **unescaped output / ad-hoc sanitization** (§33.4). A rule a test enforces beats a rule in a doc.

---

## For AI coding agents
Agents follow the identical path — scaffold with `platform module:new` / `gen:entity`, fill domain logic, run `platform check`, open a PR. Because the structure is generated and the rules are CI-enforced, agent-built modules are structurally identical to human-built ones. The repo's `CLAUDE.md` carries the Module Standard so every agent inherits it; a reviewer agent + CI catch anything that slips. This guide *is* the agent's operating manual.
