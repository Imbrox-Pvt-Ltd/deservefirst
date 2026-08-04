# Inventory

Locations, stock levels, purchase orders and transfers.

## The central idea

**On-hand is never written directly.** It is derived from adjustments, and every
adjustment carries a reason: received, sold, damaged, shrinkage, recount,
transfer-in, transfer-out, correction.

A settable quantity field looks simpler right up to the first time two people set
it at once and nobody can say what happened. With adjustments, every discrepancy
has an explanation attached and a recount is itself a recorded event.

Adjustments are append-only: no soft delete, no timeline, nothing edits them.
They *are* the audit trail.

## Bounded context

Where stock is and how it got there. It owns nothing about what a product is —
catalog is an **optional** dependency, because a warehouse still has locations
even in a store with no catalog enabled.

## Aggregates

| Aggregate root | Contains |
|---|---|
| `Location` | address, whether it fulfils orders |
| `PurchaseOrder` | lines with ordered and received quantities |
| `Transfer` | lines with sent and received quantities |

`InventoryLevel` is a derived view, not an aggregate — it is the running total of
adjustments for a (location, product) pair.

## Four rules worth knowing

**Negative on-hand is preserved, not clamped.** It is the evidence of an
unrecorded movement, and clamping to zero destroys the signal a recount needs.
`available()` never returns negative, because a negative *available* is
meaningless to every caller — but the underlying count stays honest.

**Purchase order status is derived from its lines**, so the two cannot disagree.
A draft or cancelled order keeps its status regardless.

**Over-receiving is refused.** Suppliers do ship extra; that is a separate
adjustment with its own reason, not an unnoticed off-by-N on the order.

**Stock in transit belongs to neither location.** Counting it as arrived is how a
store oversells a shipment that is still on a lorry. Receiving a transfer
produces a matched pair of adjustments that nets to zero — a transfer moves
stock, it does not create it.

## URL deviation

Inventory is served at `/store/{h}/inventory`, not the captured
`/store/{h}/products/inventory`. The captured path is shadowed by
`/store/{h}/products/:id`, which catalog owns; the reference product resolves that
static-before-dynamic inside one router, but across two independent modules
neither author declares the precedence. The route-collision rule refuses it, and
a top-level path is unambiguous. Recorded in `PLAN/01`.

## Not yet built

Services, repositories and screens. The domain is complete and tested; nothing
persists yet.
