/**
 * Storefront · engine/filters/metafield.ts
 * Rendering a metafield without the theme knowing its type.
 *
 * A metafield is a typed value a merchant attached to a product — a care
 * instruction, a size chart, a rating. The theme writes
 * `{{ product.metafields.custom.care | metafield_tag }}` and gets markup
 * appropriate to whatever type the merchant chose, which is the only way a
 * theme can render fields it was not written for.
 *
 * `metafield_text` is the same value with the markup stripped, for a `<title>`
 * or a meta description. Both take the type from the value rather than guessing
 * from its shape: a `rating` and a `number_decimal` are both numbers and are
 * not rendered the same way.
 * Layer: engine.
 */

import { escapeHtml } from '../markup';
import { stringify, type FilterGroup } from '../types';

interface MetafieldValue {
  readonly type?: string;
  readonly value?: unknown;
}

function asMetafield(value: unknown): MetafieldValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && ('type' in value || 'value' in value)) {
    return value as MetafieldValue;
  }
  // A bare value still renders; a theme reading `.value` directly then piping
  // it here is common enough that refusing would be unhelpful.
  return { type: 'single_line_text_field', value };
}

/** The plain text of a metafield, whatever its type. */
function textOf(field: MetafieldValue): string {
  const { type, value } = field;

  if (Array.isArray(value)) return value.map((entry) => stringify(entry)).join(', ');

  if (type === 'rich_text_field' || type === 'multi_line_text_field') {
    return stringify(value).replace(/<[^>]*>/g, '');
  }

  if (type === 'money' && value && typeof value === 'object') {
    const money = value as { amount?: unknown; currency_code?: unknown };
    return `${stringify(money.amount)} ${stringify(money.currency_code)}`.trim();
  }

  if (type === 'rating' && value && typeof value === 'object') {
    const rating = value as { value?: unknown; scale_max?: unknown };
    return `${stringify(rating.value)} / ${stringify(rating.scale_max)}`;
  }

  return stringify(value);
}

export const metafieldFilters: FilterGroup = {
  name: 'metafield',
  filters: [
    {
      name: 'metafield_tag',
      returnsHtml: true,
      apply: (_context, value) => {
        const field = asMetafield(value);
        if (!field) return '';

        const { type } = field;

        /**
         * Rich text is the one type that is already markup.
         *
         * It arrives as HTML the merchant authored through a controlled editor,
         * so it is emitted as-is — escaping it would show tags on the page.
         * That makes the editor's own sanitising the boundary, which is where
         * it belongs: this filter cannot tell safe markup from unsafe.
         */
        if (type === 'rich_text_field') return stringify(field.value);

        if (type === 'multi_line_text_field') {
          return stringify(field.value)
            .split('\n')
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('');
        }

        if (type === 'url') {
          const href = stringify(field.value);
          return `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
        }

        if (type === 'date' || type === 'date_time') {
          const text = stringify(field.value);
          return `<time datetime="${escapeHtml(text)}">${escapeHtml(text)}</time>`;
        }

        if (Array.isArray(field.value)) {
          return `<ul>${field.value
            .map((entry) => `<li>${escapeHtml(stringify(entry))}</li>`)
            .join('')}</ul>`;
        }

        return escapeHtml(textOf(field));
      },
    },

    {
      name: 'metafield_text',
      apply: (_context, value) => {
        const field = asMetafield(value);
        return field ? textOf(field) : '';
      },
    },
  ],
};
