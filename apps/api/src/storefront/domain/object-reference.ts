/**
 * Storefront · domain/object-reference.ts
 * The storefront vocabulary, written out for people.
 *
 * A theme developer's first question is "what can I address, and what will it
 * actually give me?" — and until this existed, the only honest answer was "read
 * thirty TypeScript files". Worse, reading them would not have answered the
 * second half: in Liquid an empty value and a missing one render identically,
 * so a property returning `null` because the feature is not built looks exactly
 * like one returning `null` because there is genuinely nothing there.
 *
 * Generated from the drops rather than written beside them. A hand-kept list is
 * wrong the first time somebody adds a property and forgets the document, and a
 * reference nobody trusts is worse than no reference — people stop reading it
 * and go back to the source, which is the situation it was meant to fix.
 *
 * Pure and here in domain, so the CLI can write the file and a fitness rule can
 * check the committed copy still matches without either duplicating the format.
 * Layer: domain (pure).
 */

/** What one drop declares. Structural, so the registry satisfies it as-is. */
export interface DescribedDrop {
  readonly dropName: string;
  readonly properties: readonly string[];
  readonly pending: Readonly<Record<string, string>>;
}

export interface ObjectReferenceCounts {
  readonly objects: number;
  readonly implemented: number;
  readonly pending: number;
}

const PREAMBLE = [
  '# Storefront objects',
  '',
  'Every object a theme can address, generated from the drops that define them.',
  'Run `platform storefront:objects --write` after changing a drop; CI checks that',
  'the committed copy still matches.',
  '',
  'A property listed as **pending** is declared and answers with an honest empty',
  'value — an empty list, a null, a false — but is not yet backed by real data. In',
  'Liquid an empty answer and a missing one render identically, so this table is',
  'the only place that difference is visible.',
  '',
];

/**
 * The reference as Markdown.
 *
 * `aliases` maps another platform's property name to ours, keyed
 * `object.property` — recorded here because a theme written elsewhere reaching
 * one of our objects under a foreign name is part of what this vocabulary
 * answers to, and somebody porting a theme needs to see it.
 */
export function renderObjectReference(
  drops: readonly DescribedDrop[],
  aliases: Readonly<Record<string, string>> = {},
): { readonly markdown: string; readonly counts: ObjectReferenceCounts } {
  const ordered = [...drops].sort((a, b) => a.dropName.localeCompare(b.dropName));
  const lines = [...PREAMBLE];

  let implemented = 0;
  let pending = 0;

  for (const drop of ordered) {
    const notYetReal = drop.pending ?? {};
    const pendingNames = Object.keys(notYetReal).sort();
    const real = drop.properties.filter((property) => !(property in notYetReal));

    implemented += real.length;
    pending += pendingNames.length;

    lines.push(`## \`${drop.dropName}\``, '');
    lines.push(`${real.length} implemented, ${pendingNames.length} pending.`, '');

    if (real.length > 0) {
      lines.push(real.map((property) => `\`${property}\``).join(', '), '');
    }

    if (pendingNames.length > 0) {
      lines.push('| Pending | Why |', '| --- | --- |');
      for (const property of pendingNames) {
        // Pipes would break the table; a reason containing one is a reason
        // somebody wrote as prose, not a mistake to reject.
        lines.push(`| \`${property}\` | ${String(notYetReal[property]).replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
    }

    const answered = Object.entries(aliases)
      .filter(([foreign]) => foreign.startsWith(`${drop.dropName}.`))
      .sort(([a], [b]) => a.localeCompare(b));

    if (answered.length > 0) {
      lines.push('Also answers to, for themes written elsewhere:', '');
      for (const [foreign, ours] of answered) lines.push(`- \`${foreign}\` → \`${ours}\``);
      lines.push('');
    }
  }

  return {
    markdown: `${lines.join('\n')}\n`,
    counts: { objects: ordered.length, implemented, pending },
  };
}
