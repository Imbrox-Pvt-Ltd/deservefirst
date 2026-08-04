/**
 * Auth · domain/mfa.ts
 * TOTP (RFC 6238) and recovery codes. Ported from the donor codebase and kept in
 * the domain layer because it is pure computation over a secret — no storage, no
 * transport, and therefore testable against the RFC's own vectors.
 * Layer: domain (pure; Node crypto only).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { generateToken, hashToken } from './credentials';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Excludes I, O, 0 and 1 — a recovery code gets read aloud and typed by hand. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/**
 * How many periods either side of "now" are accepted. One step (±30s) absorbs
 * ordinary clock drift; more would widen the window an attacker can replay in.
 */
export const TOTP_DRIFT_STEPS = 1;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The URI a QR code encodes for an authenticator app. */
export function buildOtpAuthUrl(input: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${input.issuer}:${input.accountName}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateTotp(secret: string, atMs: number = Date.now()): string {
  return generateTotpForCounter(secret, Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS));
}

/**
 * Verifies a submitted code, accepting a small drift window. Comparison is
 * constant-time: a fast reject on the first differing digit would let an
 * attacker discover the code one character at a time.
 */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d+$/.test(normalized) || normalized.length !== TOTP_DIGITS) return false;

  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
  let matched = false;
  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset += 1) {
    const candidate = generateTotpForCounter(secret, counter + offset);
    // No early exit: check every step so the loop takes the same time either way.
    if (constantTimeEquals(candidate, normalized)) matched = true;
  }
  return matched;
}

function generateTotpForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', key).update(buffer).digest();
  // Dynamic truncation, RFC 4226 §5.4.
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

// --- recovery codes ---------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_GROUPS = 2;
const RECOVERY_GROUP_LENGTH = 5;

export interface RecoveryCodeSet {
  /** Shown to the user exactly once, at generation. */
  readonly plaintext: readonly string[];
  /** What we store. A code is single-use and is burned on redemption. */
  readonly hashes: readonly string[];
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): RecoveryCodeSet {
  const plaintext: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const groups: string[] = [];
    for (let group = 0; group < RECOVERY_CODE_GROUPS; group += 1) {
      const bytes = randomBytes(RECOVERY_GROUP_LENGTH);
      let text = '';
      for (const byte of bytes) {
        text += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
      }
      groups.push(text);
    }
    plaintext.push(groups.join('-'));
  }
  return { plaintext, hashes: plaintext.map((code) => hashToken(normalizeRecoveryCode(code))) };
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Redeems a recovery code, returning the remaining hashes. A used code is
 * removed rather than flagged — a single-use credential that survives redemption
 * is not single-use.
 */
export function redeemRecoveryCode(
  submitted: string,
  storedHashes: readonly string[],
): { redeemed: boolean; remaining: readonly string[] } {
  const candidate = hashToken(normalizeRecoveryCode(submitted));
  const index = storedHashes.indexOf(candidate);
  if (index === -1) return { redeemed: false, remaining: storedHashes };
  return {
    redeemed: true,
    remaining: [...storedHashes.slice(0, index), ...storedHashes.slice(index + 1)],
  };
}

/** A single-use, short-lived code for signing in on a device without the app. */
export function generateTemporaryLoginCode(): { code: string; hash: string; expiresInSeconds: number } {
  const code = generateToken(12);
  return { code, hash: hashToken(code), expiresInSeconds: 300 };
}

// --- base32 -----------------------------------------------------------------

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character "${char}" in TOTP secret`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
