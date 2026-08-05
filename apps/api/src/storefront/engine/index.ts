/**
 * Storefront · engine/index.ts
 * The engine's public surface.
 *
 * Callers import from here and get an interface; they never see liquidjs. That
 * is the whole point of the directory, and `no-direct-liquid` in the fitness
 * suite is what keeps it true.
 * Layer: engine.
 */

export { createThemeEngine, type EngineOptions } from './liquid';
export { defaultContext, type MoneyFormats, type RenderContext } from './context';
export type { FilterArgs, FilterDefinition, FilterGroup, ThemeEngine } from './types';
export { FILTER_GROUPS, allFilters, handleize } from './filters';
export { attributes, escapeHtml, isSafeAttribute, safeUrl } from './markup';
