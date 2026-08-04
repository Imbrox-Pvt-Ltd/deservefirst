/**
 * Customers · domain/company.ts
 * B2B: the buyer is an organisation, and the people are its contacts.
 *
 * A company is its own aggregate, not a flag on a customer, because the two are
 * different things that change independently. A person leaves and the company
 * keeps buying; a company is put on hold and the person still has an account.
 * Modelling it as `customer.isCompany` forces every question about either to be
 * asked of a record that is only sometimes about the right subject.
 *
 * Three pieces, and the relationships between them are the whole design:
 *
 *   Company           who is buying
 *   CompanyLocation   where, and on what terms — terms live HERE, not on the
 *                     company, because a group's sites genuinely differ
 *   CompanyContact    a LINK to a Customer, never a copy of one
 *
 * That last point matters most. A contact references the person's existing
 * customer record; removing a contact ends a relationship and must never delete
 * the person, who may buy from the same store privately.
 * Layer: domain (pure).
 */

export type CompanyStatus = 'active' | 'on-hold' | 'closed';

/**
 * How a location expects to pay.
 *
 * Net terms are the reason B2B exists as a separate flow: the order ships before
 * the money arrives, which is a credit decision rather than a checkout option.
 */
export type PaymentTerms = 'due-on-receipt' | 'net-15' | 'net-30' | 'net-60' | 'prepaid';

export interface CompanyLocation {
  readonly id: string;
  readonly name: string;
  readonly addressLine1: string | null;
  readonly city: string | null;
  readonly countryCode: string;
  readonly paymentTerms: PaymentTerms;
  /** Null means no agreed ceiling, which is not the same as a ceiling of zero. */
  readonly creditLimitMinor: bigint | null;
  readonly isDefault: boolean;
}

/**
 * What a contact may do on the company's behalf.
 *
 * Ordering and viewing are separated because that is the actual request from
 * every B2B buyer: a site manager who may see prices and history, and a
 * purchaser who may commit money.
 */
export type ContactRole = 'ordering' | 'viewing' | 'admin';

export interface CompanyContact {
  readonly id: string;
  /** The person's own customer record. A contact links; it never duplicates. */
  readonly customerId: string;
  readonly role: ContactRole;
  /** Which locations this person may act for; empty means all of them. */
  readonly locationIds: readonly string[];
  readonly isPrimary: boolean;
}

export interface Company {
  readonly id: string;
  readonly name: string;
  /** The buyer's own reference for themselves — their vendor number for us. */
  readonly externalId: string | null;
  readonly status: CompanyStatus;
  readonly note: string | null;
  readonly locations: readonly CompanyLocation[];
  readonly contacts: readonly CompanyContact[];
  readonly version: number;
}

export class CompanyInvariantError extends Error {
  readonly status = 422;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = 'CompanyInvariantError';
  }
}

export function assertCompanyValid(company: Company): void {
  if (company.name.trim().length === 0) {
    throw new CompanyInvariantError('name', 'is required');
  }

  assertLocationsValid(company);
  assertContactsValid(company);
}

function assertLocationsValid(company: Company): void {
  // A company with no location has nowhere to ship and no terms to bill on.
  // Refusing it here is kinder than discovering it at the first order.
  if (company.status !== 'closed' && company.locations.length === 0) {
    throw new CompanyInvariantError('locations', 'a company needs at least one location');
  }

  const seen = new Set<string>();
  for (const location of company.locations) {
    if (location.name.trim().length === 0) {
      throw new CompanyInvariantError('locations', 'every location needs a name');
    }
    if (!/^[A-Z]{2}$/.test(location.countryCode)) {
      throw new CompanyInvariantError(
        'locations',
        `"${location.name}" needs a two-letter ISO country code`,
      );
    }
    if (location.creditLimitMinor !== null && location.creditLimitMinor < 0n) {
      throw new CompanyInvariantError('locations', `"${location.name}" cannot have a negative credit limit`);
    }

    const key = location.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new CompanyInvariantError('locations', `two locations are both called "${location.name}"`);
    }
    seen.add(key);
  }

  const defaults = company.locations.filter((location) => location.isDefault);
  if (company.locations.length > 0 && defaults.length !== 1) {
    // Exactly one, always. Zero means an order has to guess; two means it has to
    // choose, and both failures happen at the worst possible moment.
    throw new CompanyInvariantError(
      'locations',
      defaults.length === 0
        ? 'one location must be the default'
        : 'only one location can be the default',
    );
  }
}

function assertContactsValid(company: Company): void {
  const locationIds = new Set(company.locations.map((location) => location.id));
  const customers = new Set<string>();

  for (const contact of company.contacts) {
    if (customers.has(contact.customerId)) {
      throw new CompanyInvariantError('contacts', 'the same person is listed twice');
    }
    customers.add(contact.customerId);

    for (const locationId of contact.locationIds) {
      if (!locationIds.has(locationId)) {
        throw new CompanyInvariantError(
          'contacts',
          'a contact is assigned to a location this company does not have',
        );
      }
    }
  }

  const primaries = company.contacts.filter((contact) => contact.isPrimary);
  if (primaries.length > 1) {
    throw new CompanyInvariantError('contacts', 'only one contact can be the primary one');
  }
}

/** The locations a contact may act for — an empty list means all of them. */
export function locationsFor(company: Company, contact: CompanyContact): readonly CompanyLocation[] {
  if (contact.locationIds.length === 0) return company.locations;
  return company.locations.filter((location) => contact.locationIds.includes(location.id));
}

/**
 * Whether this person may place an order for this location.
 *
 * Three things have to hold, and separating them is the point: the company must
 * be trading, the person must have the ordering right, and the assignment must
 * cover the location. Collapsing them into one boolean is how a viewer at one
 * site ends up committing money at another.
 */
export function canOrder(
  company: Company,
  contact: CompanyContact,
  locationId: string,
): boolean {
  if (company.status !== 'active') return false;
  if (contact.role === 'viewing') return false;
  return locationsFor(company, contact).some((location) => location.id === locationId);
}

/** The default location, which the invariants guarantee exists while trading. */
export function defaultLocation(company: Company): CompanyLocation | null {
  return company.locations.find((location) => location.isDefault) ?? null;
}

const TRANSITIONS: Readonly<Record<CompanyStatus, readonly CompanyStatus[]>> = {
  active: ['on-hold', 'closed'],
  'on-hold': ['active', 'closed'],
  // Closed is final. Reopening is a new relationship with new terms, and
  // restoring the old ones silently is how a lapsed credit limit comes back.
  closed: [],
};

export function assertStatusTransition(from: CompanyStatus, to: CompanyStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new CompanyInvariantError('status', `a company cannot go from ${from} to ${to}`);
  }
}
