/**
 * Core · platform-state/index.ts
 * The operator's controls: which modules are available, and where each setting's
 * value comes from. Both are layered, and the two layer in opposite directions —
 * see each service for why.
 * Layer: core.
 */

export * from './module-state.service';
export * from './settings.service';
