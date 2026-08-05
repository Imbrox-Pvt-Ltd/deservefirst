/**
 * Storefront · engine/dates.ts
 * Parsing a theme's dates, and the strftime subset it formats them with.
 *
 * Liquid formats dates with strftime directives rather than a pattern language,
 * because Liquid came from Ruby. `%B %d, %Y` is what themes write, and a theme
 * author reaching for `MMMM` gets a literal "MMMM" on the page — so the
 * directives are what we implement.
 *
 * Only the directives themes actually use. The full strftime surface includes
 * things like `%G` (ISO week-numbering year) that no storefront needs, and every
 * one implemented is one more thing to keep correct.
 * Layer: engine (pure).
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A theme's value as a Date, or `null`.
 *
 * `'now'` and `'today'` are Liquid's own spellings and themes use them for
 * copyright years. Numbers are treated as Unix seconds, which is how a JSON API
 * hands over a timestamp — milliseconds would put every date in 1970.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number') {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (text === 'now' || text === 'today') return new Date();

  // A bare integer in a string is still a Unix timestamp.
  if (/^\d+$/.test(text)) return toDate(Number(text));

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** Formats a date with the strftime directives themes use. */
export function strftime(date: Date, format: string): string {
  const hours = date.getUTCHours();

  const directives: Readonly<Record<string, () => string>> = {
    Y: () => String(date.getUTCFullYear()),
    y: () => pad(date.getUTCFullYear() % 100),
    m: () => pad(date.getUTCMonth() + 1),
    // `%-d` and `%-m` drop the padding; handled below by the `-` flag.
    d: () => pad(date.getUTCDate()),
    e: () => String(date.getUTCDate()).padStart(2, ' '),
    j: () => pad(dayOfYear(date), 3),
    H: () => pad(hours),
    I: () => pad(hours % 12 === 0 ? 12 : hours % 12),
    M: () => pad(date.getUTCMinutes()),
    S: () => pad(date.getUTCSeconds()),
    p: () => (hours < 12 ? 'AM' : 'PM'),
    P: () => (hours < 12 ? 'am' : 'pm'),
    B: () => MONTHS[date.getUTCMonth()] as string,
    b: () => (MONTHS[date.getUTCMonth()] as string).slice(0, 3),
    h: () => (MONTHS[date.getUTCMonth()] as string).slice(0, 3),
    A: () => DAYS[date.getUTCDay()] as string,
    a: () => (DAYS[date.getUTCDay()] as string).slice(0, 3),
    s: () => String(Math.floor(date.getTime() / 1000)),
    Z: () => 'UTC',
    z: () => '+0000',
    F: () => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    T: () => `${pad(hours)}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    '%': () => '%',
  };

  // `%-d` strips leading zeros — themes use it constantly for "March 3" rather
  // than "March 03".
  return format.replace(/%(-?)([A-Za-z%])/g, (whole, dash: string, letter: string) => {
    const render = directives[letter];
    if (!render) return whole;
    const out = render();
    return dash === '-' ? out.replace(/^0+(?=\d)/, '') : out;
  });
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}
