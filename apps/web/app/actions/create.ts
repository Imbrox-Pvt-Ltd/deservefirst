'use server';

/**
 * Web · app/actions/create.ts
 * The one server action behind every "new" screen.
 *
 * A form gives back strings; each module's service wants its own typed input.
 * That translation lives here rather than in nine screens, so the screens stay
 * a field list and the shape of each create call stays in one reviewable place.
 * Layer: web/actions.
 */

import { createCollection } from './collections';
import { createCustomer } from './customers';
import { createPage, createDefinition } from './content';
import { createProduct } from './products';
import { createCompany } from './companies';
import { createPurchaseOrder, createTransfer } from './inventory';
import { createSegment } from './segments';
import { createRequest } from './requests';
import { toFieldKey, type CreateKind } from '../../lib/create-forms';

export interface CreateResult {
  readonly ok: boolean;
  readonly id?: string;
  readonly error?: string;
}

/** Empty strings are absent, not empty — a blank optional field is null. */
function optional(values: Record<string, string>, name: string): string | null {
  const value = values[name]?.trim();
  return value ? value : null;
}

export async function createRecord(
  kind: CreateKind,
  handle: string,
  values: Record<string, string>,
): Promise<CreateResult> {
  const text = (name: string) => values[name]?.trim() ?? '';

  switch (kind) {
    case 'product': {
      const result = await createProduct(handle, {
        title: text('title'),
        description: text('description'),
        price: { amount: text('price') || '0', currency: text('currency') || 'USD' },
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'collection': {
      const result = await createCollection(handle, {
        title: text('title'),
        description: text('description'),
        // Manual until a condition is added; that is what makes it automated.
        type: 'manual',
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'customer': {
      const result = await createCustomer(handle, {
        firstName: optional(values, 'firstName'),
        lastName: optional(values, 'lastName'),
        email: optional(values, 'email'),
        phone: optional(values, 'phone'),
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'request': {
      const result = await createRequest(handle, {
        contactName: optional(values, 'contactName'),
        contactEmail: optional(values, 'contactEmail'),
        currency: text('currency') || 'USD',
        note: optional(values, 'note'),
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'page': {
      const result = await createPage(handle, { title: text('title'), body: text('body') });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'purchase-order': {
      const result = await createPurchaseOrder(handle, {
        supplierName: text('supplierName'),
        destinationLocationId: text('destinationLocationId'),
        expectedAt: optional(values, 'expectedAt'),
        lines: [],
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'transfer': {
      const result = await createTransfer(handle, {
        originLocationId: text('originLocationId'),
        destinationLocationId: text('destinationLocationId'),
        lines: [],
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'segment': {
      // The picker carries "field:value"; splitting it here keeps the form a
      // single choice rather than three coupled selects on a create screen.
      const [field, value] = (text('firstCondition') || 'emailConsent:subscribed').split(':');
      const result = await createSegment(handle, {
        name: text('name'),
        conditions: [{ field: field!, operator: 'equals', value: value ?? '' }],
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'company': {
      const result = await createCompany(handle, {
        name: text('name'),
        externalId: optional(values, 'externalId'),
        location: {
          name: text('locationName') || 'Head office',
          countryCode: (text('countryCode') || 'US').toUpperCase(),
        },
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    case 'metaobject-definition': {
      const label = text('firstFieldName');
      const result = await createDefinition(handle, {
        type: text('type'),
        name: text('name'),
        // A definition needs at least one field, so the form asks for one and
        // derives its key. The key is fixed once saved — values are stored
        // against it — which is why it is derived here and not typed twice.
        fields: [
          {
            key: toFieldKey(label),
            name: label,
            type: 'single_line_text',
            required: true,
            description: null,
          },
        ],
        displayNameKey: toFieldKey(label),
      });
      return { ok: result.ok, id: result.data?.id, error: result.error };
    }

    default:
      return { ok: false, error: `Nothing knows how to create "${kind}"` };
  }
}
