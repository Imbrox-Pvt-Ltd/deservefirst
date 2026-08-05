/**
 * Storefront · engine/tags/theme.ts
 * The tags whose bodies are not Liquid: schema, javascript, stylesheet, doc, style.
 *
 * Four of these capture their body as text and never parse it, and that is not
 * an optimisation — `{% schema %}` contains JSON and `{% javascript %}` contains
 * JavaScript, both full of braces that Liquid would try to read as output. A
 * theme's schema block would fail to parse on its first `{"`.
 *
 * `{% style %}` is the exception and the reason `raw` and `block` are separate
 * kinds: its body IS Liquid, because the entire point is interpolating a
 * merchant's colour settings into CSS.
 * Layer: engine.
 */

import { escapeHtml } from '../markup';
import type { TagDefinition } from './types';

/**
 * `{% schema %}` renders nothing.
 *
 * The block is configuration read when a theme is uploaded, not content. It is
 * how the editor knows what settings a section has, and by the time a page
 * renders that question is long since answered — emitting it would put the
 * theme's own JSON on the page.
 */
const schemaTag: TagDefinition = {
  name: 'schema',
  kind: 'raw',
  render: () => '',
};

/** `{% doc %}` is documentation for the next person reading the file. */
const docTag: TagDefinition = {
  name: 'doc',
  kind: 'raw',
  render: () => '',
};

/**
 * `{% javascript %}` and `{% stylesheet %}` are collected, not emitted here.
 *
 * The reference product gathers every section's block and serves them as one
 * file, which is why a section can declare its own script without adding a
 * request per section. We do not have that pipeline yet, so they render inline
 * — correct, and slower than it will be.
 *
 * Inline is the honest interim: dropping them would break every section that
 * relies on its own behaviour, and pretending to bundle would be worse.
 */
const javascriptTag: TagDefinition = {
  name: 'javascript',
  kind: 'raw',
  // Nonced, so it survives a CSP that forbids inline script. A theme's own
  // JavaScript is code the platform chose to emit; injected script is not.
  render: (body, _args, context) => `<script${nonceAttr(context)}>${body}</script>`,
};

const stylesheetTag: TagDefinition = {
  name: 'stylesheet',
  kind: 'raw',
  render: (body, _args, context) => `<style${nonceAttr(context)}>${body}</style>`,
};

/** The nonce attribute, or nothing when no policy is being sent. */
function nonceAttr(context: { render: { nonce?: string | null } }): string {
  const nonce = context.render.nonce;
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
}

/**
 * `{% style %}` wraps its body in a style element, having rendered it.
 *
 * A block tag rather than a raw one: themes write
 * `color: {{ section.settings.text }}` inside, and capturing the body as text
 * would put the literal braces into the page's CSS.
 *
 * What it does NOT do is sanitise. The body is theme-authored CSS and Liquid
 * has no expression that can close a `</style>`; the values interpolated into it
 * are the merchant's own settings, already constrained by the setting types in
 * `settings-schema.ts`. Sanitising CSS properly is a parser, and a
 * half-sanitiser would be a false promise.
 */
const styleTag: TagDefinition = {
  name: 'style',
  kind: 'block',
  open: (_args, context) => ({ before: `<style${nonceAttr(context)}>`, after: '</style>' }),
};

/**
 * `{% content_for %}` is where the platform injects into a theme.
 *
 * Two forms matter: `'app'`, which is where an installed app's block renders,
 * and `'additional_checkout_buttons'`, which has nothing to render in Phase 1.
 * An unknown target renders a comment rather than nothing, so a developer can
 * see in the page source that the tag was recognised and had no content —
 * silence looks identical to a tag that failed.
 */
const contentForTag: TagDefinition = {
  name: 'content_for',
  kind: 'inline',
  render: (args, context) => {
    const target = args.trim().replace(/^['"]|['"]$/g, '');

    if (target === 'app' || target === 'app_blocks') {
      const render = context.render as unknown as {
        appBlocks?: () => string;
      };
      return render.appBlocks?.() ?? `<!-- content_for "${escapeHtml(target)}": no app blocks -->`;
    }

    return `<!-- content_for "${escapeHtml(target)}": nothing to render -->`;
  },
};

export const themeTags: readonly TagDefinition[] = [
  schemaTag,
  docTag,
  javascriptTag,
  stylesheetTag,
  styleTag,
  contentForTag,
];
