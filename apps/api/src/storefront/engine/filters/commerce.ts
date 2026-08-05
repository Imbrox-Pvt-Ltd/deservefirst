/**
 * Storefront · engine/filters/commerce.ts
 * Filters that reach into cart, form and product data.
 *
 * Three of these — `payment_button`, `payment_terms`, `login_button` — render
 * nothing, deliberately. PLAN/07 records that the first storefront is a
 * catalogue with a quote request and has no cart or checkout, so there is no
 * button for them to render. They exist rather than being omitted because
 * `strictFilters` is on: an absent filter fails the render of any theme that
 * calls one, and every real theme calls all three. Rendering nothing degrades to
 * a page without a buy button; not existing degrades to no page.
 *
 * When checkout arrives they gain bodies and the themes already work.
 * Layer: engine.
 */

import { escapeHtml } from '../markup';
import { arg, stringify, type FilterGroup } from '../types';

export const commerceFilters: FilterGroup = {
  name: 'commerce',
  filters: [
    /**
     * How many of one variant are already in the cart.
     *
     * Themes use it to cap a quantity selector against available stock, so
     * returning zero for an unknown cart is right — the alternative would cap
     * the selector at nothing.
     */
    {
      name: 'item_count_for_variant',
      apply: (_context, value, args) => {
        const cart = value as { items?: unknown } | null;
        const variantId = stringify(arg(args, 0));
        const items = Array.isArray(cart?.items) ? cart.items : [];

        return items.reduce((total: number, item) => {
          const line = item as { variant_id?: unknown; quantity?: unknown };
          if (stringify(line.variant_id) !== variantId) return total;
          return total + Number(line.quantity ?? 0);
        }, 0);
      },
    },

    /**
     * A form's errors as a list a customer can act on.
     *
     * The messages are translated through the theme's own strings where they
     * exist, because "email" and "Email address" are different words to a
     * customer and only the theme knows which it uses.
     */
    {
      name: 'default_errors',
      returnsHtml: true,
      apply: (context, value) => {
        const errors = value as { messages?: unknown; translated_fields?: unknown } | null;
        const messages = errors?.messages;
        if (!messages || typeof messages !== 'object') return '';

        const fields = (errors?.translated_fields ?? {}) as Record<string, unknown>;
        const items = Object.entries(messages as Record<string, unknown>)
          .map(([field, message]) => {
            const label = stringify(fields[field] ?? field);
            const text = field === 'form' ? stringify(message) : `${label} ${stringify(message)}`;
            return `<li>${escapeHtml(text)}</li>`;
          })
          .join('');

        return items === '' ? '' : `<ul class="errors">${items}</ul>`;
      },
    },

    /**
     * A weight with the store's unit, formatted for reading.
     *
     * Grams are the storage unit and almost never the display unit — 1500 g is
     * shown as 1.5 kg — so the conversion is here rather than in every theme.
     */
    {
      name: 'weight_with_unit',
      apply: (_context, value, args) => {
        const grams = Number(stringify(value));
        if (!Number.isFinite(grams)) return '';

        const unit = stringify(arg(args, 0)) || 'kg';
        const factors: Readonly<Record<string, number>> = {
          g: 1,
          kg: 1000,
          oz: 28.349523125,
          lb: 453.59237,
        };
        const factor = factors[unit];
        if (factor === undefined) return `${grams} g`;

        const converted = grams / factor;
        // Whole numbers stay whole; the rest get one decimal. "1 kg" reads
        // better than "1.0 kg", and "1.5 kg" is more useful than "2 kg".
        const shown = Number.isInteger(converted) ? String(converted) : converted.toFixed(1);
        return `${shown} ${unit}`;
      },
    },

    /**
     * JSON-LD for a product, which is what search engines read for rich results.
     *
     * Emitted as the object rather than the script tag, so a theme decides where
     * it goes. PLAN/07 lists JSON-LD as missing at the platform level; this is
     * the theme-facing half of it.
     */
    {
      name: 'structured_data',
      returnsHtml: true,
      apply: (context, value) => {
        const product = value as Record<string, unknown> | null;
        if (!product || typeof product !== 'object') return '';

        const data = {
          '@context': 'https://schema.org/',
          '@type': 'Product',
          name: stringify(product.title),
          description: stringify(product.description).replace(/<[^>]*>/g, ''),
          sku: stringify(product.sku) || undefined,
          brand: product.vendor ? { '@type': 'Brand', name: stringify(product.vendor) } : undefined,
          offers: {
            '@type': 'Offer',
            price: stringify(product.price),
            priceCurrency: context.currency,
            availability: product.available
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
          },
        };

        /**
         * `</script>` inside the JSON would close the tag the theme wrapped this
         * in and turn a product description into markup. Escaping the sequence
         * is the standard defence and it survives `JSON.parse` unchanged.
         */
        return JSON.stringify(data).replace(/</g, '\\u003c');
      },
    },

    /**
     * The cart lines for one product, across all its variants.
     *
     * Distinct from `item_count_for_variant`, which answers "how many of this
     * exact variant" — this answers "is this product in the cart at all", which
     * is what a product page needs to show "already in your cart".
     */
    {
      name: 'line_items_for',
      apply: (_context, value, args) => {
        const cart = value as { items?: unknown } | null;
        const items = Array.isArray(cart?.items) ? cart.items : [];
        const target = arg(args, 0) as { id?: unknown } | null;
        const id = stringify(target?.id ?? target);
        if (id === '') return [];

        return items.filter((item) => {
          const line = item as { product_id?: unknown; variant_id?: unknown };
          return stringify(line.product_id) === id || stringify(line.variant_id) === id;
        });
      },
    },

    /**
     * A customer's avatar, or nothing.
     *
     * Nothing rather than a generated initials image: a theme that wants a
     * fallback can test for empty and render its own, whereas one handed a
     * placeholder cannot tell it apart from a real picture.
     */
    {
      name: 'avatar',
      returnsHtml: true,
      apply: (_context, value) => {
        const customer = value as { image?: unknown; name?: unknown } | null;
        const src = stringify((customer?.image as { src?: unknown } | undefined)?.src);
        if (src === '') return '';
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(stringify(customer?.name))}" class="avatar">`;
      },
    },

    /**
     * Pagination links, when a theme has not written its own.
     *
     * Deliberately plain. A theme that cares renders `paginate.parts` itself;
     * this exists so one that does not still gets working navigation rather
     * than a page-one-only listing.
     */
    {
      name: 'default_pagination',
      returnsHtml: true,
      apply: (_context, value) => {
        const paginate = value as { parts?: unknown; previous?: unknown; next?: unknown } | null;
        const parts = Array.isArray(paginate?.parts) ? paginate.parts : [];
        if (parts.length === 0) return '';

        const link = (part: unknown): string => {
          const entry = part as { url?: unknown; title?: unknown; is_link?: unknown };
          const title = escapeHtml(stringify(entry.title));
          return entry.is_link
            ? `<a href="${escapeHtml(stringify(entry.url))}">${title}</a>`
            : `<span class="current">${title}</span>`;
        };

        return `<span class="pagination">${parts.map(link).join(' ')}</span>`;
      },
    },

    /**
     * A currency picker, when the store offers more than one.
     *
     * Renders nothing for a single-currency store rather than a select with one
     * option, which is a control that does nothing and still takes a tab stop.
     */
    {
      name: 'currency_selector',
      returnsHtml: true,
      apply: (context, value) => {
        const form = value as { available_currencies?: unknown } | null;
        const available = Array.isArray(form?.available_currencies)
          ? form.available_currencies
          : [];
        if (available.length < 2) return '';

        const options = available
          .map((entry) => {
            const currency = entry as { iso_code?: unknown; name?: unknown };
            const code = stringify(currency.iso_code);
            const selected = code === context.currency ? ' selected' : '';
            return `<option value="${escapeHtml(code)}"${selected}>${escapeHtml(
              stringify(currency.name) || code,
            )}</option>`;
          })
          .join('');

        return `<select name="currency_code" class="currency-selector">${options}</select>`;
      },
    },

    // The three that wait for checkout. See the header.
    { name: 'payment_button', returnsHtml: true, apply: () => '' },
    { name: 'payment_terms', returnsHtml: true, apply: () => '' },
    { name: 'login_button', returnsHtml: true, apply: () => '' },
  ],
};
