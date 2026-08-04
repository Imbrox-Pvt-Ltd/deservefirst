/**
 * Customers · api/customers.controller.ts
 * The module's HTTP surface.
 *
 * Consent has its own endpoint, mirroring the service. Folding it into the
 * generic update would let a bulk edit change consent by accident and would lose
 * the before/after pair a compliance question needs.
 * Layer: api.
 */

import { toDecimalString } from '@deservefirst/contracts';

import { controller, type ModuleController, type RouteRequest } from '../../../core/http/controller';
import type { CompanyService, CustomerService, SegmentService } from '../application';
import { displayName, type Company, type Customer, type MarketingConsent, type Segment } from '../domain';

export interface CustomersServices {
  customerServiceFor(storeId: string): CustomerService;
  segmentServiceFor(storeId: string): SegmentService;
  companyServiceFor(storeId: string): CompanyService;
}

const toSegmentDto = (segment: Segment) => ({
  id: segment.id,
  name: segment.name,
  match: segment.match,
  conditions: segment.conditions,
  version: segment.version,
});

const toCompanyDto = (company: Company) => ({
  id: company.id,
  name: company.name,
  externalId: company.externalId,
  status: company.status,
  note: company.note,
  locations: company.locations.map((location) => ({
    ...location,
    // Exact minor units as a string: JSON has no integer wide enough to be
    // trusted with money, and a credit limit is money.
    creditLimitMinor: location.creditLimitMinor?.toString() ?? null,
  })),
  contacts: company.contacts,
  version: company.version,
});

const toCustomerDto = (customer: Customer) => ({
  id: customer.id,
  displayName: displayName(customer),
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  phone: customer.phone,
  state: customer.state,
  emailConsent: customer.emailConsent,
  smsConsent: customer.smsConsent,
  locale: customer.locale,
  taxExempt: customer.taxExempt,
  ordersCount: customer.ordersCount,
  totalSpent: {
    amount: toDecimalString(customer.totalSpent),
    currency: customer.totalSpent.currency,
  },
  version: customer.version,
});

const expectedVersion = (request: RouteRequest): number => Number(request.body.version ?? -1);

export function customersController(services: CustomersServices): ModuleController {
  const customers = (request: RouteRequest) => services.customerServiceFor(request.storeId);

  const segments = (request: RouteRequest) => services.segmentServiceFor(request.storeId);
  const companies = (request: RouteRequest) => services.companyServiceFor(request.storeId);

  return controller('customers', [
    {
      method: 'POST',
      path: '/customers',
      permission: 'customers.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toCustomerDto(
          await customers(request).create({
            email: (body.email ?? null) as string | null,
            phone: (body.phone ?? null) as string | null,
            firstName: (body.firstName ?? null) as string | null,
            lastName: (body.lastName ?? null) as string | null,
            // Consent is never assumed from a staff-created record, so it is not
            // accepted here — it is changed deliberately, on its own endpoint.
          }),
        );
      },
    },
    {
      method: 'GET',
      path: '/customers/:id/detail',
      permission: 'customers.read',
      handle: async (request) => toCustomerDto(await customers(request).get(request.params.id!)),
    },
    {
      method: 'PATCH',
      path: '/customers/:id',
      permission: 'customers.manage',
      handle: async (request) => {
        const { body } = request;
        return toCustomerDto(
          await customers(request).update({
            id: request.params.id!,
            expectedVersion: expectedVersion(request),
            ...(body.firstName === undefined ? {} : { firstName: body.firstName as string | null }),
            ...(body.lastName === undefined ? {} : { lastName: body.lastName as string | null }),
            ...(body.phone === undefined ? {} : { phone: body.phone as string | null }),
            ...(body.note === undefined ? {} : { note: body.note as string | null }),
            ...(body.taxExempt === undefined ? {} : { taxExempt: Boolean(body.taxExempt) }),
          }),
        );
      },
    },
    // --- segments --------------------------------------------------------------
    {
      method: 'GET',
      path: '/segments/:id/detail',
      permission: 'customers.read',
      handle: async (request) => {
        const segment = await segments(request).get(request.params.id!);
        const size = await segments(request).size(segment);
        // The count travels with the segment because it is the only number that
        // says whether the conditions actually describe anybody.
        return { ...toSegmentDto(segment), ...size };
      },
    },
    {
      method: 'GET',
      path: '/segments/:id/members',
      permission: 'customers.read',
      handle: async (request) => {
        const segment = await segments(request).get(request.params.id!);
        const members = await segments(request).members(segment);
        return { segment: toSegmentDto(segment), members: members.map(toCustomerDto) };
      },
    },
    {
      method: 'POST',
      path: '/segments',
      permission: 'customers.manage',
      status: 201,
      handle: async (request) =>
        toSegmentDto(
          await segments(request).create({
            name: String(request.body.name ?? ''),
            match: request.body.match === 'any' ? 'any' : 'all',
            conditions: (request.body.conditions ?? []) as never,
          }),
        ),
    },
    {
      method: 'PATCH',
      path: '/segments/:id',
      permission: 'customers.manage',
      handle: async (request) =>
        toSegmentDto(
          await segments(request).update(request.params.id!, expectedVersion(request), {
            name: request.body.name === undefined ? undefined : String(request.body.name),
            match: request.body.match as Segment['match'] | undefined,
            conditions: request.body.conditions as never,
          }),
        ),
    },
    {
      // Previewing a draft before it is saved: the same evaluation, no record.
      method: 'POST',
      path: '/segments/preview',
      permission: 'customers.read',
      handle: async (request) => {
        const draft = {
          match: request.body.match === 'any' ? ('any' as const) : ('all' as const),
          conditions: (request.body.conditions ?? []) as never,
        };
        segments(request).assertDraftValid(draft.match, draft.conditions);
        const members = await segments(request).members(draft, 10);
        const size = await segments(request).size(draft);
        return { ...size, sample: members.map(toCustomerDto) };
      },
    },

    // --- companies -------------------------------------------------------------
    {
      method: 'GET',
      path: '/companies/:id/detail',
      permission: 'customers.read',
      handle: async (request) => toCompanyDto(await companies(request).get(request.params.id!)),
    },
    {
      method: 'POST',
      path: '/companies',
      permission: 'customers.manage',
      status: 201,
      handle: async (request) => {
        const { body } = request;
        return toCompanyDto(
          await companies(request).create({
            name: String(body.name ?? ''),
            externalId: (body.externalId ?? null) as string | null,
            note: (body.note ?? null) as string | null,
            location: body.location as never,
          }),
        );
      },
    },
    {
      method: 'PATCH',
      path: '/companies/:id',
      permission: 'customers.manage',
      handle: async (request) => {
        const { body } = request;
        return toCompanyDto(
          await companies(request).update(request.params.id!, expectedVersion(request), {
            name: body.name === undefined ? undefined : String(body.name),
            externalId: body.externalId as string | null | undefined,
            note: body.note as string | null | undefined,
          }),
        );
      },
    },
    {
      method: 'PUT',
      path: '/companies/:id/locations',
      permission: 'customers.manage',
      handle: async (request) =>
        toCompanyDto(
          await companies(request).setLocations(
            request.params.id!,
            expectedVersion(request),
            (request.body.locations ?? []) as never,
          ),
        ),
    },
    {
      method: 'PUT',
      path: '/companies/:id/contacts',
      permission: 'customers.manage',
      handle: async (request) =>
        toCompanyDto(
          await companies(request).setContacts(
            request.params.id!,
            expectedVersion(request),
            (request.body.contacts ?? []) as never,
          ),
        ),
    },
    {
      method: 'POST',
      path: '/companies/:id/status',
      permission: 'customers.manage',
      handle: async (request) =>
        toCompanyDto(
          await companies(request).setStatus(
            request.params.id!,
            expectedVersion(request),
            request.body.status as never,
          ),
        ),
    },

    {
      method: 'POST',
      path: '/customers/:id/consent',
      permission: 'customers.manage',
      handle: async (request) =>
        toCustomerDto(
          await customers(request).changeConsent({
            id: request.params.id!,
            channel: (request.body.channel as 'email' | 'sms') ?? 'email',
            to: (request.body.to as MarketingConsent) ?? 'unknown',
            expectedVersion: expectedVersion(request),
          }),
        ),
    },
  ]);
}
