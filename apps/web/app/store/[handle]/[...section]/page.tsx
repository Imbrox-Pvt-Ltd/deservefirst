'use client';

/**
 * Web · app/store/[handle]/[...section]/page.tsx
 * Catches store paths that no module provides a screen for.
 *
 * The navigation shows the product's whole information architecture, including
 * sections no module in this install implements yet (§8.2). Those entries are
 * therefore reachable on purpose, and reaching one must not look like a broken
 * application — the default 404 says "this address is wrong", which is a
 * different and more alarming claim than "this part is not installed".
 *
 * More specific routes always win in the App Router, so this only ever renders
 * for paths nothing else claimed. It is a client component because the design
 * system it renders through is one, and pulling that barrel into a server
 * component evaluates the component library outside the browser.
 * Layer: web.
 */

import { notFound } from 'next/navigation';
import { use } from 'react';

import { coreNavigation, UnavailableSection, type NavItem } from '@deservefirst/ui';

/**
 * Finds the nav entry for a path so the placeholder is titled as the menu is.
 *
 * The MOST SPECIFIC match wins. Home's path is the store root, which prefixes
 * every path in the admin, so a first-match search titled every placeholder
 * "Home" — and told a merchant looking at Growth that Home was not installed.
 */
function findEntry(handle: string, pathname: string): NavItem | undefined {
  const candidates: NavItem[] = [];

  for (const section of coreNavigation(handle)) {
    for (const item of section.items) {
      candidates.push(item);
      for (const child of item.children ?? []) candidates.push(child as NavItem);
    }
  }

  return candidates
    .filter((item) => matches(item.path, pathname))
    .sort((a, b) => baseOf(b.path).length - baseOf(a.path).length)[0];
}

const baseOf = (candidate: string): string => candidate.split('?')[0]!;

function matches(candidate: string, pathname: string): boolean {
  const base = baseOf(candidate);
  return base === pathname || pathname.startsWith(`${base}/`);
}

export default function UnbuiltSection({
  params,
}: {
  params: Promise<{ handle: string; section: string[] }>;
}) {
  const { handle, section } = use(params);
  const pathname = `/store/${handle}/${section.join('/')}`;
  const entry = findEntry(handle, pathname);

  // A path that is not in the navigation at all is a genuine 404. Only declared
  // sections get the softer explanation — otherwise every typo would be
  // reassured that nothing is wrong.
  if (!entry) notFound();

  return <UnavailableSection title={entry.label} />;
}
