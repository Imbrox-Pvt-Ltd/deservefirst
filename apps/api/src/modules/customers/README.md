# Customers

Shoppers, their consent state, addresses and segments. The platform's second
product module, and therefore the first real test of composition.

## Bounded context

Who buys, how to reach them, and whether they have agreed to be reached. It owns
nothing about what they bought — orders belong to their own context and reference
a customer through `contracts/`.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Customer** | A shopper. Distinct from a `User`, who is staff — conflating them is how "delete this customer" revokes someone's admin access. |
| **Consent** | An explicit, per-channel agreement to marketing. Never inferred. |
| **Segment** | A saved rule set over customers, evaluated live rather than stored as a membership list. |
| **State** | Whether the shopper has an account: disabled, invited, active or declined. |

## Aggregates

| Aggregate root | Contains | Loaded / saved / authorized by |
|---|---|---|
| `Customer` | addresses, consent state, denormalised order totals | the root |
| `Segment` | conditions | itself — a segment references customers but owns none |

## Published contracts

`contracts/` exports `CustomerSummary` and the event payloads. Consent state is
part of the summary deliberately: any module that messages a shopper must be able
to check it without asking this one.

## Events

| Event | Version | Direction | Meaning |
|---|---|---|---|
| `customers.customer.created` | 1 | emits | A customer record was created. |
| `customers.customer.updated` | 1 | emits | A customer record changed. |
| `customers.customer.consent-changed` | 1 | emits | Consent changed on a channel; carries before and after. |
| `customers.segment.created` | 1 | emits | A segment was created. |

## Consent is not an ordinary field

`changeConsent` is a separate operation from `update`, for two reasons. A consent
change is legally meaningful and must be recorded with its before/after pair, which
a generic field update would lose. And keeping it separate means a bulk edit cannot
change consent by accident.

Three rules the tests pin:

- Only `subscribed` permits marketing. `unknown` and `pending` are not consent.
- Consent without a reachable channel is not consent — subscribed with no email
  address sends nothing.
- A staff-created customer defaults to `unknown`, never to subscribed.

## What composition proved

Registering this module alongside catalog produces one admin: navigation merges and
sorts by declared position, settings land in their declared groups, and every
route's permission resolves against the union of both manifests. Neither module
references the other.

It also declares catalog as an **optional** dependency, so with catalog absent this
module degrades and the platform still boots — asserted in the tests.

## Not yet built

The customer screens, address book editing, and segment evaluation against the
database (the rule engine is pure and tested; nothing queries with it yet).
Companies and B2B are a later phase.
