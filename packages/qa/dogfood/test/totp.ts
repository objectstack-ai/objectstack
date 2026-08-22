// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RFC 6238 TOTP, for dogfood fixtures that must confirm a 2FA enrolment.
 *
 * Hand-rolled rather than imported, for the reason
 * `two-factor-lockout.dogfood.test.ts` first wrote down: `@better-auth/utils/otp`
 * is a TRANSITIVE dependency, and adding it as a direct one just to generate six
 * digits would tie these tests to an internal package's resolution. better-auth's
 * defaults are the RFC's (SHA-1, 6 digits, 30s), and `enable`'s own otpauth://
 * URI asserts them.
 *
 * ⚠️ `two-factor-lockout.dogfood.test.ts` still carries its own private copy of
 * these two functions — this module was extracted while adding a second caller
 * (#10681) and deliberately did NOT rewrite that file's internals, since it pins
 * an unrelated card. Consolidating it is filed separately.
 */

import { createHmac } from 'node:crypto';

/** Decode a base32 secret (as carried in an otpauth:// URI) to raw bytes. */
export function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit TOTP for `secret` at the current 30-second step. */
export function totp(secret: Buffer): string {
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** Pull the plaintext base32 secret out of an `enable` response's otpauth:// URI. */
export function secretFromTotpUri(totpURI: string): Buffer {
  const secret = new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret');
  if (!secret) throw new Error('no secret in the otpauth URI');
  return base32Decode(secret);
}
