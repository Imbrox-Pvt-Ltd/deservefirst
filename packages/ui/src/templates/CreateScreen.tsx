/**
 * UI · templates/CreateScreen.tsx
 * The create template (§8.3) — the same form as DetailScreen with an empty
 * state. Sharing the layout is deliberate: a merchant who learns the edit screen
 * already knows the create screen.
 * Layer: ui.
 */

import { DetailScreen, type DetailScreenProps } from './DetailScreen';

export type CreateScreenProps = Omit<DetailScreenProps, 'dirty'> & {
  /** Create is always "dirty" — there is nothing saved to compare against. */
  readonly canSave: boolean;
};

export function CreateScreen({ canSave, ...props }: CreateScreenProps) {
  return <DetailScreen {...props} dirty={canSave} />;
}
