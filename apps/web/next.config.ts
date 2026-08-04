/**
 * next.config.ts
 * Admin app configuration. Workspace packages are transpiled rather than
 * pre-built so a change to the design system or contracts is picked up without
 * a separate build step.
 * Layer: config.
 */

import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@deservefirst/ui', '@deservefirst/contracts', '@deservefirst/config'],
  // The design system is reached only through @deservefirst/ui (§8.1), so that
  // is the package worth optimising imports for.
  experimental: { optimizePackageImports: ['@deservefirst/ui'] },
};

export default config;
