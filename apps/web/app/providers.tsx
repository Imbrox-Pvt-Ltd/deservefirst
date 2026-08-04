'use client';

/**
 * Web · app/providers.tsx
 * Design-system provider and brand theme. Every screen renders inside this, so
 * re-theming or swapping the underlying component library is a change here and
 * nowhere else (§8.1).
 * Layer: web.
 */

import enTranslations from '@deservefirst/ui/locales/en.json';
import type { ReactNode } from 'react';
import {
  AppProvider,
  brandStyle,
} from '@deservefirst/ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppProvider i18n={enTranslations}>
      <div style={brandStyle()}>{children}</div>
    </AppProvider>
  );
}
