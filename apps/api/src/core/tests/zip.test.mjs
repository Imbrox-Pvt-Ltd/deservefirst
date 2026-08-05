/**
 * Core · tests/zip.test.mjs
 * Unpacking an archive somebody uploaded.
 *
 * Almost every test here is a refusal, which is the point of the reader. The
 * archives are built by the system's own `zip`, so what is being tested is our
 * behaviour against real files rather than against a fixture written to match
 * the parser.
 * Layer: tests.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { isSafeArchivePath, readZip, ZipError } from '../../../dist/core/archive/index.js';

/** Builds a real archive with the system zip, so the input is not our own. */
function archiveOf(files, options = []) {
  const dir = mkdtempSync(join(tmpdir(), 'df-zip-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents);
    }
    const out = join(dir, 'out.zip');
    execFileSync('zip', ['-q', '-r', ...options, out, '.', '-x', 'out.zip'], { cwd: dir });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ reading one

test('a real archive round-trips', () => {
  const zip = archiveOf({
    'layout/theme.liquid': '<html>{{ content_for_layout }}</html>',
    'sections/hero.liquid': '{% schema %}{"name":"Hero"}{% endschema %}',
    'assets/app.css': '.a{color:red}'.repeat(500),
  });

  const entries = readZip(zip);
  const byPath = new Map(entries.map((entry) => [entry.path, entry.contents.toString('utf8')]));

  assert.equal(byPath.get('layout/theme.liquid'), '<html>{{ content_for_layout }}</html>');
  assert.ok(byPath.get('assets/app.css').startsWith('.a{color:red}'));
  assert.equal(byPath.get('assets/app.css').length, 13 * 500, 'deflated content survives exactly');
});

test('stored entries are read as well as deflated ones', () => {
  // `-0` stores without compressing. Small files are often stored even when
  // compression is on, so a reader that only inflates fails on real archives.
  const entries = readZip(archiveOf({ 'a.txt': 'hello' }, ['-0']));
  assert.equal(entries.find((e) => e.path === 'a.txt').contents.toString(), 'hello');
});

test('directory entries carry no contents and are skipped', () => {
  const entries = readZip(archiveOf({ 'assets/x.css': 'a', 'sections/y.liquid': 'b' }));
  assert.ok(!entries.some((entry) => entry.path.endsWith('/')));
  assert.equal(entries.length, 2);
});

test('an empty file is kept, not confused with a directory', () => {
  const entries = readZip(archiveOf({ 'assets/empty.css': '' }));
  assert.equal(entries.find((e) => e.path === 'assets/empty.css').contents.length, 0);
});

// ------------------------------------------------------------- refusals

test('a file that is not an archive is refused', () => {
  assert.throws(
    () => readZip(Buffer.from('this is a liquid file, not a zip')),
    (error) => error instanceof ZipError && error.code === 'not-a-zip',
  );
});

test('a truncated archive is refused rather than half-read', () => {
  const zip = archiveOf({ 'a.txt': 'hello' });
  assert.throws(() => readZip(zip.subarray(0, zip.length - 40)), ZipError);
});

test('too many entries is refused before anything is unpacked', () => {
  const files = {};
  for (let i = 0; i < 60; i++) files[`f${i}.txt`] = 'x';

  assert.throws(
    () => readZip(archiveOf(files), { maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxEntries: 50 }),
    (error) => error.code === 'too-many-entries',
  );
});

test('a decompression bomb is refused', () => {
  /**
   * A megabyte of zeroes compresses to about a kilobyte. The limit is applied
   * to the DECLARED size, so this is refused without ever allocating it.
   */
  const zip = archiveOf({ 'bomb.txt': Buffer.alloc(1024 * 1024, 0) });

  assert.throws(
    () => readZip(zip, { maxTotalBytes: 1e9, maxEntryBytes: 1024, maxEntries: 100 }),
    (error) => error.code === 'too-large',
  );
});

test('many small entries cannot exceed the total budget', () => {
  // Each is under the per-entry limit; together they are not.
  const files = {};
  for (let i = 0; i < 20; i++) files[`f${i}.txt`] = 'x'.repeat(1000);

  assert.throws(
    () => readZip(archiveOf(files), { maxTotalBytes: 5000, maxEntryBytes: 1e6, maxEntries: 100 }),
    (error) => error.code === 'too-large',
  );
});

// ------------------------------------------------------- the path rules

test('every traversal shape is refused', () => {
  /**
   * The oldest archive bug there is, and still how archives are exploited. Each
   * of these writes outside the directory being extracted into.
   */
  for (const name of [
    '../etc/passwd',
    '../../etc/passwd',
    'assets/../../etc/passwd',
    '/etc/passwd',
    '//etc/passwd',
    'C:/windows/system32/x',
    'c:\\windows\\x',
    '..\\..\\windows\\system32',
    'assets/..\\..\\x',
    'a\0../../b',
  ]) {
    assert.equal(isSafeArchivePath(name), false, name);
  }
});

test('ordinary theme paths are allowed', () => {
  for (const name of [
    'layout/theme.liquid',
    'sections/main-product.liquid',
    'assets/theme.min.js',
    'locales/en.default.json',
    'config/settings_schema.json',
    'snippets/price.liquid',
    'assets/logo@2x.png',
    'assets/a.b.c.css',
  ]) {
    assert.equal(isSafeArchivePath(name), true, name);
  }
});

test('names Windows would silently rewrite are refused', () => {
  // `foo.` and `foo ` are both `foo` there, so two entries collide into one —
  // which is a way to overwrite a file the archive also declares honestly.
  assert.equal(isSafeArchivePath('assets/theme.'), false);
  assert.equal(isSafeArchivePath('assets/theme '), false);
  assert.equal(isSafeArchivePath('bad./x.css'), false);
});

test('an empty or absurdly long name is refused', () => {
  assert.equal(isSafeArchivePath(''), false);
  assert.equal(isSafeArchivePath(`${'a/'.repeat(300)}x.css`), false);
});

test('an archive containing a traversal fails wholly, not partially', () => {
  /**
   * Built by hand, because `zip` will not create one — which is itself the
   * point: an archive with `../` in it was made deliberately.
   *
   * The whole archive is refused rather than the entry skipped. Skipping would
   * install a theme with a file missing, and nobody could explain the bug.
   */
  const zip = handMadeZip('../../evil.txt', Buffer.from('pwned'));

  assert.throws(
    () => readZip(zip),
    (error) => error instanceof ZipError && error.code === 'unsafe-path',
  );
});

test('a header that under-declares its size is caught', () => {
  // How a bomb gets past a size check: the limit is applied to the claim, and
  // the real data is larger. Comparing the two is what makes the check mean
  // anything.
  const zip = handMadeZip('a.txt', Buffer.from('x'.repeat(100)), { declaredSize: 5 });

  assert.throws(
    () => readZip(zip),
    (error) => error instanceof ZipError && error.code === 'corrupt',
  );
});

test('an unsupported compression method is named, not ignored', () => {
  const zip = handMadeZip('a.txt', Buffer.from('hello'), { method: 14 });

  assert.throws(
    () => readZip(zip),
    (error) => error.code === 'unsupported' && /method 14/.test(error.message),
  );
});

/**
 * Builds a minimal archive directly, for the cases a real archiver refuses to
 * produce. Deliberately simple: one entry, no comment, no extra fields.
 */
function handMadeZip(name, contents, options = {}) {
  const method = options.method ?? 8;
  const body = method === 8 ? deflateRawSync(contents) : contents;
  const nameBytes = Buffer.from(name, 'utf8');
  const declared = options.declaredSize ?? contents.length;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);

  const centralStart = local.length + nameBytes.length + body.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);

  return Buffer.concat([local, nameBytes, body, central, nameBytes, end]);
}
