/**
 * Storefront · domain/theme-settings.ts
 * The merchant's choices about how their theme looks.
 *
 * Nothing loaded these either. `StorefrontData.settings()` returned `{}` with a
 * comment saying the theme source reads them, and nothing did — so every
 * `{{ settings.x }}` in a theme was empty. The reference theme reads 521
 * distinct settings keys: its colour scheme, its fonts, its heading sizes, its
 * button styles, whether badges show, what the logo is. All of it was unset,
 * and the theme fell back to whatever its own Liquid defaults happened to be.
 *
 * The same shape of fault as the missing translations, and less visible: a
 * missing translation announces itself on the page, while a missing setting
 * just renders a slightly different design that nobody can prove is wrong.
 *
 * `current` is the live configuration, and it is either the settings themselves
 * or the NAME of one of the presets. Both forms are real — a theme ships with
 * presets and a merchant who has never opened the editor is still on one by
 * name — so a reader that handled only the object form would return nothing for
 * a freshly installed theme, which is exactly when it matters most.
 * Layer: domain (pure).
 */

import { resolveFontSettings } from './font-handle';

export interface ThemeSettingsFile {
  readonly current?: unknown;
  readonly presets?: unknown;
}

/**
 * The live settings from a `config/settings_data.json`.
 *
 * Returns an empty object for anything malformed rather than throwing. A
 * settings file a merchant has broken should cost them their colours, not their
 * storefront — and the theme's own defaults are a reasonable page.
 */
export function resolveThemeSettings(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') return {};

  const file = raw as ThemeSettingsFile;
  const current = file.current;

  // The ordinary case: `current` holds the settings.
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    return resolveFontSettings(current as Record<string, unknown>);
  }

  /**
   * `current` naming a preset, which is how a theme ships before anyone edits.
   *
   * Broadcast has three — Broadcast, Relay and Airwave — and a store on the
   * default one has `"current": "Broadcast"` until the editor writes over it.
   * Reading only the object form would give that store no settings at all.
   */
  if (typeof current === 'string') {
    const presets = file.presets;
    if (presets !== null && typeof presets === 'object' && !Array.isArray(presets)) {
      const chosen = (presets as Record<string, unknown>)[current];
      if (chosen !== null && typeof chosen === 'object' && !Array.isArray(chosen)) {
        return resolveFontSettings(chosen as Record<string, unknown>);
      }
    }
  }

  return {};
}
