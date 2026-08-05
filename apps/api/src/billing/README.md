# Billing

How a third-party app charges a merchant through the platform.

## Why this is its own module and not part of `apps`

The app platform decides what software may *reach*. This decides what it may
*take*. Those are different questions with different failure modes — a scope
granted too widely leaks data, a charge approved too loosely takes money — and
the people who review them are not the same people.

It is also the only module where a mistake is measured in currency, so it holds
the line the rest of the platform relies on: `Money` everywhere, never a number,
and no currency arithmetic that is not `addMoney`, `subtractMoney` or
`applyRate`.

## The one rule

**Did this merchant agree to this exact amount?**

Every state in `charge.ts` exists to answer it. A charge is `pending` and grants
nothing until the merchant approves it. The two shapes that could be widened
afterwards — the recurring price and the usage cap — cannot be: an app that
could edit an approved charge would hold a blank cheque.

Consequences worth knowing before changing anything here:

- **Usage over the cap is refused, not truncated.** Truncating bills the cap and
  discards the rest, which reads as working until somebody reconciles, and the
  app cannot tell it happened.
- **The trial runs from approval, not creation.** Otherwise an app leaves a
  charge pending for a week and silently eats the merchant's trial.
- **`declined` and `cancelled` are both terminal and both kept.** Declined means
  they said no; cancelled means it ran and stopped. An app deciding what to do
  next needs to tell them apart, and re-approving a declined charge must mean
  creating a new one the merchant sees fresh.
- **Test charges never bill.** A partner builds the whole approval flow against
  a real store without money moving. Forgetting to check `isTest` is how a demo
  becomes an invoice.
