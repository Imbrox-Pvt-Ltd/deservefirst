/**
 * Contracts · ui-extension.ts
 * What a third party's UI extension is allowed to say (§22.2).
 *
 * An extension does not render. It DESCRIBES — it sends a tree of component
 * names and props, and the host renders those names with its own trusted
 * components. That single decision is the sandbox: an extension cannot express
 * a `<script>`, cannot set inner HTML, cannot reach the DOM, because none of
 * those are things the vocabulary can say.
 *
 * The alternative — handing an extension an element and letting it write into
 * it — is what makes a plugin system a vulnerability. There is no amount of
 * sanitising that makes "here is the page, do what you like" safe, and the
 * whole point of §22.4 is not to be in that position.
 *
 * This lives in contracts because it is the agreement between an extension
 * author and the platform, and both halves — the host that renders and the
 * validator that refuses — must read it from the same place.
 * Layer: contracts (pure types and rules, no I/O).
 */

/**
 * Every component an extension may ask for.
 *
 * Deliberately small, and deliberately not the design system's full surface.
 * Each entry is something a third party may put in front of a merchant, so the
 * list grows by argument rather than by convenience — and nothing that takes a
 * URL, embeds anything, or renders markup is on it.
 */
export const EXTENSION_COMPONENTS = [
  'Stack',
  'Text',
  'Heading',
  'Badge',
  'Button',
  'Divider',
  'Banner',
  'List',
  'ListItem',
  'Field',
] as const;

export type ExtensionComponent = (typeof EXTENSION_COMPONENTS)[number];

/** Prop values an extension may send. Deliberately not `unknown`. */
export type ExtensionPropValue = string | number | boolean | null;

export interface ExtensionNode {
  readonly component: ExtensionComponent;
  readonly props?: Readonly<Record<string, ExtensionPropValue>>;
  readonly children?: readonly ExtensionNode[];
}

export class ExtensionTreeError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ExtensionTreeError';
  }
}

/**
 * Bounds. A tree from an untrusted author needs all three.
 *
 * Depth stops a recursive generator from blowing the renderer's stack; node
 * count stops an extension from making a merchant's admin unusable by
 * describing fifty thousand badges; text length stops one from hiding a page of
 * content inside a label.
 */
export const MAX_TREE_DEPTH = 8;
export const MAX_TREE_NODES = 300;
export const MAX_TEXT_LENGTH = 2_000;

/**
 * Props each component understands.
 *
 * An allow-list per component rather than one global list, because `tone` on a
 * Banner and `tone` on a Button mean different things and a prop nobody
 * declared is a prop the host would pass through to a real component without
 * knowing what it does.
 */
const ALLOWED_PROPS: Readonly<Record<ExtensionComponent, readonly string[]>> = {
  Stack: ['direction', 'gap'],
  Text: ['content', 'tone', 'variant'],
  Heading: ['content'],
  Badge: ['content', 'tone'],
  // No `url`: a button an extension can point anywhere is an open redirect
  // with a merchant's session attached. Extensions raise an ACTION by id and
  // the host decides what that means.
  Button: ['label', 'action', 'tone', 'disabled'],
  Divider: [],
  Banner: ['title', 'content', 'tone'],
  List: [],
  ListItem: ['content'],
  Field: ['label', 'value', 'name', 'disabled'],
};

/** Prop values that are enumerations rather than free text. */
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  tone: ['info', 'success', 'warning', 'critical', 'subdued'],
  direction: ['horizontal', 'vertical'],
  variant: ['bodySm', 'bodyMd', 'headingSm', 'headingMd'],
  gap: ['100', '200', '300', '400'],
};

/**
 * Refuses anything the host cannot safely render.
 *
 * Called on the host side, on data that arrived from a worker. It must assume
 * the tree is hostile rather than merely wrong — an extension that has been
 * compromised sends exactly the shape that would slip through a check written
 * for honest mistakes.
 */
export function assertTreeValid(node: unknown, depth = 1, counter = { nodes: 0 }): void {
  if (depth > MAX_TREE_DEPTH) {
    throw new ExtensionTreeError(`the tree nests deeper than ${MAX_TREE_DEPTH} levels`);
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new ExtensionTreeError('every node must be an object');
  }

  counter.nodes += 1;
  if (counter.nodes > MAX_TREE_NODES) {
    throw new ExtensionTreeError(`the tree has more than ${MAX_TREE_NODES} nodes`);
  }

  const candidate = node as { component?: unknown; props?: unknown; children?: unknown };

  if (typeof candidate.component !== 'string') {
    throw new ExtensionTreeError('every node needs a component name');
  }
  if (!EXTENSION_COMPONENTS.includes(candidate.component as ExtensionComponent)) {
    // Named, because an author who typed `Card` should be told the vocabulary
    // does not have one rather than watch their extension render nothing.
    throw new ExtensionTreeError(
      `"${candidate.component}" is not a component extensions may use`,
    );
  }

  const component = candidate.component as ExtensionComponent;
  const allowed = ALLOWED_PROPS[component];

  if (candidate.props !== undefined) {
    if (typeof candidate.props !== 'object' || candidate.props === null) {
      throw new ExtensionTreeError(`props on <${component}> must be an object`);
    }

    for (const [key, value] of Object.entries(candidate.props)) {
      if (!allowed.includes(key)) {
        // The check that stops `dangerouslySetInnerHTML`, `style`, `onClick`
        // and every other prop somebody hopes the host will pass through.
        throw new ExtensionTreeError(`<${component}> does not take a "${key}" prop`);
      }
      assertPropValue(component, key, value);
    }
  }

  if (candidate.children !== undefined) {
    if (!Array.isArray(candidate.children)) {
      throw new ExtensionTreeError(`children of <${component}> must be a list`);
    }
    for (const child of candidate.children) assertTreeValid(child, depth + 1, counter);
  }
}

function assertPropValue(component: ExtensionComponent, key: string, value: unknown): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ExtensionTreeError(`<${component}> "${key}" must be a finite number`);
    }
    return;
  }

  if (typeof value !== 'string') {
    // Objects and arrays are refused outright. A prop that can carry a nested
    // structure is a prop that can carry something the host will spread.
    throw new ExtensionTreeError(`<${component}> "${key}" must be text, a number or true/false`);
  }

  if (value.length > MAX_TEXT_LENGTH) {
    throw new ExtensionTreeError(`<${component}> "${key}" is longer than ${MAX_TEXT_LENGTH}`);
  }

  const enumeration = ENUMS[key];
  if (enumeration && !enumeration.includes(value)) {
    throw new ExtensionTreeError(
      `<${component}> "${key}" must be one of ${enumeration.join(', ')}`,
    );
  }
}

/** Every action id a tree raises, so a host can wire only the ones it declared. */
export function actionsIn(node: ExtensionNode): readonly string[] {
  const here = typeof node.props?.action === 'string' ? [node.props.action] : [];
  const below = (node.children ?? []).flatMap((child) => actionsIn(child));
  return [...here, ...below];
}
