/**
 * Auth · domain/credentials.ts
 * Password hashing, one-time tokens and session-token handling.
 *
 * Ported from the donor codebase with two deliberate changes: scrypt runs
 * asynchronously (the synchronous variant blocks the event loop, which turns a
 * login spike into an availability incident) and the cost parameters are
 * explicit rather than Node's defaults.
 * Layer: domain (pure; Node crypto only, no framework).
 */

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters, stored alongside each hash so they can be raised later
 * without invalidating existing passwords. N=2^16 is roughly 100 ms on modern
 * hardware — expensive enough to matter to an attacker, cheap enough for a login.
 */
const SCRYPT = { N: 65536, r: 8, p: 1, keyLength: 64, maxmem: 128 * 65536 * 8 * 2 };

const HASH_PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  // Parameters travel with the hash so a future cost increase is a rehash on
  // next login rather than a forced reset for everyone.
  return `${HASH_PREFIX}$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;

  const [, rawN, rawR, rawP, salt, expected] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!salt || !expected || !Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'hex');
  const derived = await scryptAsync(password, salt, expectedBuffer.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });

  if (derived.length !== expectedBuffer.length) return false;
  // Constant-time: a length-or-content early exit leaks the hash a byte at a time.
  return timingSafeEqual(derived, expectedBuffer);
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return true;
  return Number(parts[1]) < SCRYPT.N;
}

// --- password policy --------------------------------------------------------

export interface PasswordPolicyResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export const PASSWORD_MIN_LENGTH = 12;

/**
 * Length first, composition rules barely at all. Mandatory symbol-and-digit
 * rules push people toward "Password1!" — measurably worse than a longer
 * passphrase. We check length and screen the obvious reuses.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'passw0rd', '123456', '12345678', '123456789',
  'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon',
  'football', 'baseball', 'abc123', 'changeme', 'password123',
]);

export function checkPasswordPolicy(password: string, context: { email?: string } = {}): PasswordPolicyResult {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > 200) {
    // Unbounded input into a deliberately slow KDF is a cheap denial of service.
    problems.push('must be 200 characters or fewer');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    problems.push('is one of the most commonly used passwords');
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('cannot be a single repeated character');
  }

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    problems.push('cannot contain your email address');
  }

  return { ok: problems.length === 0, problems };
}

// --- tokens -----------------------------------------------------------------

/**
 * Session and one-time tokens are stored HASHED. A database disclosure then
 * yields no usable credential, which is the whole point of not storing the
 * token itself.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidateHash.length !== stored.length) return false;
  return timingSafeEqual(candidateHash, stored);
}

/**
 * A short numeric code for email or SMS verification. `randomInt` is
 * cryptographically secure and unbiased — Math.random would be neither.
 */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

/** The `rid` threading the whole login chain, so every step is correlatable. */
export function generateRequestId(): string {
  return generateToken(16);
}
