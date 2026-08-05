/**
 * Storefront · engine/tags/structure.ts
 * paginate, form, section and sections.
 *
 * These are the tags that change what the body of a template sees or where the
 * markup comes from, and each of them exists because the alternative is worse:
 *
 *   paginate — a theme slicing a collection itself gets the offset wrong on the
 *              last page and the URLs wrong on all of them.
 *   form     — a theme writing its own `<form>` writes its own action and its
 *              own CSRF handling, which is a security control per theme.
 *   section  — the unit a merchant reorders; a theme cannot know at author time
 *              which sections a page has.
 * Layer: engine.
 */

import { attributes, escapeHtml } from '../markup';
import { asLiteral, parseTagArgs, type BlockOpening, type TagDefinition } from './types';

/**
 * `{% paginate collection.products by 12 %}`.
 *
 * The tag slices the list and builds the `paginate` object the body reads. It
 * takes the page number from the request rather than from the template, so a
 * theme cannot paginate to a page the URL disagrees with — which would make the
 * back button show different products from the link that produced it.
 */
const paginateTag: TagDefinition = {
  name: 'paginate',
  kind: 'block',
  open: (args, context): BlockOpening => {
    // `<expression> by <n>` — `by` is the reference product's spelling.
    const match = /^(.+?)\s+by\s+(\d+)\s*$/.exec(args.trim());
    const expression = (match?.[1] ?? args).trim();
    const pageSize = match ? Number(match[2]) : 20;

    const source = context.get(expression);
    const items = Array.isArray(source) ? source : [];

    const requested = Number(context.get('request.page') ?? 1);
    const pages = Math.max(1, Math.ceil(items.length / Math.max(1, pageSize)));
    // Clamped rather than trusted: `?page=9999` should render the last page,
    // not an empty one that looks like the collection is broken.
    const currentPage = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 1), pages);
    const offset = (currentPage - 1) * pageSize;

    const basePath = String(context.get('request.path') ?? '/');

    return {
      scope: {
        // The body iterates the SAME name it was given, now holding one page.
        [expression]: items.slice(offset, offset + pageSize),
        paginate: buildPaginate({
          currentPage,
          currentOffset: offset,
          items: items.length,
          pageSize,
          basePath,
        }),
      },
    };
  },
};

interface PaginateInput {
  currentPage: number;
  currentOffset: number;
  items: number;
  pageSize: number;
  basePath: string;
}

/**
 * The pagination object, built here rather than imported from the drops.
 *
 * `domain/drops/global.ts` has `paginateDrop` and this duplicates its shape —
 * deliberately, because the engine layer may not import a drop factory without
 * making every tag depend on the drop context. The two are covered by the same
 * tests to keep them honest.
 */
function buildPaginate(input: PaginateInput): Record<string, unknown> {
  const pages = Math.max(1, Math.ceil(input.items / Math.max(1, input.pageSize)));
  const url = (page: number): string => {
    const [path = '/', query = ''] = input.basePath.split('?');
    const params = new URLSearchParams(query);
    if (page <= 1) params.delete('page');
    else params.set('page', String(page));
    const rendered = params.toString();
    return rendered === '' ? path : `${path}?${rendered}`;
  };

  const shown = new Set([1, pages, input.currentPage - 1, input.currentPage, input.currentPage + 1]);
  const parts: { title: string; url: string; is_link: boolean }[] = [];
  let previous = 0;
  for (let page = 1; page <= pages; page++) {
    if (!shown.has(page)) continue;
    if (page - previous > 1) parts.push({ title: '…', url: '', is_link: false });
    parts.push({
      title: String(page),
      url: page === input.currentPage ? '' : url(page),
      is_link: page !== input.currentPage,
    });
    previous = page;
  }

  return {
    current_page: input.currentPage,
    current_offset: input.currentOffset,
    items: input.items,
    page_size: input.pageSize,
    pages,
    parts,
    previous:
      input.currentPage > 1
        ? { title: '&laquo; Previous', url: url(input.currentPage - 1), is_link: true }
        : null,
    next:
      input.currentPage < pages
        ? { title: 'Next &raquo;', url: url(input.currentPage + 1), is_link: true }
        : null,
  };
}

/**
 * The forms a storefront may post, and where each goes.
 *
 * An allow-list, so a theme cannot invent a form type and have it POST
 * somewhere it chose. This is the security value of the tag: the action and the
 * method are ours, not the theme's.
 */
const FORM_ACTIONS: Readonly<Record<string, { action: string; method: string }>> = {
  contact: { action: '/contact', method: 'post' },
  customer: { action: '/contact', method: 'post' },
  customer_login: { action: '/account/login', method: 'post' },
  customer_register: { action: '/account/register', method: 'post' },
  customer_address: { action: '/account/addresses', method: 'post' },
  recover_customer_password: { action: '/account/recover', method: 'post' },
  new_comment: { action: '/comments', method: 'post' },
  // Phase 1 is request-only (D10), so this is a quote request rather than a
  // cart submission. The theme writes the same tag either way.
  product: { action: '/requests/add', method: 'post' },
  cart: { action: '/requests', method: 'post' },
  localization: { action: '/localization', method: 'post' },
};

const formTag: TagDefinition = {
  name: 'form',
  kind: 'block',
  open: (args, context): BlockOpening => {
    const parsed = parseTagArgs(args);
    const type = asLiteral(parsed.positional[0]) ?? 'contact';
    const known = FORM_ACTIONS[type];

    if (!known) {
      /**
       * An unknown form type renders a comment instead of a form.
       *
       * Not an error: a theme built for another platform may use a form we do
       * not have, and taking the whole page down for it helps nobody. A form
       * that silently posted to the wrong place would be worse than none.
       */
      return {
        before: `<!-- form "${escapeHtml(type)}" is not a form this platform accepts -->`,
        after: '',
        scope: { form: { errors: null, posted_successfully: false } },
      };
    }

    // Extra named arguments become attributes, filtered by the same allow-list
    // the markup helpers use — so `onsubmit:` cannot ride in here.
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.named)) {
      if (key === 'id' || key === 'class') extra[key] = asLiteral(value) ?? String(context.get(value) ?? '');
    }

    const token = String(context.get('form_token') ?? '');

    return {
      before:
        `<form${attributes({ action: known.action, method: known.method, 'accept-charset': 'UTF-8', ...extra })}>` +
        // The forgery token is emitted by the tag, so a theme cannot omit it.
        (token ? `<input type="hidden" name="_token" value="${escapeHtml(token)}">` : '') +
        `<input type="hidden" name="form_type" value="${escapeHtml(type)}">`,
      after: '</form>',
      scope: {
        form: context.get('form') ?? { errors: null, posted_successfully: false },
      },
    };
  },
};

/**
 * `{% section 'name' %}` renders a section file with its stored settings.
 *
 * The settings come from the store's saved configuration rather than from the
 * template, which is what makes a section a thing a merchant edits rather than
 * a snippet a developer includes.
 */
const sectionTag: TagDefinition = {
  name: 'section',
  kind: 'inline',
  render: async (args, context) => {
    const name = asLiteral(args.trim()) ?? args.trim();
    if (name === '') return '';

    const state = context.get(`section_states.${name}`);
    return context.renderFile(`sections/${name}`, {
      section: state ?? { id: name, type: name, settings: {}, blocks: [] },
    });
  },
};

/**
 * `{% sections 'group' %}` renders a whole section group — a header or footer.
 *
 * Groups are how a merchant reorders sections that appear on every page, so the
 * order comes from the stored group rather than from the layout.
 */
const sectionsTag: TagDefinition = {
  name: 'sections',
  kind: 'inline',
  render: async (args, context) => {
    const name = asLiteral(args.trim()) ?? args.trim();
    if (name === '') return '';

    const group = context.get(`section_groups.${name}`) as
      | { order?: readonly string[]; sections?: Record<string, unknown> }
      | undefined;
    if (!group?.order) return '';

    const rendered: string[] = [];
    for (const id of group.order) {
      const state = group.sections?.[id] as { type?: string } | undefined;
      if (!state?.type) continue;
      rendered.push(await context.renderFile(`sections/${state.type}`, { section: state }));
    }
    return rendered.join('');
  },
};

export const structureTags: readonly TagDefinition[] = [
  paginateTag,
  formTag,
  sectionTag,
  sectionsTag,
];
