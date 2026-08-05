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
      // A directive prologue ('use client', 'use server') must be the first
      // statement in the file, so the header comment follows it rather than
      // preceding it. Skip past any directives before looking for the header.
      const body = source.text.replace(/^\s*(['"])use (client|server)\1;?\s*/g, '');
      if (!/^\s*\/\*\*/.test(body)) {
        violations.push(
          violation(source.relativePath, 1, 'file-headers', 'file does not open with a /** header comment'),
        );
        continue;
      }
      // Read the whole leading block, not a fixed prefix — headers legitimately
      // vary in length, and truncating produced false failures.
      const end = body.indexOf('*/');
      const head = end === -1 ? body : body.slice(0, end);
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
    /**
     * No word boundaries, deliberately.
     *
     * `\bshopify\b` does not match `shopify_asset_url` — an underscore is a word
     * character, so there is no boundary after "shopify". That is precisely the
     * form the name takes when it matters most: an identifier, a filter name, a
     * config key. The rule passed a whole release with one in the tree.
     */
    const names = [/shopify/i, /magento/i, /wordpress/i, /woocommerce/i];

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


/**
 * A platform permission is never grantable to a tenant role.
 *
 * `platform.modules.manage` and `platform.settings.manage` were declared with
 * `categories: ['organization']`, which made them grantable to a merchant's own
 * owner role — and the seed granted every declared permission, so the seeded
 * store owner could disable a module for every store on the platform.
 *
 * The category is what decides whether a permission can be handed to a tenant
 * at all, so the check belongs on the declaration rather than on any of the
 * three places that later read it. One of those three was already a backstop
 * and still let it through.
 */
export const platformPermissionsAreOperatorOnly = {
  name: 'platform-permissions-are-operator-only',
  description: 'A platform.* permission is grantable only to the platform category',
  run(sources) {
    const violations = [];

    for (const source of sources) {
      if (!/\.manifest\.ts$/.test(source.relativePath)) continue;

      // Each declaration is `{ key: 'x', ... categories: [...] }`. Matched as a
      // block so a key and the categories beside it stay associated.
      const pattern = /key:\s*'(platform\.[^']+)'([\s\S]{0,400}?)categories:\s*\[([^\]]*)\]/g;
      let match;

      while ((match = pattern.exec(source.text)) !== null) {
        const [, key, , categories] = match;
        const listed = categories
          .split(',')
          .map((entry) => entry.trim().replace(/^'|'$/g, ''))
          .filter(Boolean);

        const tenant = listed.filter((category) => category !== 'platform');
        if (tenant.length === 0) continue;

        violations.push(
          violation(
            source.relativePath,
            source.text.slice(0, match.index).split('\n').length,
            'platform-permissions-are-operator-only',
            `"${key}" governs every store but is grantable to the ${tenant.join(', ')} ` +
              'category, so a tenant role can hold it. Use categories: [\'platform\'].',
          ),
        );
      }
    }

    return violations;
  },
};

/**
 * liquidjs is imported in exactly one file.
 *
 * The storefront engine wraps liquidjs behind our own interface so the choice
 * stays reversible — PLAN/07 records why that matters: liquidjs is a
 * third-party port of Liquid rather than the reference implementation, and if
 * fidelity ever outweighs latency we run the real gem out-of-process instead.
 * That swap is a one-file change only for as long as this holds.
 *
 * It is the kind of boundary that erodes quietly. Somebody needs a `Drop`
 * subclass, imports the type directly because it is right there, and the
 * abstraction is load-bearing in name only. So it is a rule rather than a
 * convention in a README.
 */
export const noDirectLiquid = {
  name: 'no-direct-liquid',
  description: 'Only the storefront engine boundary may import liquidjs',
  run(sources) {
    const violations = [];
    const allowed = 'apps/api/src/storefront/engine/liquid.ts';

    for (const source of sources) {
      if (source.relativePath === allowed) continue;

      const match = /(?:from\s+['"]liquidjs['"]|require\(\s*['"]liquidjs['"]\s*\))/.exec(
        source.text,
      );
      if (!match) continue;

      violations.push(
        violation(
          source.relativePath,
          lineOf(source.text, match.index),
          'no-direct-liquid',
          `imports liquidjs directly. Only ${allowed} may — import from ` +
            "'./engine' (or '../engine') instead, and add what you need to its interface.",
        ),
      );
    }

    return violations;
  },
};

/**
 * A drop never exposes a field the platform marked non-public.
 *
 * Drops are the storefront's security boundary: a theme is untrusted
 * third-party code that sees precisely what a drop exposes. Our own resources
 * already say which fields are not for publication — `costPerItem` is a
 * merchant's margin, `internalNotes` is what staff wrote about a product,
 * `passwordHash` and `webhookSecret` are credentials — and this rule holds the
 * drops to that declaration rather than to a list kept beside them.
 *
 * Cross-checked against the manifests, so marking a NEW field private
 * automatically protects it. A list maintained here would drift the first time
 * somebody added a private field without thinking about themes, which is
 * exactly the person this rule is for.
 */
export const dropsExposeNothingPrivate = {
  name: 'drops-expose-nothing-private',
  description: 'No drop exposes a field marked private or internal',
  run(sources) {
    const violations = [];

    // Every field any resource marked non-public, by name.
    const forbidden = new Map();
    for (const source of sources) {
      const pattern = /\{\s*name:\s*'(\w+)'[^}]*visibility:\s*'(private|internal)'[^}]*\}/g;
      let match;
      while ((match = pattern.exec(source.text)) !== null) {
        forbidden.set(match[1], `${match[2]} in ${source.relativePath}`);
      }
    }
    if (forbidden.size === 0) return violations;

    /**
     * A drop property is only a leak if it READS the forbidden field.
     *
     * Matching the property name would be wrong in both directions: a drop may
     * legitimately call something `note` while reading a different column, and
     * a drop exposing `costPerItem` under the name `price` is the actual
     * disaster. So the source expression is what gets checked.
     */
    for (const source of sources) {
      if (!/[/\\]storefront[/\\]domain[/\\]drops[/\\]/.test(source.relativePath)) continue;

      /**
       * Comments are blanked before matching, keeping the offsets.
       *
       * A drop file explains which fields it deliberately does NOT expose, and
       * naming one in prose is the correct thing to write. The first version of
       * this rule read the sentence "…about this person. `note` is what staff
       * wrote" as a property read, because a full stop before a word looks
       * exactly like a member access. Blanking rather than removing keeps every
       * reported line number honest.
       */
      const code = source.text
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (line) => line.replace(/./g, ' '));

      for (const [field, where] of forbidden) {
        // `(row) => row.costPerItem` — a property read, with no space before
        // the name. `foo. bar` is not valid member access anybody writes.
        const read = new RegExp(`\\.${field}\\b`);
        if (!read.test(code)) continue;

        violations.push(
          violation(
            source.relativePath,
            lineOf(code, read.exec(code).index),
            'drops-expose-nothing-private',
            `reads "${field}", which is ${where}. A drop is read by every theme on ` +
              'the platform — if a storefront genuinely needs this, change the ' +
              'field\'s visibility deliberately rather than reaching around it.',
          ),
        );
      }
    }

    return violations;
  },
};

/**
 * An error carries `status`, never `statusCode`.
 *
 * The transport's error handler reads `.status` to decide the response code.
 * An error thrown with `statusCode` instead is not a slightly-wrong error — it
 * falls through to the generic branch and is served as a **500 with its message
 * replaced** by "An unexpected error occurred". The careful 409, 404 or 422
 * simply never reaches the client.
 *
 * Nothing catches this. It type-checks, the unit tests pass because they call
 * the service rather than the route, and the only way to see it is to make the
 * request and read the status. It shipped four times before anyone did: the
 * theme editor's conflict handling, a message triage 404, and both of the
 * domain controller's validation refusals.
 *
 * `reply.statusCode` is Fastify's own and is left alone; so is a declared field
 * that happens to share the name, like a redirect record's.
 */
export const errorsCarryStatus = {
  name: 'errors-carry-status',
  description: 'A thrown error sets `status`, which is what the transport reads',
  run(sources) {
    const violations = [];

    for (const source of sources) {
      /**
       * Anchored on `new Error(`, not on the property name.
       *
       * The first version matched every `statusCode:` in the codebase and
       * reported a redirect record that legitimately HAS one — `seo.ts` builds
       * `{ statusCode: 301 }` as data, and there is nothing wrong with it. A
       * rule that flags correct code is one people learn to skip, so this looks
       * for the shape that actually fails: a status attached to an Error.
       */
      for (const match of source.text.matchAll(/new Error\(/g)) {
        // The object being assigned onto it follows within a short window;
        // anything further away belongs to different code.
        const window = source.text.slice(match.index, match.index + 240);
        const found = /\bstatusCode:/.exec(window);
        if (!found) continue;

        violations.push(
          violation(
            source.relativePath,
            lineOf(source.text, match.index + found.index),
            'errors-carry-status',
            'sets `statusCode` on an error. The transport reads `.status` — with ' +
              'only `statusCode` this is served as a 500 and the message is ' +
              'replaced. Rename it to `status`.',
          ),
        );
      }
    }

    return violations;
  },
};

export const allRules = [
  errorsCarryStatus,
  platformPermissionsAreOperatorOnly,
  dropsExposeNothingPrivate,
  noDirectLiquid,
  fileHeaders,
  moduleBoundaries,
  layerLaw,
  competitorNames,
  brandingSingleSource,
  coreServicesOnly,
  tenantScope,
  urlSafety,
];
