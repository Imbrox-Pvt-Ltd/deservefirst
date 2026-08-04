/**
 * UI · index.ts
 * The shared design system: brand theme over Polaris, the four screen templates,
 * the Entity Toolkit panels, and the navigation model. A module author fills
 * these templates; they never design a screen from scratch (§8.3).
 * Layer: ui.
 */

export * from './primitives';
export * from './navigation';
export * from './theme/tokens';
export * from './templates/use-list-state';
export * from './templates/ListScreen';
export * from './templates/DetailScreen';
export * from './templates/CreateScreen';
export * from './templates/SettingsScreen';
export * from './templates/toolkit-panels';
