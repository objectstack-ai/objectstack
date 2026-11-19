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
 * This is the package's SINGLE copy. It was extracted from
 * `two-factor-lockout.dogfood.test.ts` while adding a second caller (#10681),
 * which kept a private copy of its own until #11111 converged it here. Need a
 * TOTP in a new fixture? Import it from this module — do not paste a third
 * spelling of RFC 6238 into the package.
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

/** The TOTP period, in milliseconds (the RFC's and better-auth's default 30 s). */
const PERIOD_MS = 30_000;

/** The 6-digit TOTP for `secret` at the current 30-second step. */
export function totp(secret: Buffer): string {
  return totpAt(secret, Math.floor(Date.now() / PERIOD_MS));
}

/**
 * How long a code {@link freshTotp} hands out must stay inside the verifier's
 * window: the time between handing it out and the request reaching the server.
 */
const FRESH_CODE_MARGIN_MS = 5_000;

/** The last time step {@link freshTotp} handed out, per secret. */
const lastStepHandedOut = new Map<string, number>();

/**
 * A 6-digit TOTP for `secret` that the server has not accepted before.
 *
 * The server accepts a TOTP code once (RFC 6238 section 5.2) and refuses a code
 * from a step at or before the last one it accepted, so a fixture that signs in
 * with TOTP more than once needs a code from a later step each time. Its
 * verifier accepts the steps one either side of its current one: this hands out
 * the earliest step after the last one handed out for this secret that is still
 * inside that window {@link FRESH_CODE_MARGIN_MS} from now, and waits for the
 * clock when the next such step is not inside it yet (at most one period).
 * Every accepted code of a secret must come from here for the bookkeeping to hold.
 */
export async function freshTotp(secret: Buffer): Promise<string> {
  const key = secret.toString('hex');
  for (;;) {
    const now = Date.now();
    const earliest = Math.floor((now + FRESH_CODE_MARGIN_MS) / PERIOD_MS) - 1;
    const latest = Math.floor(now / PERIOD_MS) + 1;
    const step = Math.max(earliest, (lastStepHandedOut.get(key) ?? earliest - 1) + 1);
    if (step <= latest) {
      lastStepHandedOut.set(key, step);
      return totpAt(secret, step);
    }
    // `step` enters the window once step - 1 is the current step.
    await new Promise((resolve) => setTimeout(resolve, (step - 1) * PERIOD_MS - now + 50));
  }
}

/** The 6-digit TOTP for `secret` at time step `step`. */
function totpAt(secret: Buffer, step: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
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
