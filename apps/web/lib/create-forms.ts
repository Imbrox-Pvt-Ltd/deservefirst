/**
 * Web · lib/create-forms.ts
 * What each "new" screen asks for.
 *
 * Nine create screens written nine times would be nine places to fix the next
 * thing we learn about creating records. They are declared here instead, and one
 * form renders all of them — the same argument as the Entity Toolkit, applied to
 * the one screen that had escaped it.
 *
 * Each form asks for the LEAST that makes a valid record. Everything else
 * belongs on the detail screen, where there is room for it and where the record
 * already exists to hang it from — a create form that demands twelve fields is
 * how a merchant ends up with a spreadsheet of things they meant to add.
 * Layer: web/lib.
 */

export type CreateFieldKind = 'text' | 'textarea' | 'email' | 'select' | 'date' | 'money';

export interface CreateField {
  readonly name: string;
  readonly label: string;
  readonly kind?: CreateFieldKind;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly helpText?: string;
  readonly options?: readonly { label: string; value: string }[];
  /** Named source of options resolved by the page, e.g. the store's locations. */
  readonly optionsFrom?: 'locations';
  /**
   * Another field this one must not start out equal to.
   *
   * Two selects over the same list both defaulted to the first option, so a new
   * transfer opened with the same location in From and To and was refused the
   * instant it was saved — the form arrived pre-broken and blamed the merchant.
   */
  readonly distinctFrom?: string;
}

export interface CreateFormSpec {
  readonly title: string;
  readonly submitLabel: string;
  /** Where the list lives, for the back action and after a cancel. */
  readonly listPath: (handle: string) => string;
  /** Where to land once it exists, so the merchant carries on editing. */
  readonly detailPath: (handle: string, id: string) => string;
  readonly fields: readonly CreateField[];
}

export type CreateKind =
  | 'product' | 'collection' | 'customer' | 'request'
  | 'page' | 'purchase-order' | 'transfer' | 'metaobject-definition'
  | 'segment' | 'company'
  | 'menu' | 'blog-post';

const store = (handle: string) => `/store/${handle}`;

export const CREATE_FORMS: Readonly<Record<CreateKind, CreateFormSpec>> = {
  product: {
    title: 'Add product',
    submitLabel: 'Save product',
    listPath: (h) => `${store(h)}/products`,
    detailPath: (h, id) => `${store(h)}/products/${id}`,
    fields: [
      { name: 'title', label: 'Title', required: true, placeholder: 'Short sleeve t-shirt' },
      { name: 'description', label: 'Description', kind: 'textarea' },
      {
        name: 'price',
        label: 'Price',
        kind: 'money',
        required: true,
        helpText: 'A product with no price cannot be published.',
      },
    ],
  },

  collection: {
    title: 'Create collection',
    submitLabel: 'Save collection',
    listPath: (h) => `${store(h)}/collections`,
    detailPath: (h, id) => `${store(h)}/collections/${id}`,
    fields: [
      { name: 'title', label: 'Title', required: true, placeholder: 'Summer sale' },
      { name: 'description', label: 'Description', kind: 'textarea' },
    ],
  },

  customer: {
    title: 'New customer',
    submitLabel: 'Save customer',
    listPath: (h) => `${store(h)}/customers`,
    detailPath: (h, id) => `${store(h)}/customers/${id}`,
    fields: [
      { name: 'firstName', label: 'First name' },
      { name: 'lastName', label: 'Last name' },
      {
        name: 'email',
        label: 'Email',
        kind: 'email',
        helpText: 'One shopper, one record — a duplicate email is refused.',
      },
      { name: 'phone', label: 'Phone' },
    ],
  },

  request: {
    title: 'Create request',
    submitLabel: 'Create request',
    listPath: (h) => `${store(h)}/requests`,
    detailPath: (h, id) => `${store(h)}/requests/${id}`,
    fields: [
      { name: 'contactName', label: 'Contact name' },
      {
        name: 'contactEmail',
        label: 'Contact email',
        kind: 'email',
        // The domain refuses a request that reaches nobody. Marking it required
        // here says so before the save rather than after it.
        required: true,
        helpText: 'A quote has to reach someone.',
      },
      {
        name: 'currency',
        label: 'Currency',
        kind: 'select',
        required: true,
        options: [
          { label: 'USD — US Dollar', value: 'USD' },
          { label: 'EUR — Euro', value: 'EUR' },
          { label: 'GBP — Pound Sterling', value: 'GBP' },
          { label: 'INR — Indian Rupee', value: 'INR' },
        ],
        helpText: 'Every line on the request is priced in this currency.',
      },
      { name: 'note', label: 'Note', kind: 'textarea' },
    ],
  },

  menu: {
    title: 'Add menu',
    submitLabel: 'Save menu',
    listPath: (h) => `${store(h)}/navigation`,
    detailPath: (h, id) => `${store(h)}/navigation/${id}`,
    fields: [
      { name: 'title', label: 'Title', required: true, placeholder: 'Main menu' },
      {
        name: 'handle',
        label: 'Handle',
        required: true,
        placeholder: 'main-menu',
        // The handle is what a theme references, so it is asked for rather than
        // derived — a menu whose handle silently changed would break a theme.
        helpText: 'Themes reference a menu by its handle. It cannot be changed later.',
      },
    ],
  },

  'blog-post': {
    title: 'Add blog post',
    submitLabel: 'Save post',
    listPath: (h) => `${store(h)}/blogs`,
    detailPath: (h, id) => `${store(h)}/blogs/${id}`,
    fields: [
      { name: 'title', label: 'Title', required: true, placeholder: 'Our new collection' },
      { name: 'blogId', label: 'Blog', required: true, helpText: 'Which blog this post belongs to.' },
      {
        name: 'body',
        label: 'Content',
        kind: 'textarea',
        helpText: 'Posts start as drafts. Publishing needs content and a date.',
      },
    ],
  },

  page: {
    title: 'Add page',
    submitLabel: 'Save page',
    listPath: (h) => `${store(h)}/pages`,
    detailPath: (h, id) => `${store(h)}/pages/${id}`,
    fields: [
      { name: 'title', label: 'Title', required: true, placeholder: 'About us' },
      {
        name: 'body',
        label: 'Content',
        kind: 'textarea',
        helpText: 'Pages start hidden. Publishing needs content.',
      },
    ],
  },

  'purchase-order': {
    title: 'Create purchase order',
    submitLabel: 'Create purchase order',
    listPath: (h) => `${store(h)}/purchase_orders`,
    detailPath: (h, id) => `${store(h)}/purchase_orders/${id}`,
    fields: [
      { name: 'supplierName', label: 'Supplier', required: true, placeholder: 'Acme Supply' },
      {
        name: 'destinationLocationId',
        label: 'Destination',
        kind: 'select',
        required: true,
        optionsFrom: 'locations',
        helpText: 'Where the stock will arrive.',
      },
      { name: 'expectedAt', label: 'Expected arrival', kind: 'date' },
    ],
  },

  transfer: {
    title: 'Create transfer',
    submitLabel: 'Create transfer',
    listPath: (h) => `${store(h)}/transfers`,
    detailPath: (h, id) => `${store(h)}/transfers/${id}`,
    fields: [
      { name: 'originLocationId', label: 'From', kind: 'select', required: true, optionsFrom: 'locations' },
      {
        name: 'destinationLocationId',
        label: 'To',
        kind: 'select',
        required: true,
        optionsFrom: 'locations',
        distinctFrom: 'originLocationId',
        helpText: 'A transfer needs two different locations.',
      },
    ],
  },

  segment: {
    title: 'Create segment',
    submitLabel: 'Save segment',
    listPath: (h) => `${store(h)}/customers/segments`,
    detailPath: (h, id) => `${store(h)}/customers/segments/${id}`,
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Subscribed customers' },
      {
        name: 'firstCondition',
        label: 'Customers where',
        kind: 'select',
        required: true,
        options: [
          { label: 'Subscribed to email', value: 'emailConsent:subscribed' },
          { label: 'Not subscribed to email', value: 'emailConsent:not-subscribed' },
          { label: 'Account enabled', value: 'state:enabled' },
          { label: 'Account disabled', value: 'state:disabled' },
        ],
        helpText: 'A segment needs at least one condition. Refine it after saving.',
      },
    ],
  },

  company: {
    title: 'Add company',
    submitLabel: 'Save company',
    listPath: (h) => `${store(h)}/companies`,
    detailPath: (h, id) => `${store(h)}/companies/${id}`,
    fields: [
      { name: 'name', label: 'Company name', required: true, placeholder: 'Northwind Trading' },
      {
        name: 'externalId',
        label: 'Their reference',
        helpText: 'What this buyer calls themselves — often your vendor number with them.',
      },
      {
        name: 'locationName',
        label: 'First location',
        required: true,
        placeholder: 'Head office',
        helpText: 'A company needs somewhere to ship and terms to bill on. Add more after saving.',
      },
      {
        name: 'countryCode',
        label: 'Country',
        required: true,
        placeholder: 'GB',
        helpText: 'Two-letter ISO code.',
      },
    ],
  },

  'metaobject-definition': {
    title: 'Add definition',
    submitLabel: 'Save definition',
    listPath: (h) => `${store(h)}/content/metaobjects`,
    detailPath: (h, id) => `${store(h)}/content/metaobjects/${id}`,
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'Author' },
      {
        name: 'type',
        label: 'Type',
        required: true,
        placeholder: 'author',
        helpText: 'lower_snake_case, and permanent — entries are stored against it.',
      },
      {
        name: 'firstFieldName',
        label: 'First field',
        required: true,
        placeholder: 'Full name',
        helpText: 'A definition needs at least one field. Add the rest after saving.',
      },
    ],
  },
};

/** `Full name` → `full_name`, for a field key derived from what was typed. */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'f$1');
}
