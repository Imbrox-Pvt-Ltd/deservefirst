/**
 * Fitness · rules.mjs
 * The fitness functions (§14.2). CI fails the build on any violation — this is
 * what turns the Module Standard from a convention into a law. A rule a test
 * enforces beats a rule in a doc nobody reads.
 * Layer: tooling.
 */

import { posix } from 'node:path';

import { classify, extractImports, lineOf, violation } from './context.mjs';

/**
 * Resolves an import specifier to a repo-relative path when it is relative, so
 * `../../shipping/application/x` is recognised as reaching into another module.
 * Bare package specifiers are returned unchanged.
 */
function resolveSpecifier(fromRelativePath, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  return posix.normalize(posix.join(posix.dirname(fromRelativePath), specifier));
}

/**
 * §33.2 — every source file opens with a header comment stating what it does,
 * its layer and its module. Greppable, and invaluable for agents navigating.
 */
export const fileHeaders = {
  name: 'file-headers',
  description: 'Every source file has a header comment (§33.2)',
  run(sources) {
    const violations = [];
    for (const source of sources) {
      if (source.exemptFromHeader) continue;
      if (!/^\s*\/\*\*/.test(source.text)) {
        violations.push(
          violation(source.relativePath, 1, 'file-headers', 'file does not open with a /** header comment'),
        );
        continue;
      }
      // Read the whole leading block, not a fixed prefix — headers legitimately
      // vary in length, and truncating produced false failures.
      const end = source.text.indexOf('*/');
      const head = end === -1 ? source.text : source.text.slice(0, end);
      if (!/Layer:/i.test(head)) {
        violations.push(
          violation(source.relativePath, 1, 'file-headers', 'header comment does not state its Layer'),
        );
      }
    }
    return violations;
  },
};

/**
 * §14.1 — a module imports NOTHING from another module except its published
 * contracts/. This is the rule that lets an agent work on one module without
 * breaking others.
 */
export const moduleBoundaries = {
  name: 'module-boundaries',
  description: 'No module imports another module\'s internals — only its contracts/ (§14.1)',
  run(sources) {
    const violations = [];
    for (const source of sources) {
      const info = classify(source.relativePath);
      if (!info || info.kind !== 'module') continue;

      for (const specifier of extractImports(source.text)) {
        const resolved = resolveSpecifier(source.relativePath, specifier);
        const crossModule = /(?:^|\/)modules\/([^/]+)\/(.+)$/.exec(resolved);
        if (!crossModule) continue;
        const [, targetModule, targetPath] = crossModule;
        if (targetModule === info.module) continue;
        if (targetPath.startsWith('contracts')) continue;

        violations.push(
          violation(
            source.relativePath,
            lineOf(source.text, source.text.indexOf(specifier)),
            'module-boundaries',
            `imports "${specifier}" — module "${targetModule}" may only be reached through its contracts/`,
          ),
        );
      }
    }
    return violations;
  },
};

/**
 * §14.1 — layer dependency law. api → application → domain; infrastructure
 * implements interfaces declared in domain/application; domain imports no
 * framework code and stays pure.
 */
export const layerLaw = {
  name: 'layer-law',
  description: 'api → application → domain; domain stays framework-free (§14.1)',
  run(sources) {
    const violations = [];
    const forbidden = {
      // layer → layers it may not import
      domain: ['application', 'infrastructure', 'api'],
      application: ['api'],
      api: ['infrastructure'],
    };
    const frameworkPackages = [
      '@nestjs/', 'typeorm', 'fastify', 'express', 'next/', 'react',
      'pg', 'ioredis', 'bullmq',
    ];

    for (const source of sources) {
      const info = classify(source.relativePath);
      if (!info || info.kind !== 'module') continue;
      const banned = forbidden[info.layer];

      for (const specifier of extractImports(source.text)) {
        const line = lineOf(source.text, source.text.indexOf(specifier));
        const resolved = resolveSpecifier(source.relativePath, specifier);

        if (banned) {
          const target = classify(resolved);
          if (target && banned.includes(target.layer)) {
            violations.push(
              violation(
                source.relativePath,
                line,
                'layer-law',
                `layer "${info.layer}" may not import from "${target.layer}" (${specifier})`,
              ),
            );
          }
        }

        if (info.layer === 'domain') {
          for (const pkg of frameworkPackages) {
            if (specifier === pkg || specifier.startsWith(pkg)) {
              violations.push(
                violation(
                  source.relativePath,
                  line,
                  'layer-law',
                  `domain/ must stay pure — it imports framework package "${specifier}"`,
                ),
              );
            }
          }
        }
      }
    }
    return violations;
  },
};

/**
 * §33.3 — shipped code, comments, UI and public docs must never name a
 * competitor platform. Internal design docs under PLAN/ and REQUIREMENT/ are
 * excluded from the walk entirely, so only shipped source is checked.
 */
export const competitorNames = {
  name: 'competitor-names',
  description: 'No third-party platform names in shipped code (§33.3)',
  run(sources) {
    const violations = [];
    const names = [/\bshopify\b/i, /\bmagento\b/i, /\bwordpress\b/i, /\bwoocommerce\b/i];

    for (const source of sources) {
      // The aliases table is where these names are *defined*; exempt it.
      if (source.relativePath === 'packages/config/src/branding.ts') continue;

      // A dependency's package name is not branding — we cannot rename an npm
      // package, and the design system is a decided dependency. What §33.3
      // actually protects is what a user or reader sees, so import specifiers
      // are excluded from the scan and policed by the rule below instead.
      const withoutSpecifiers = source.text.replace(
        /(?:from\s+|require\(\s*)['"][^'"]+['"]/g,
        'from "_"',
      );

      for (const pattern of names) {
        const match = pattern.exec(withoutSpecifiers);
        if (match) {
          violations.push(
            violation(
              source.relativePath,
              lineOf(withoutSpecifiers, match.index),
              'competitor-names',
              `contains "${match[0]}" — use the alias from packages/config/src/branding.ts`,
            ),
          );
        }
      }

      // The containment rule: only the design-system wrapper may depend on the
      // vendor package. If any module imported it directly, swapping or
      // re-theming the library would stop being a one-package change.
      if (!source.relativePath.startsWith('packages/ui/')) {
        for (const specifier of extractImports(source.text)) {
          if (/^@shopify\//.test(specifier)) {
            violations.push(
              violation(
                source.relativePath,
                lineOf(source.text, source.text.indexOf(specifier)),
                'competitor-names',
                `imports "${specifier}" directly — consume it through @deservefirst/ui instead`,
              ),
            );
          }
        }
      }
    }

    return violations;
  },
};

/**
 * §33.1 — the platform name and every brand value resolve from one config.
 * A hardcoded brand string means renaming the platform stops being a one-file
 * change.
 */
export const brandingSingleSource = {
  name: 'branding-single-source',
  description: 'No hardcoded brand string outside the branding config (§33.1)',
  run(sources) {
    const violations = [];
    const pattern = /['"`]DeserveFirst['"`]/;
    for (const source of sources) {
      if (source.relativePath.startsWith('packages/config/')) continue;
      const match = pattern.exec(source.text);
      if (match) {
        violations.push(
          violation(
            source.relativePath,
            lineOf(source.text, match.index),
            'branding-single-source',
            'hardcoded platform name — read it from @deservefirst/config branding',
          ),
        );
      }
    }
    return violations;
  },
};

/**
 * §5.5, §14.2 — no module implements its own caching, rate limiting, money maths,
 * date formatting or slugification. Core owns them; re-implementing breaks DRY
 * in a way that is checkable rather than aspirational (§32).
 */
export const coreServicesOnly = {
  name: 'core-services-only',
  description: 'Modules must not re-implement Core primitives (§32)',
  run(sources) {
    const violations = [];
    const banned = [
      { pattern: /function\s+slugify\b/, hint: 'use the Core slug service' },
      { pattern: /new\s+Intl\.NumberFormat\s*\([^)]*currency/, hint: 'use the Core Money formatter' },
      { pattern: /\btoFixed\s*\(\s*2\s*\)/, hint: 'money is integer minor units — use the Money value object' },
      { pattern: /createClient\s*\(\s*['"]redis/, hint: 'use the Core cache service' },
    ];
    for (const source of sources) {
      const info = classify(source.relativePath);
      if (!info || info.kind !== 'module') continue;
      for (const rule of banned) {
        const match = rule.pattern.exec(source.text);
        if (match) {
          violations.push(
            violation(
              source.relativePath,
              lineOf(source.text, match.index),
              'core-services-only',
              `re-implements a Core primitive — ${rule.hint}`,
            ),
          );
        }
      }
    }
    return violations;
  },
};

/**
 * §14.2, §20.1 — no query runs without tenant scope. This is the single most
 * important isolation rule; the heuristic here catches raw repository queries
 * that never mention the store boundary.
 */
export const tenantScope = {
  name: 'tenant-scope',
  description: 'Every repository query is tenant-scoped (§14.2, §20.1)',
  run(sources) {
    const violations = [];
    const queryPattern = /\.(find|findOne|findMany|createQueryBuilder|query|update|delete)\s*\(/;
    for (const source of sources) {
      const info = classify(source.relativePath);
      if (!info || info.kind !== 'module' || info.layer !== 'infrastructure') continue;
      if (!queryPattern.test(source.text)) continue;

      const mentionsScope = /storeId|store_id|tenantId|tenant_id|withStoreScope/.test(source.text);
      if (!mentionsScope) {
        violations.push(
          violation(
            source.relativePath,
            1,
            'tenant-scope',
            'repository issues queries but never references the store boundary',
          ),
        );
      }
    }
    return violations;
  },
};

/**
 * §24.4 — shareable is not the same as leaky. Tokens, passwords, PII and secrets
 * must never appear in a URL schema; URLs are logged, cached and shared.
 */
export const urlSafety = {
  name: 'url-safety',
  description: 'No sensitive parameter names in URL schemas (§24.4)',
  run(sources) {
    const violations = [];
    const sensitive = /['"](?:access_token|refresh_token|password|secret|api_key|apikey|ssn|cvv)['"]\s*[,:]/i;
    for (const source of sources) {
      if (!/URLSearchParams|searchParams|\?\w+=/.test(source.text)) continue;
      if (source.relativePath === 'packages/contracts/src/list-query.ts') continue;
      const match = sensitive.exec(source.text);
      if (match) {
        violations.push(
          violation(
            source.relativePath,
            lineOf(source.text, match.index),
            'url-safety',
            `sensitive parameter "${match[0]}" in a URL schema`,
          ),
        );
      }
    }
    return violations;
  },
};

export const allRules = [
  fileHeaders,
  moduleBoundaries,
  layerLaw,
  competitorNames,
  brandingSingleSource,
  coreServicesOnly,
  tenantScope,
  urlSafety,
];
