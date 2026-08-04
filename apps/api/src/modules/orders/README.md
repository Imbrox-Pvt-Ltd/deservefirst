# Requests

Requests for quote: what a buyer asked for, and what the merchant offered. The
platform's Phase-1 commerce surface.

## Why this exists instead of orders

ADR 0001 D10 defers checkout, payment and tax. Spec §25.1 is the reason: those
four light up together for physical goods, and half of them is worse than none —
"checkout without payment" is just this flow wearing a costume.

So this module models the part that is genuinely useful without them. A buyer
inquires, a merchant quotes, the buyer accepts or declines. It is a complete
B2B/wholesale flow, not a stub, and it stops short of the regulated parts on
purpose.

**The absence is the design.** There is no `paid` flag, no tax field, no
fulfilment state, and a test asserts the manifest mentions none of them. If that
test starts failing, someone has begun the half-built checkout the phasing exists
to prevent.

## Bounded context

The conversation between a buyer and a merchant about a possible purchase. It
owns the request and its lines; it owns nothing about the products being asked
about or the person asking, both of which it reaches through their contracts.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Request** | A buyer's inquiry. The aggregate root. |
| **Line** | One product and quantity within a request. Never addressed outside its request. |
| **List price** | What the catalog showed when the buyer asked, captured so a later change cannot rewrite history. |
| **Quoted price** | What the merchant is offering for that line. Null until quoted. |
| **Subtotal** | Quoted price where one exists, list price otherwise — deliberately not called a total, because there is no tax or shipping in it. |

## Aggregates

| Aggregate root | Contains | Loaded / saved / authorized by |
|---|---|---|
| `Request` | lines, status, quote validity | the root |

A line has no currency, no status and no buyer without its request, so it is
never addressed independently.

## Status path

```
draft ──▶ submitted ──▶ quoted ──▶ accepted
                │           │  └──▶ declined
                │           └─────▶ expired
                └──────────────────▶ declined / cancelled
```

`accepted`, `declined`, `expired` and `cancelled` are terminal. Reopening after
acceptance is how a quoted price silently changes underneath a buyer.

## Two rules worth knowing

**Editing the lines invalidates a sent quote.** Otherwise the buyer holds a price
for a basket that no longer exists. Changing lines on a quoted request moves it
back to `submitted` and clears the expiry, and the timeline says so.

**Expiry is evaluated on read, not only by a job.** A quote past its validity is
expired whatever the stored status says. Relying on a scheduled sweep would let a
buyer accept a stale price in the window before it ran.

## Dependencies

Catalog and customers are both **required** — a request is about products, from a
customer, and without either this module has nothing to model. Both are reached
only through their published contracts; the fitness suite fails the build on any
other coupling.

## Published contracts

`RequestSummary` and the event payloads. `orders.request.accepted` carries the
subtotal so Phase 2 can turn it into an order without reaching back in here.

## Not yet built

The request detail screen with its line editor, buyer-facing submission from a
storefront, and quote emails. Turning an accepted request into an order is Phase 2
by definition.
