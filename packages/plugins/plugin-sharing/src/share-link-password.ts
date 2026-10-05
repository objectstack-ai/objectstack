// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The share-link password's stored form — hashing, verification, and the
 * legacy forms that still verify until their next successful redemption.
 *
 * ## The current form is the platform's password hash
 *
 * `scrypt$SALT_HEX$KEY_HEX`, with the parameters the platform's account
 * passwords use (better-auth's hasher, and the pure-JS twin `plugin-auth`
 * carries for WebContainer): N=16384, r=16, p=1, a 64-byte key, a 16-byte
 * random salt passed as its hex string, and the password NFKC-normalised.
 * Same algorithm and parameters, so a share-link password is exactly as
 * expensive to brute-force from a database dump as a sign-in password.
 *
 * ## Two implementations, one hash
 *
 * On Node the key is derived by `node:crypto`'s scrypt. WebContainer
 * (StackBlitz) reports itself as Node but polyfills `node:crypto.scrypt`
 * incompletely, so there — detected exactly as `plugin-auth`'s
 * `isWebContainerRuntime()` detects it — the key is derived by
 * `@noble/hashes/scrypt` instead, the same pure-JS scrypt `plugin-auth` swaps
 * in for account passwords on that host. Same parameters, same salt input,
 * same output bytes: a hash minted by either verifies under the other, so a
 * link created in a WebContainer keeps working when the app is deployed. The
 * pure-JS module is loaded only on that host; elsewhere it is never imported.
 *
 * ## The legacy forms, and why they are upgraded on read rather than migrated
 *
 * Rows minted before this module stored either `sha256$SALT$HEX` (one salted
 * SHA-256 — fast to brute-force) or, on a runtime without SubtleCrypto,
 * `weak$SALT$PLAINTEXT`. Neither can be converted without the password, which
 * the server only sees when a holder presents it. So both still VERIFY, and
 * `ShareLinkService.resolveToken` re-hashes into the current form on the first
 * successful redemption ({@link isLegacyShareLinkPasswordHash}); nobody's link
 * breaks, and a protected link stops carrying the weak form the first time it
 * is used.
 *
 * ## Every comparison is constant-time
 *
 * `timingSafeEqual` over equal-length buffers. The plaintext legacy form is
 * compared through a SHA-256 of both sides first, so neither its content nor
 * its length is read off the comparison's timing.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** The platform's account-password scrypt parameters (better-auth's). */
const SCRYPT_N = 16384;
const SCRYPT_R = 16;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 64;
const SCRYPT_SALT_BYTES = 16;
/** Headroom over the 128·N·r = 32 MiB the parameters need (node's default cap is 32 MiB). */
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

const CURRENT_PREFIX = 'scrypt$';
const LEGACY_SHA256_PREFIX = 'sha256$';
const LEGACY_PLAINTEXT_PREFIX = 'weak$';

/**
 * WebContainer (StackBlitz) detection — the same three signals `plugin-auth`'s
 * `isWebContainerRuntime()` and `service-settings`' local crypto provider read.
 */
function isWebContainerRuntime(): boolean {
  const proc = (globalThis as { process?: { versions?: Record<string, unknown>; env?: Record<string, unknown> } })
    .process;
  return (
    Boolean(proc?.versions?.webcontainer) ||
    (typeof proc?.env?.SHELL === 'string' && proc.env.SHELL.includes('jsh')) ||
    Boolean(proc?.env?.STACKBLITZ)
  );
}

/** The pure-JS scrypt, with exactly the parameters {@link deriveKeyNode} passes. */
async function deriveKeyPureJs(password: string, saltHex: string): Promise<Buffer> {
  const { scryptAsync } = await import('@noble/hashes/scrypt.js');
  const key = await scryptAsync(password.normalize('NFKC'), saltHex, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: SCRYPT_KEY_BYTES,
    maxmem: SCRYPT_MAXMEM,
  });
  return Buffer.from(key);
}

function deriveKey(password: string, saltHex: string): Promise<Buffer> {
  return isWebContainerRuntime() ? deriveKeyPureJs(password, saltHex) : deriveKeyNode(password, saltHex);
}

function deriveKeyNode(password: string, saltHex: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      saltHex,
      SCRYPT_KEY_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Constant-time equality of two hex strings of the expected byte length. */
function hexEqual(actualHex: string, expectedHex: string, bytes: number): boolean {
  if (!/^[0-9a-f]+$/i.test(expectedHex) || expectedHex.length !== bytes * 2) return false;
  const a = Buffer.from(actualHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Split `PREFIX` + `SALT$REST`, where REST may itself contain `$`. */
function splitSaltAndRest(hash: string, prefix: string): [string, string] | null {
  const body = hash.slice(prefix.length);
  const cut = body.indexOf('$');
  if (cut <= 0) return null;
  return [body.slice(0, cut), body.slice(cut + 1)];
}

/** Hash a share-link password into the current stored form. */
export async function hashShareLinkPassword(password: string): Promise<string> {
  const saltHex = randomBytes(SCRYPT_SALT_BYTES).toString('hex');
  const key = await deriveKey(password, saltHex);
  return `${CURRENT_PREFIX}${saltHex}$${key.toString('hex')}`;
}

/**
 * Verify a presented password against a stored hash in the current form or
 * either legacy form. An unrecognised form verifies nothing.
 */
export async function verifyShareLinkPassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof hash !== 'string') return false;

  if (hash.startsWith(CURRENT_PREFIX)) {
    const parts = splitSaltAndRest(hash, CURRENT_PREFIX);
    if (!parts) return false;
    const [saltHex, keyHex] = parts;
    const key = await deriveKey(password, saltHex);
    return hexEqual(key.toString('hex'), keyHex, SCRYPT_KEY_BYTES);
  }

  if (hash.startsWith(LEGACY_SHA256_PREFIX)) {
    const parts = splitSaltAndRest(hash, LEGACY_SHA256_PREFIX);
    if (!parts) return false;
    const [salt, expectedHex] = parts;
    const actualHex = createHash('sha256').update(`${salt}:${password}`, 'utf8').digest('hex');
    return hexEqual(actualHex, expectedHex, 32);
  }

  if (hash.startsWith(LEGACY_PLAINTEXT_PREFIX)) {
    const parts = splitSaltAndRest(hash, LEGACY_PLAINTEXT_PREFIX);
    if (!parts) return false;
    const [, stored] = parts;
    const a = createHash('sha256').update(password, 'utf8').digest();
    const b = createHash('sha256').update(stored, 'utf8').digest();
    return timingSafeEqual(a, b);
  }

  return false;
}

/**
 * True when a stored hash is in a legacy form this module still verifies but
 * no longer writes — the cue to re-hash after a successful verification.
 */
export function isLegacyShareLinkPasswordHash(hash: unknown): boolean {
  return (
    typeof hash === 'string' &&
    (hash.startsWith(LEGACY_SHA256_PREFIX) || hash.startsWith(LEGACY_PLAINTEXT_PREFIX))
  );
}
