/**
 * Storefront · engine/markup.ts
 * Building HTML that a filter is allowed to return unescaped.
 *
 * Several filters emit tags — `image_tag`, `stylesheet_tag`, `video_tag` — and
 * those are marked `returnsHtml`, which means the engine will not escape them.
 * That makes this file the place where a theme's values become markup, so it is
 * the place where they get escaped. Everything goes through `attributes()`; no
 * filter concatenates a value into a tag by hand.
 *
 * The attribute allow-list is the other half. A theme passing
 * `onload: "steal()"` to `image_tag` would otherwise get an event handler on the
 * page, and a theme is untrusted code.
 * Layer: engine (pure).
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] as string);
}

/**
 * Attribute names a theme may set on a tag we build.
 *
 * An allow-list rather than a deny-list of `on*`. A deny-list has to predict
 * every way markup can execute — `srcdoc`, `formaction`, `style` with a `url()`
 * — and it only has to be wrong once.
 */
const SAFE_ATTRIBUTE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;

const FORBIDDEN_PREFIXES = ['on'];

/**
 * Whether a theme-supplied attribute name is one we will emit.
 *
 * `data-*` and `aria-*` pass because themes rely on them heavily — the reference
 * theme calls `model_viewer_tag` with `data-model-id` — and neither can execute.
 */
export function isSafeAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  if (!SAFE_ATTRIBUTE.test(lower)) return false;
  if (FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return true;
}

export type AttributeValue = string | number | boolean | null | undefined;

/**
 * Renders attributes, dropping anything empty or unsafe.
 *
 * `true` renders the bare attribute (`autoplay`), `false` and nullish drop it
 * entirely — which is what lets a filter pass an option straight through
 * without checking whether the theme set it.
 */
export function attributes(pairs: Readonly<Record<string, AttributeValue>>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(pairs)) {
    if (value === null || value === undefined || value === false || value === '') continue;
    if (!isSafeAttribute(name)) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escapeHtml(String(value))}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/**
 * A URL a theme supplied, if it is one we will put in an attribute.
 *
 * `javascript:` and `data:` are the two that turn an `href` into code. Relative
 * and protocol-relative URLs are fine and extremely common in themes, so the
 * check is on the scheme rather than on the shape.
 */
export function safeUrl(value: string): string {
  const trimmed = value.trim();
  // Control characters are stripped first: `java\nscript:` is a real bypass.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed.replace(/[\u0000-\u0020]/g, ''));
  if (scheme) {
    const protocol = (scheme[1] as string).toLowerCase();
    if (protocol !== 'http' && protocol !== 'https' && protocol !== 'mailto' && protocol !== 'tel') {
      return '';
    }
  }
  return trimmed;
}
