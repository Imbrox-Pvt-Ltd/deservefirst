/**
 * Storefront · tests/theme-package.test.mjs
 * Whether a pile of unpacked files is an installable theme.
 *
 * The shape rules are the ones a real archive trips over — a wrapping folder,
 * an editor's leftovers, a file that has no business in a theme — and each of
 * them decides whether a developer's first upload succeeds or leaves them
 * guessing.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isThemePath,
  readThemePackage,
  stripCommonRoot,
  themeNameFrom,
} from '../../../dist/storefront/domain/index.js';

const file = (path, contents = 'x') => ({ path, contents });
const minimal = (extra = []) => [file('layout/theme.liquid', '{{ content_for_layout }}'), ...extra];

// ------------------------------------------------------- the wrapping folder

test('a theme zipped inside its own folder is accepted', () => {
  /**
   * Every archiver produces one and every theme download has one. Refusing it
   * would mean telling every developer to re-zip before installing.
   */
  const result = readThemePackage([
    file('broadcast/layout/theme.liquid'),
    file('broadcast/sections/hero.liquid'),
  ]);

  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.strippedRoot, 'broadcast');
  assert.deepEqual(result.files.map((entry) => entry.path).sort(), [
    'layout/theme.liquid',
    'sections/hero.liquid',
  ]);
});

test('a theme already at the root is left alone', () => {
  const result = readThemePackage(minimal([file('sections/hero.liquid')]));
  assert.equal(result.strippedRoot, null);
  assert.equal(result.ok, true);
});

test('only one level is stripped, and only when it is unanimous', () => {
  // Two themes side by side must not be silently reduced to one of them.
  assert.equal(stripCommonRoot(['a/layout/theme.liquid', 'b/layout/theme.liquid']), null);
  // A folder that IS a theme directory is the theme, not a wrapper.
  assert.equal(stripCommonRoot(['layout/theme.liquid', 'layout/alt.liquid']), null);
  assert.equal(stripCommonRoot(['t/layout/theme.liquid', 't/assets/a.css']), 't');
});

// -------------------------------------------------------------- admission

test('a file outside a theme directory is refused, by name', () => {
  const result = readThemePackage(minimal([file('src/app.js')]));

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.path === 'src/app.js'));
});

test('a file type a theme cannot contain is refused', () => {
  /**
   * A theme is rendered, not run. A `.sh` or `.php` in a theme archive has no
   * purpose that is not somebody testing whether we will store it.
   */
  for (const path of ['layout/run.sh', 'assets/x.php', 'snippets/a.exe']) {
    const result = readThemePackage(minimal([file(path)]));
    assert.equal(result.ok, false, path);
  }
});

test('the file types a theme really uses are all allowed', () => {
  const result = readThemePackage(
    minimal([
      file('assets/theme.css'),
      file('assets/theme.min.js'),
      file('assets/logo@2x.png'),
      file('assets/icons.svg'),
      file('assets/font.woff2'),
      file('locales/en.default.json'),
      file('config/settings_schema.json'),
      file('snippets/price.liquid'),
      file('templates/product.json'),
    ]),
  );

  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.files.length, 10);
});

test('a block whose name starts with an underscore is allowed', () => {
  /**
   * Found by installing the reference theme, which ships four of them — the
   * convention for a block only another block renders. Refusing them left the
   * homepage's hero slideshow rendering EMPTY, with no error anywhere.
   */
  assert.equal(isThemePath('blocks/_slide-image.liquid'), true);

  const result = readThemePackage(minimal([file('blocks/_slide-image.liquid')]));
  assert.equal(result.ok, true, JSON.stringify(result.problems));
});

test('a dotfile is still refused', () => {
  // The rule the underscore check was meant to be: `.env` and `.git/config`
  // are not theme files.
  assert.equal(isThemePath('assets/.env'), false);
  assert.equal(isThemePath('config/.npmrc'), false);
});

test('an archiver’s leftovers are dropped without complaint', () => {
  /**
   * `__MACOSX/` and `.DS_Store` are in a large share of real archives, and the
   * person who zipped the theme cannot easily stop them appearing. Reporting
   * them would make a correct theme look broken.
   */
  const result = readThemePackage(
    minimal([
      file('__MACOSX/._theme.liquid'),
      file('assets/.DS_Store'),
      file('.git/config'),
      file('sections/Thumbs.db'),
    ]),
  );

  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.files.length, 1, 'only the layout survives');
});

// ------------------------------------------------------------ completeness

test('a theme with no layout cannot render, and is refused', () => {
  const result = readThemePackage([file('sections/hero.liquid')]);

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.path === 'layout/theme.liquid'));
});

test('an archive with nothing in it says so plainly', () => {
  const result = readThemePackage([file('readme.txt')]);

  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => /no theme files at all/.test(problem.reason)));
});

test('every problem is reported, not just the first', () => {
  // Somebody packaging a theme wants the list. A conversation where each fix
  // reveals the next complaint is how a developer gives up on a platform.
  const result = readThemePackage([file('src/a.js'), file('src/b.js'), file('bin/c.sh')]);
  assert.ok(result.problems.length >= 3, JSON.stringify(result.problems));
});

test('a traversal is refused here too, as the third lock', () => {
  // readZip refuses it, the theme source refuses it on every read, and this is
  // the cheapest place to fail.
  const result = readThemePackage(minimal([file('../../etc/passwd')]));
  assert.equal(result.ok, false);
});

// ------------------------------------------------------------------ naming

test('the theme is named after the folder its author used', () => {
  assert.equal(themeNameFrom('broadcast'), 'Broadcast');
  assert.equal(themeNameFrom('broadcast-4.2.0'), 'Broadcast 4.2.0');
  assert.equal(themeNameFrom('my_cool_theme'), 'My cool theme');
});

test('an archive with no folder gets a name the merchant can change', () => {
  assert.equal(themeNameFrom(null), 'Uploaded theme');
  assert.equal(themeNameFrom(''), 'Uploaded theme');
});

// ------------------------------------------------------------ binary files

import { versionRefFor } from '../../../dist/storefront/domain/index.js';

test('a theme file may hold bytes, not only text', () => {
  /**
   * The bug this pins. Every entry used to be decoded as UTF-8 before it was
   * stored, and invalid byte sequences all map to the same replacement
   * character — an 88-byte PNG came back as 118 bytes of U+FFFD, and the live
   * storefront served it. Found by comparing the stored file against the
   * original, because nothing failed.
   */
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
  const result = readThemePackage(minimal([{ path: 'assets/logo.png', contents: png }]));

  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const stored = result.files.find((entry) => entry.path === 'assets/logo.png');
  assert.ok(Buffer.isBuffer(stored.contents), 'it is still a Buffer');
  assert.deepEqual(stored.contents, png, 'byte for byte');
});

test('two different images do not share a version reference', () => {
  /**
   * They would have. Interpolating a Buffer into a template literal decodes it
   * as UTF-8 first, so any two images made of invalid sequences hashed the
   * same — and a reference that cannot tell them apart is one a rollback lands
   * on the wrong side of.
   */
  const a = [{ path: 'assets/x.png', contents: Buffer.from([0xff, 0xfe, 0x01]) }];
  const b = [{ path: 'assets/x.png', contents: Buffer.from([0xff, 0xfe, 0x02]) }];

  assert.notEqual(versionRefFor(a), versionRefFor(b));
});

test('identical content still yields the same reference', () => {
  // The property the whole version store rests on: installing the same archive
  // twice must not write a second copy of the same bytes.
  const files = () => [
    { path: 'layout/theme.liquid', contents: 'hello' },
    { path: 'assets/x.png', contents: Buffer.from([1, 2, 3]) },
  ];
  assert.equal(versionRefFor(files()), versionRefFor(files()));
});
