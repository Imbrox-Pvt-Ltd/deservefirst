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
import type { CustomerService } from '../application';
import { displayName, type Customer, type MarketingConsent } from '../domain';

export interface CustomersServices {
  customerServiceFor(storeId: string): CustomerService;
}

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
