/**
 * Web · app/layout.tsx
 * The root document. Deliberately thin: the admin shell lives under
 * /store/[handle] because it needs an active store, and screens outside a store
 * (the picker, auth) must not render store chrome.
 * Layer: web.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { branding } from '@deservefirst/config';

import '@deservefirst/ui/styles.css';

import { Providers } from './providers';

export const metadata: Metadata = {
  title: branding.platformName,
  description: 'Commerce platform admin',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
