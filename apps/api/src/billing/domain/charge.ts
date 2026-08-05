/**
 * Billing · domain/charge.ts
 * What an app may charge a merchant, and the rules that make that safe.
 *
 * Two things make this different from every other module so far. It is money,
 * so it uses the Money value object throughout and never a number — the whole
 * point of §15.2 is that nobody re-implements currency maths, and a billing
 * module is exactly where somebody would be tempted.
 *
 * And the merchant is being charged by a third party. Every state here exists
 * to answer one question: did this merchant agree to this exact amount? A
 * charge is `pending` until they say so, and the shapes that could be widened
 * after approval — the recurring price, the usage cap — cannot be. An app that
 * could edit an approved charge would be an app with a blank cheque.
 * Layer: domain (pure).
 */

import {
  addMoney,
  applyRate,
  compareMoney,
  isZero,
  money,
  subtractMoney,
  type Money,
} from '@deservefirst/contracts';

export type ChargeKind = 'recurring' | 'usage' | 'one_time';

/**
 * Where a charge is.
 *
 * `pending` is the default and it grants nothing. `active` means the merchant
 * approved it and it is billable. `declined` and `cancelled` are terminal and
 * distinct on purpose: declined means they said no, cancelled means it ran and
 * stopped, and an app deciding what to do next needs to tell those apart.
 */
export type ChargeStatus = 'pending' | 'active' | 'declined' | 'cancelled' | 'expired';

export type BillingInterval = 'every_30_days' | 'annual';

export class BillingError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'BillingError';
  }
}

export interface AppCharge {
  readonly id: string;
  readonly appId: string;
  readonly storeId: string;
  readonly kind: ChargeKind;
  readonly name: string;
  readonly status: ChargeStatus;
  /** The recurring or one-time price. Zero for a pure usage charge. */
  readonly price: Money;
  readonly interval: BillingInterval | null;
  /**
   * The most a usage charge may accumulate to before the merchant is asked
   * again. Null for other kinds.
   */
  readonly cappedAmount: Money | null;
  /** What has been recorded against the cap so far. */
  readonly balanceUsed: Money;
  readonly trialDays: number;
  /** Set when approved; the trial and the first period run from here. */
  readonly activatedAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelledAt: Date | null;
  /** A test charge bills nothing, so a partner can build the flow safely. */
  readonly isTest: boolean;
  readonly version: number;
}

const DAY_MS = 86_400_000;
const INTERVAL_DAYS: Record<BillingInterval, number> = {
  every_30_days: 30,
  annual: 365,
};

// --- creating one ------------------------------------------------------------

export function assertChargeValid(charge: AppCharge): void {
  if (charge.name.trim().length === 0) {
    // A merchant sees this on the approval screen. "Charge" is not a name.
    throw new BillingError('name', 'is required — the merchant reads it before approving');
  }
  if (charge.price.amountMinor < 0n) {
    throw new BillingError('price', 'cannot be negative');
  }
  if (charge.trialDays < 0 || charge.trialDays > 365) {
    throw new BillingError('trialDays', 'must be between 0 and 365');
  }

  if (charge.kind === 'recurring') {
    if (charge.interval === null) {
      throw new BillingError('interval', 'a recurring charge needs an interval');
    }
    if (isZero(charge.price)) {
      throw new BillingError('price', 'a recurring charge of nothing should not be a charge');
    }
  }

  if (charge.kind === 'usage') {
    if (charge.cappedAmount === null) {
      // Uncapped usage billing is a blank cheque. The cap is the number the
      // merchant actually approves; the price per unit is not.
      throw new BillingError('cappedAmount', 'a usage charge needs a cap the merchant approves');
    }
    if (charge.cappedAmount.currency !== charge.price.currency) {
      throw new BillingError('cappedAmount', 'must be in the same currency as the price');
    }
    if (charge.interval === null) {
      throw new BillingError('interval', 'a usage charge needs an interval for its cap to reset');
    }
  }

  if (charge.kind === 'one_time') {
    if (charge.interval !== null) {
      throw new BillingError('interval', 'a one-time charge does not repeat');
    }
    if (charge.trialDays > 0) {
      throw new BillingError('trialDays', 'a one-time charge cannot have a trial');
    }
  }
}

const TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  // Terminal states are terminal. Re-approving a declined charge would let an
  // app re-ask by flipping a status rather than by creating a new charge the
  // merchant sees fresh.
  pending: ['active', 'declined', 'expired'],
  active: ['cancelled'],
  declined: [],
  cancelled: [],
  expired: [],
};

export function assertTransition(from: ChargeStatus, to: ChargeStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new BillingError('status', `a charge cannot go from ${from} to ${to}`);
  }
}

/**
 * What an approved charge looks like.
 *
 * The trial is measured from approval rather than from creation, so an app that
 * creates a charge and leaves it pending for a week does not silently consume
 * the merchant's trial.
 */
export function approve(charge: AppCharge, at: Date): AppCharge {
  /**
   * Explicitly, because `assertTransition` returns early when nothing changes.
   *
   * That early return is right for a status being set idempotently and wrong
   * here: approving recomputes the trial and the period end, so re-approving an
   * active charge silently grants another free trial and moves the billing date
   * — money, from a second click.
   */
  if (charge.status === 'active') {
    throw new BillingError('status', 'this charge is already approved');
  }
  assertTransition(charge.status, 'active');

  const trialEnds = new Date(at.getTime() + charge.trialDays * DAY_MS);
  const periodDays = charge.interval ? INTERVAL_DAYS[charge.interval] : 0;

  return {
    ...charge,
    status: 'active',
    activatedAt: at,
    currentPeriodEnd:
      charge.kind === 'one_time'
        ? null
        : new Date(trialEnds.getTime() + periodDays * DAY_MS),
    version: charge.version + 1,
  };
}

// --- usage -------------------------------------------------------------------

/**
 * Records usage against a capped charge.
 *
 * Refuses rather than truncating when the cap would be exceeded. Truncating
 * would bill the merchant the cap and quietly discard the rest, which reads as
 * working right up until somebody reconciles the numbers — and the app cannot
 * tell that it happened.
 */
export function recordUsage(charge: AppCharge, amount: Money, at: Date): AppCharge {
  if (charge.kind !== 'usage') {
    throw new BillingError('kind', 'usage can only be recorded against a usage charge');
  }
  if (charge.status !== 'active') {
    throw new BillingError('status', 'this charge is not active');
  }
  if (amount.currency !== charge.price.currency) {
    throw new BillingError('amount', 'must be in the charge currency');
  }
  if (amount.amountMinor <= 0n) {
    throw new BillingError('amount', 'must be positive');
  }
  if (charge.currentPeriodEnd && at.getTime() > charge.currentPeriodEnd.getTime()) {
    throw new BillingError('period', 'this billing period has ended');
  }

  const next = addMoney(charge.balanceUsed, amount);
  const cap = charge.cappedAmount as Money;

  if (compareMoney(next, cap) === 1) {
    throw new BillingError(
      'amount',
      'this would exceed the cap the merchant approved — ask them to raise it',
    );
  }

  return { ...charge, balanceUsed: next, version: charge.version + 1 };
}

/** What is left before the merchant has to be asked again. */
export function remainingCap(charge: AppCharge): Money | null {
  if (charge.cappedAmount === null) return null;
  return subtractMoney(charge.cappedAmount, charge.balanceUsed);
}

/** The cap resets with the period; usage does not roll over into the next one. */
export function startNextPeriod(charge: AppCharge, at: Date): AppCharge {
  if (charge.interval === null) return charge;
  return {
    ...charge,
    balanceUsed: money(0n, charge.price.currency),
    currentPeriodEnd: new Date(at.getTime() + INTERVAL_DAYS[charge.interval] * DAY_MS),
    version: charge.version + 1,
  };
}

// --- changing plan -----------------------------------------------------------

/**
 * The credit owed when a merchant leaves a plan part-way through a period.
 *
 * Charged in advance, so leaving early means unused time already paid for. The
 * credit is the unused fraction — computed on whole days, because a merchant
 * arguing about a bill wants a number they can recompute, and hours make that
 * an argument about rounding.
 *
 * Returns zero rather than a negative when the period has already ended: owing
 * money back for time that has passed is not proration, it is a refund, and
 * that is a decision a person makes.
 */
export function unusedCredit(charge: AppCharge, at: Date): Money {
  const zero = money(0n, charge.price.currency);
  if (charge.status !== 'active' || charge.interval === null) return zero;
  if (!charge.currentPeriodEnd) return zero;

  const remainingMs = charge.currentPeriodEnd.getTime() - at.getTime();
  if (remainingMs <= 0) return zero;

  const periodDays = INTERVAL_DAYS[charge.interval];
  const remainingDays = Math.floor(remainingMs / DAY_MS);
  if (remainingDays <= 0) return zero;

  // applyRate does the currency maths and the rounding. Doing it here with
  // numbers is exactly what §15.2 forbids.
  return applyRate(charge.price, Math.min(remainingDays / periodDays, 1), 'half-up');
}

export function cancel(charge: AppCharge, at: Date): AppCharge {
  assertTransition(charge.status, 'cancelled');
  return { ...charge, status: 'cancelled', cancelledAt: at, version: charge.version + 1 };
}

/**
 * Whether a charge should still be billed.
 *
 * A test charge never is. It exists so a partner can build and demo the whole
 * approval flow against a real store without money moving, and forgetting to
 * check this is how a demo becomes an invoice.
 */
export function isBillable(charge: AppCharge, at: Date): boolean {
  if (charge.isTest) return false;
  if (charge.status !== 'active') return false;
  if (!charge.activatedAt) return false;

  // Still inside the trial: agreed, active, and not yet billable.
  const trialEnds = new Date(charge.activatedAt.getTime() + charge.trialDays * DAY_MS);
  return at.getTime() >= trialEnds.getTime();
}

/** What the merchant owes for this charge right now. */
export function amountDue(charge: AppCharge, at: Date): Money {
  const zero = money(0n, charge.price.currency);
  if (!isBillable(charge, at)) return zero;
  if (charge.kind === 'usage') return charge.balanceUsed;
  return charge.price;
}
