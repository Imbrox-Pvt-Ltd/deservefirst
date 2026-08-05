/**
 * Storefront · domain/template-lint.ts
 * Liquid mistakes that produce a wrong page instead of an error.
 *
 * Every rule here shares one property: the template parses, renders, and is
 * wrong. `{% assign a = [1, 2, 3] %}` yields nothing at all, so the `for` under
 * it runs zero times and a section silently disappears. Nobody gets a stack
 * trace; they get a support ticket saying "the related products are missing".
 *
 * The engine cannot fix these — `[1, 2, 3]` is valid Liquid syntax that means
 * something unhelpful, and rewriting a theme's code at render time would be
 * worse than the bug. So they are reported at upload, beside the schema checks,
 * which is the same reasoning as `section-schema.ts`: an error found when a
 * theme is installed is a message to the person who can fix it, and the same
 * error found at render is a broken storefront.
 *
 * Findings are advisory by default. A theme that trips one still installs,
 * because some are heuristics and refusing a merchant's theme over a heuristic
 * is worse than the mistake. `severity: 'error'` is reserved for the cases that
 * are certainly wrong.
 * Layer: domain (pure).
 */

export interface TemplateFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** What to write instead. Every finding has one; a lint without a fix is a complaint. */
  readonly suggestion: string;
}

/**
 * Liquid delimiters, with their offset so a finding can name a line.
 *
 * The whitespace-control hyphens are stripped here. `{%- liquid` leaves a
 * leading `-` on the body, which is enough for a rule anchored with `^` to
 * match nothing — every rule silently stopped firing inside exactly the blocks
 * real themes write most.
 */
function* liquidTags(source: string): Generator<{ body: string; index: number }> {
  for (const match of source.matchAll(/\{[{%]([\s\S]*?)[%}]\}/g)) {
    const body = (match[1] as string).replace(/^-/, '').replace(/-$/, '');
    yield { body, index: match.index as number };
  }
}

const lineAt = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

/**
 * Strips quoted strings before a rule looks for punctuation.
 *
 * Without this, `{% assign label = 'Sizes [S, M, L]' %}` is reported as an array
 * literal — the exact false positive that makes people turn a linter off.
 */
function withoutStrings(body: string): string {
  return body.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

type Rule = (body: string, bare: string) => Omit<TemplateFinding, 'file' | 'line'> | null;

const RULES: readonly Rule[] = [
  /**
   * `{% assign a = [1, 2, 3] %}` — the one that started this.
   *
   * Liquid has no array literal. The assignment succeeds and produces nothing,
   * which is the worst of both worlds: no error, no value.
   */
  (_body, bare) => {
    if (!/^\s*assign\s+[\w.]+\s*=\s*\[/.test(bare)) return null;
    return {
      rule: 'no-array-literal',
      severity: 'error',
      message:
        'Liquid has no array literal, so this assigns nothing at all — the variable ' +
        'ends up empty and any loop over it runs zero times, with no error.',
      suggestion:
        "Build it instead: {% assign list = nil | array %} for an empty one, or " +
        "{% assign list = 'a' | array: 'b', 'c' %} to start with values.",
    };
  },

  /**
   * `{% assign h = {} %}` and object literals.
   *
   * This one does throw, but with "invalid value expression" and no hint that
   * Liquid has no hash literal either.
   */
  (_body, bare) => {
    if (!/^\s*assign\s+[\w.]+\s*=\s*\{/.test(bare)) return null;
    return {
      rule: 'no-hash-literal',
      severity: 'error',
      message: 'Liquid has no hash or object literal, so this fails to parse.',
      suggestion:
        'Keep parallel arrays and index them together, or expose the structure ' +
        'from a drop where it can be built properly.',
    };
  },

  /**
   * `{% increment %}` used where a counter was meant.
   *
   * It prints its value as a side effect and keeps a namespace separate from
   * `assign`, so `{% increment n %}` inside a loop writes "012" onto the page
   * and leaves `{{ n }}` reading a different variable. Measured.
   */
  (_body, bare) => {
    if (!/^\s*increment\s+\w+\s*$/.test(bare)) return null;
    return {
      rule: 'increment-prints',
      severity: 'warning',
      message:
        'increment writes its value onto the page and keeps its own namespace, ' +
        'separate from assign — so {{ name }} will not read what this set.',
      suggestion:
        'For a silent counter use {% assign n = n | plus: 1 %}, which shares the ' +
        'namespace everything else reads.',
    };
  },

];

/**
 * Inline script a Content-Security-Policy would block.
 *
 * Not a Liquid mistake — it is valid and works today — but it stops working the
 * moment the policy is enforced, and the failure is a silent one: the page
 * renders and the behaviour is gone.
 *
 * Reported by `theme:check` rather than left for a merchant to discover, with
 * the fix in the message. The reference theme has thirteen of these.
 */
const CSP_RULES: readonly ((source: string) => readonly Omit<TemplateFinding, 'file'>[])[] = [
  (source) => {
    const findings: Omit<TemplateFinding, 'file'>[] = [];

    for (const match of source.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) {
      const attributes = match[1] ?? '';
      // Already nonced, or a type the browser never executes.
      if (/\bnonce\b/.test(attributes)) continue;

      findings.push({
        line: source.slice(0, match.index).split('\n').length,
        rule: 'inline-script-needs-nonce',
        severity: 'warning',
        message:
          'This inline script has no nonce, so it will stop running when a ' +
          'Content-Security-Policy is enforced — silently, with the page still rendering.',
        suggestion:
          'Use {% javascript %}, which is nonced for you, or add ' +
          'nonce="{{ content_security_policy_nonce }}" to the tag.',
      });
    }

    return findings;
  },
];

/**
 * Rules that cannot be decided from one tag in isolation.
 *
 * Kept separate because they need state the per-tag rules do not have, and
 * mixing the two produced a linter that fired 158 times on a professionally
 * built theme with nothing actually wrong. A rule that cries wolf is worse than
 * no rule: it teaches people to skim past the output, including the real ones.
 */
type ContextualRule = (
  tags: readonly { body: string; bare: string; index: number; forDepth: number }[],
  source: string,
) => readonly Omit<TemplateFinding, 'file'>[];

const CONTEXTUAL_RULES: readonly ContextualRule[] = [
  /**
   * Reading `forloop` outside any for block.
   *
   * `{% for i in ... %}{% endfor %}{{ forloop.index }}` renders nothing — the
   * binding does not outlive the loop, while assignments made inside it do,
   * which is the inconsistency that catches people out.
   *
   * Needs the nesting depth, which is the whole reason this rule lives here.
   * The first version checked only whether a tag mentioned `forloop` and
   * reported 64 findings on the reference theme, every one of them a correct
   * use inside a loop.
   */
  (tags, source) =>
    tags
      .filter((tag) => tag.forDepth === 0 && /\bforloop\s*\./.test(tag.bare))
      .map((tag) => ({
        line: lineAt(source, tag.index),
        rule: 'forloop-outside-loop',
        severity: 'warning' as const,
        message: 'forloop only exists inside a for block; here it reads as nothing.',
        suggestion: 'Capture what you need into a variable inside the loop before it ends.',
      })),

  /**
   * Building a string with `append` and later splitting it, with no separator.
   *
   * The split-accumulator idiom's classic failure: `{% assign s = s | append:
   * item %}` then `s | split: ','` runs every value into the next, and the
   * result reads as data loss rather than a missing comma.
   *
   * Only reported when the same variable is actually split somewhere in the
   * file. Without that condition it fired 94 times on the reference theme,
   * where appending to build a class list or a URL — never split — is ordinary
   * and correct.
   */
  (tags, source) => {
    const findings: Omit<TemplateFinding, 'file'>[] = [];

    for (const tag of tags) {
      const match = /^\s*assign\s+(\w+)\s*=\s*\1\s*\|\s*append:/.exec(tag.bare);
      if (!match) continue;

      const variable = match[1] as string;
      // Only a problem if something later splits this same variable.
      const split = new RegExp(`\\b${variable}\\s*\\|\\s*split:`);
      if (!split.test(source)) continue;

      // And only if no separator is appended — a short literal at the end of
      // the chain is the separator, which is the correct form of this idiom.
      if (/\|\s*append:\s*['"][^'"]{0,3}['"]\s*$/.test(tag.body.trim())) continue;

      findings.push({
        line: lineAt(source, tag.index),
        rule: 'append-without-separator',
        severity: 'warning',
        message:
          `"${variable}" is built by appending and is split later in this file, but ` +
          'nothing separates the values — they will run into each other.',
        suggestion:
          'Accumulate an array instead: {% assign list = list | push: item %} — ' +
          'push does not modify the original, so it is safe inside a loop.',
      });
    }

    return findings;
  },
];

/**
 * Lints one template.
 *
 * Deliberately per-file and pure, so the caller decides what to do with the
 * findings — the upload path reports them, and a test can assert on them.
 */
export function lintTemplate(file: string, source: string): readonly TemplateFinding[] {
  const findings: TemplateFinding[] = [];

  /**
   * Flattened statements, each carrying how many `for` blocks enclose it.
   *
   * Built once and shared, so the contextual rules do not each re-parse the
   * file. The depth is what distinguishes a correct `forloop.index` from one
   * that reads as nothing.
   */
  const statements: { body: string; bare: string; index: number; forDepth: number }[] = [];
  let forDepth = 0;

  for (const { body, index } of liquidTags(source)) {
    const bare = withoutStrings(body).trim();

    // A `{% liquid %}` block holds many statements, one per line; each is
    // linted separately or a rule anchored to the start would only ever see
    // the first.
    const lines = /^liquid\b/.test(bare)
      ? body.replace(/^\s*liquid\b/, '').split('\n')
      : [body];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      const bareLine = withoutStrings(trimmed).trim();

      /**
       * `endfor` decrements before the statement is recorded and `for`
       * increments after, so the opening and closing tags themselves sit at the
       * depth of their surroundings rather than inside their own block.
       */
      if (/^endfor\b/.test(bareLine)) forDepth = Math.max(0, forDepth - 1);

      statements.push({ body: trimmed, bare: bareLine, index, forDepth });

      if (/^for\b/.test(bareLine)) forDepth += 1;

      for (const rule of RULES) {
        const found = rule(trimmed, bareLine);
        if (!found) continue;
        findings.push({ file, line: lineAt(source, index), ...found });
      }
    }
  }

  for (const rule of CONTEXTUAL_RULES) {
    for (const found of rule(statements, source)) {
      findings.push({ file, ...found });
    }
  }

  // Markup rules, which look at the file rather than at its Liquid.
  for (const rule of CSP_RULES) {
    for (const found of rule(source)) findings.push({ file, ...found });
  }

  return findings;
}

/** Whether anything found would actually break the page. */
export function hasBlockingFinding(findings: readonly TemplateFinding[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}

/** A findings list as something a person can act on. */
export function formatFindings(findings: readonly TemplateFinding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.file}:${finding.line}  [${finding.severity}] ${finding.rule}\n` +
        `  ${finding.message}\n` +
        `  → ${finding.suggestion}`,
    )
    .join('\n\n');
}
