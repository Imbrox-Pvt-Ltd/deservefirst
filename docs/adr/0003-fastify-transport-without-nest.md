# ADR 0003 — Fastify transport, without NestJS

**Status:** accepted · **Date:** 2026-08-04 · **Amends:** architecture spec §2, §10.1

## Context

The architecture spec chose NestJS, and gave a specific reason:

> "Its module + provider + dependency-injection model **is** your module/plugin
> architecture."

That reasoning was sound when written. It is no longer true of this codebase. Phases 0–2
built our own module system: a manifest with capability contracts, a registry that
discovers and composes, dependency resolution with required/optional semantics, route
collision detection, and a fitness suite that enforces the whole thing. That *is* the
module architecture the spec wanted Nest for.

Adopting Nest now would mean running two module systems side by side — `@Module`
decorators and DI containers alongside our manifest and registry — with the question
"which one owns this?" arising on every new module. Two competing answers to the same
question is worse than either answer alone.

## Decision

Use **Fastify directly** as the HTTP transport. Do not adopt NestJS.

This is a smaller change than it sounds, because §13.1 already requires that transports
be thin: no business logic in a controller, all logic in `application/` services that
know nothing about HTTP. Those services exist and are tested. The transport's entire job
is parse → authorize → serialize → call a use-case.

Concretely:
- `core/http/route-composer.ts` composes API routes from module manifests at boot,
  which is §13.5's "declaratively registered and composed, not resolved from a database".
- Dependency wiring is explicit construction in a composition root rather than a DI
  container. With the module count this platform expects, explicit wiring is more
  legible and more testable than decorator-driven injection.
- Guards become ordinary middleware over the existing `AccessEvaluator`, which already
  holds the single access decision.

## Consequences

- **We lose Nest's ecosystem**: `@nestjs/swagger`, testing utilities, and the large
  body of Nest-shaped documentation. The OpenAPI document will be generated from our own
  resource definitions instead — which §26.2 requires anyway ("the schema is the single
  source", generated, never hand-written).
- **We lose DI-based test doubles.** Our services already take their ports as
  constructor arguments, so tests inject fakes directly. This is arguably the better
  shape; it is certainly the one already in use across 179 tests.
- **The donor codebase's Nest controllers cannot be ported verbatim.** They were always
  going to need rewriting to the layered structure (`PLAN/02`), so the incremental cost
  is small.
- **This decision is reversible.** Because logic lives in transport-agnostic services,
  wrapping them in Nest controllers later is additive. The reverse — extracting logic
  out of Nest controllers — would not have been.

## Honest note

This contradicts a spec decision, and it should be read as a real deviation rather than
a technicality. The spec's own §14.0 triage principle applies: adopt what enforces
uniformity, defer what only pays off later. We built the uniformity mechanism ourselves;
Nest would now duplicate it.

If a future requirement genuinely needs Nest — a library that assumes it, or a team
hiring signal — revisit this with a superseding ADR rather than mixing the two models
opportunistically.
