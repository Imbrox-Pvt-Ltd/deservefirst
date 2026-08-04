# DeserveFirst

A multi-tenant, module-driven commerce platform. One deployable app, hard module
boundaries, isolation enforced in the database, and a structure rigid enough that an
agent can build module N without re-deciding foundations.

## Quick start

```bash
pnpm install
cp .env.example .env             # MySQL/MariaDB for now — see docs/adr/0002

pnpm platform db:sync            # create the schema from every module manifest
pnpm platform seed               # one org, two legal entities, two stores, products

pnpm --filter @deservefirst/api run build && pnpm --filter @deservefirst/api start
pnpm --filter @deservefirst/web dev          # http://localhost:3000
```

Then open <http://localhost:3000>, pick a store, and go to Products. Switching
between Acme US and Acme India shows the same product handles with different
currencies and no shared rows — the tenant boundary, visible.

```bash
pnpm check                       # the fitness suite — what blocks a merge
pnpm ci                          # build · typecheck · fitness · test, exactly as CI runs
pnpm platform module:new <name>  # scaffold a module to the Standard
pnpm platform doctor <name>      # validate one module
```

## Layout

```
apps/api                 the modular monolith (NestJS)
  src/core/              the kernel: tenant context, registry, entitlements,
                         event bus, cache, rate limit, adapters, observability
  src/auth/              identity
  src/modules/<name>/    product modules — all identical shape
apps/web                 admin (Next.js App Router)
packages/contracts       cross-module types, the module manifest, the URL map
packages/config          branding tokens and platform config
packages/ui              design system: Polaris + the four screen templates
tools/platform-cli       the `platform` command
tools/fitness            the fitness functions
```

## The one rule

Every module has the same skeleton — `domain/ application/ infrastructure/ api/
events/ contracts/ config/ tests/` plus a README and a manifest — and the layer law
runs one way: `api → application → domain`. A module imports nothing from another
module except its published `contracts/`. **If it is not declared in the manifest, the
platform does not load it.**

This is not documentation. `pnpm check` fails the build on a cross-module import, a
layer violation, an invalid manifest, an untenanted query, a missing file header, a
competitor name, a hardcoded brand string, a re-implemented Core primitive, or a
sensitive parameter in a URL schema. A rule a test enforces beats a rule in a doc.

## Where to read next

| You want | Read |
|---|---|
| the architecture law | `REQUIREMENT/platform_architecture_core_auth.md` (§0–§36) |
| how to add a module | `REQUIREMENT/module_author_guide.md` |
| what screens and URLs to build | `PLAN/01-reference-url-and-screen-map.md` |
| what already exists elsewhere | `PLAN/02-imbrox-reuse-assessment.md` |
| what order to build in | `PLAN/03-master-build-plan.md` |
| why the stack is what it is | `docs/adr/0001-foundation-decisions.md` |
| why MySQL, and what it costs | `docs/adr/0002-mysql-interim-database.md` |
| why not NestJS | `docs/adr/0003-fastify-transport-without-nest.md` |

## Naming

The platform name and every brand value live in `packages/config/src/branding.ts` and
are referenced through tokens — renaming is a one-file change. Shipped code, comments,
UI and public docs must never name a third-party platform; use the aliases defined in
that same file. Both rules are enforced by the fitness suite.
