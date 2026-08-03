/**
 * UI · theme/tokens.ts
 * Brand tokens layered over the base design system (§8.1). Every screen consumes
 * these, so re-theming or swapping the underlying component library never
 * changes a screen — which is the whole reason the templates sit behind this
 * package.
 * Layer: ui.
 */

import { branding } from '@deservefirst/config';

/**
 * Values map onto Polaris custom properties. Keeping them here rather than in
 * component files is what makes a rebrand a single edit.
 */
export const brandTokens = {
  '--p-color-bg-fill-brand': '#1f6feb',
  '--p-color-bg-fill-brand-hover': '#1a5fd0',
  '--p-color-bg-fill-brand-active': '#154fb0',
  '--p-color-text-brand-on-bg-fill': '#ffffff',
  '--p-color-border-brand': '#1f6feb',
  '--p-border-radius-200': '8px',
} as const satisfies Record<string, string>;

export const themeMeta = {
  platformName: branding.platformName,
  logoLight: branding.logo.light,
  logoDark: branding.logo.dark,
  mark: branding.logo.mark,
} as const;

/** Inline style object for the app shell's root element. */
export function brandStyle(): Record<string, string> {
  return { ...brandTokens };
}
