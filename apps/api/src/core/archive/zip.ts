/**
 * Core · archive/zip.ts
 * Reading a ZIP archive somebody uploaded.
 *
 * Written here rather than taken from a package, because almost everything that
 * matters about unpacking an archive is a REFUSAL, and the refusals are the
 * reason this file exists at all. A generic reader extracts what it is given;
 * this one is a list of things it will not do.
 *
 * An uploaded archive is attacker-controlled in every field — the entry names,
 * the declared sizes, the compressed bytes. Three attacks follow from that, and
 * each is answered below rather than left to whoever calls this:
 *
 * **Path traversal (`zip slip`).** An entry named `../../etc/passwd`, or
 * `/etc/passwd`, or `..\\..\\windows\\system32` writes outside the directory
 * being extracted into. This is the oldest archive bug there is and it is still
 * how archives are exploited. Names are validated here, and a suspicious one
 * fails the whole archive rather than being skipped: an archive containing an
 * escape attempt is not an archive to trust the rest of.
 *
 * **Decompression bombs.** A few kilobytes can declare gigabytes. Both the
 * per-entry and total uncompressed sizes are capped BEFORE inflating, and the
 * inflated result is checked against what the entry claimed — a header that
 * lied is itself a reason to stop.
 *
 * **Resource exhaustion by count.** Ten thousand empty files cost nothing to
 * compress and a great deal to write. The entry count is capped too.
 *
 * Only the two compression methods that exist in practice are supported —
 * stored and deflate. An archive using anything else is refused by name rather
 * than silently producing nothing.
 * Layer: core.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** The path inside the archive, already validated as safe and relative. */
  readonly path: string;
  readonly contents: Buffer;
}

export interface ZipLimits {
  /** Uncompressed bytes across the whole archive. */
  readonly maxTotalBytes: number;
  /** Uncompressed bytes for any single entry. */
  readonly maxEntryBytes: number;
  readonly maxEntries: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  // A large theme with its images is a few tens of megabytes.
  maxTotalBytes: 100 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  maxEntries: 5_000,
};

export class ZipError extends Error {
  constructor(
    readonly code:
      | 'not-a-zip'
      | 'unsupported'
      | 'too-large'
      | 'too-many-entries'
      | 'unsafe-path'
      | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

// Signatures, little-endian, as the specification defines them.
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/**
 * Whether an entry name is safe to join onto a directory.
 *
 * Every clause is an escape somebody has actually used. Exported because the
 * theme installer checks names before it decides to unpack at all, and two
 * copies of this rule would be one copy too many.
 */
export function isSafeArchivePath(name: string): boolean {
  if (name === '' || name.length > 512) return false;

  // A backslash is a separator on Windows, so `..\..\x` traverses there even
  // though it is one "segment" here.
  const normalised = name.replace(/\\/g, '/');

  // Absolute, or a Windows drive. Joining either onto a root ignores the root.
  if (normalised.startsWith('/') || /^[a-zA-Z]:/.test(normalised)) return false;

  // A NUL truncates the path in any C-based syscall, so `a.txt\0../../x` can be
  // one name to a checker and another to the filesystem.
  if (normalised.includes('\0')) return false;

  const segments = normalised.split('/');
  for (const segment of segments) {
    if (segment === '..') return false;
    // A trailing dot or space is stripped by Windows, so `foo.` and `foo` are
    // the same file there — which is how two entries collide into one.
    if (segment !== '' && /[. ]$/.test(segment)) return false;
  }

  return true;
}

/**
 * Reads an archive into memory.
 *
 * Everything at once rather than a stream, deliberately: the limits above bound
 * what that can cost, and a theme is validated as a whole before any of it is
 * written. Streaming would mean writing files before knowing whether the
 * archive is acceptable, which is the shape that leaves half a theme on disk.
 */
export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): readonly ZipEntry[] {
  const end = findEndOfCentralDirectory(buffer);

  const entryCount = buffer.readUInt16LE(end + 10);
  if (entryCount > limits.maxEntries) {
    throw new ZipError(
      'too-many-entries',
      `This archive has ${entryCount} entries and the limit is ${limits.maxEntries}.`,
    );
  }

  let offset = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let total = 0;

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new ZipError('corrupt', 'This archive’s directory is damaged.');
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);

    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    // A directory entry, which carries no contents. Skipped rather than
    // refused: every archiver writes them.
    if (name.endsWith('/')) continue;

    if (!isSafeArchivePath(name)) {
      /**
       * The whole archive fails, not just this entry.
       *
       * An archive containing a path-traversal attempt is not one to trust the
       * rest of — and silently skipping the entry would install a theme with a
       * file missing, which is a bug report nobody can explain.
       */
      throw new ZipError('unsafe-path', `This archive contains an unsafe file path: ${name}`);
    }

    /**
     * Checked BEFORE inflating, from the header.
     *
     * The header can lie, which is why the result is checked again below — but
     * a claim above the limit is refused without spending the memory to find
     * out, and that is what makes a bomb cheap to reject.
     */
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError('too-large', `${name} declares ${uncompressedSize} bytes, which is too large.`);
    }
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) {
      throw new ZipError('too-large', 'This archive is larger than the limit once unpacked.');
    }

    entries.push({
      path: name,
      contents: readEntry(buffer, localOffset, method, compressedSize, uncompressedSize, name, limits),
    });
  }

  return entries;
}

function readEntry(
  buffer: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  name: string,
  limits: ZipLimits,
): Buffer {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new ZipError('corrupt', `The entry for ${name} is damaged.`);
  }

  /**
   * The local header's own name and extra lengths, not the central one's.
   *
   * They are allowed to differ, and using the central directory's lengths here
   * reads the data from the wrong offset — which produces a file that inflates
   * to garbage rather than an error.
   */
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;

  if (start + compressedSize > buffer.length) {
    throw new ZipError('corrupt', `The entry for ${name} runs past the end of the archive.`);
  }

  const raw = buffer.subarray(start, start + compressedSize);

  const contents =
    method === 0
      ? Buffer.from(raw)
      : method === 8
        ? inflate(raw, name, limits)
        : (() => {
            throw new ZipError(
              'unsupported',
              `${name} uses compression method ${method}, which this platform does not read. ` +
                'Re-create the archive with standard zip compression.',
            );
          })();

  /**
   * The inflated size must match what the header claimed.
   *
   * A header that under-declares is how a bomb gets past a size check: the
   * limit is applied to the claim, and the real data is larger. Comparing them
   * is what makes the earlier check meaningful.
   */
  if (contents.length !== uncompressedSize) {
    throw new ZipError(
      'corrupt',
      `${name} declares ${uncompressedSize} bytes but unpacks to ${contents.length}.`,
    );
  }

  return contents;
}

function inflate(raw: Buffer, name: string, limits: ZipLimits): Buffer {
  try {
    // `maxOutputLength` makes zlib itself stop, so a bomb is refused during
    // decompression rather than after it has been allocated.
    return inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/buffer|length/i.test(message)) {
      throw new ZipError('too-large', `${name} unpacks to more than the per-file limit.`);
    }
    throw new ZipError('corrupt', `${name} could not be unpacked.`);
  }
}

/**
 * Finds the end-of-central-directory record, scanning backwards.
 *
 * It is at the end of the file, but a trailing comment of up to 64 KB may
 * follow it, so its position is not fixed. Scanning backwards from the end
 * finds the last one, which is the real one — a nested archive's record can
 * appear earlier in the bytes.
 */
function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) throw new ZipError('not-a-zip', 'This file is not a zip archive.');

  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let at = buffer.length - 22; at >= earliest; at--) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }

  throw new ZipError('not-a-zip', 'This file is not a zip archive, or it is truncated.');
}
