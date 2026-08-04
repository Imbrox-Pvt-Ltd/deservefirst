'use client';

/**
 * Web · components/ErrorState.tsx
 * Failure UI shared by every screen. A client component because the design
 * system relies on React context, which server components cannot provide.
 * Layer: web.
 */

import { Banner, Page } from '@deservefirst/ui';

export function ErrorState({
  title,
  pageTitle,
  message,
  hint,
  tone = 'critical',
  backUrl,
}: {
  title: string;
  pageTitle: string;
  message: string;
  hint?: string;
  tone?: 'critical' | 'warning';
  backUrl?: string;
}) {
  return (
    <Page
      title={pageTitle}
      backAction={backUrl ? { content: 'Back', url: backUrl } : undefined}
    >
      <Banner tone={tone} title={title}>
        <p>{message}</p>
        {hint && <p>{hint}</p>}
      </Banner>
    </Page>
  );
}
