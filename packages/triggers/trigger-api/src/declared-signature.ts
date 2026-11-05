// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTP_SIGNATURE_TOLERANCE_SECONDS } from '@objectstack/core';
import type { ApiTriggerSignature } from '@objectstack/spec/automation';

/**
 * The verifier for a sender's own signature scheme, declared on an `api`
 * hook's start node as `config.signature` (`@objectstack/spec/automation`,
 * `api-trigger-signature.zod.ts`). What it owes is the contract text on
 * `ITriggerApiService.handleInboundHook` ("A sender's own scheme, declared,
 * REPLACES that check"), implemented here step for step:
 *
 *  - the declared header's ONE value, a repeated field already joined with
 *    `, ` by `Headers.get` (the caller reads it so), trimmed;
 *  - `signs: 'body'`: after `prefix` when one is declared (a value without it
 *    fails), the whole value is the one digest, so a repeated body-only header
 *    does not decode and fails;
 *  - `signs: 'timestamp.body'`: `NAME=value` elements separated by `,`, each
 *    trimmed and split at its first `=`; exactly one `timestampElement`,
 *    written as `x-objectstack-signature` writes its `t` (decimal, no sign, no
 *    leading zero, at most fifteen digits); one or more `digestElement`s (a
 *    sender rolling its key sends one per key); any other element ignored;
 *  - the HMAC-SHA256, under the key, of the raw body exactly as received, or of
 *    `<t>.<raw body>` with `<t>` exactly as received;
 *  - each received digest decoded by `encoding` to exactly 32 bytes (strictly:
 *    a value that is not the canonical spelling of 32 bytes does not decode)
 *    and compared with that HMAC in constant time (`timingSafeEqual`); the post
 *    verifies when one digest matches;
 *  - for `timestamp.body`, then a `t` more than
 *    `HTTP_SIGNATURE_TOLERANCE_SECONDS` from this clock is refused: core's
 *    window, the one the `x-objectstack-signature` check applies, ⛔ never one
 *    of this file's own. A `body` scheme signs no time, so no window applies
 *    to it (the contract states it; nothing here invents one).
 *
 * Every failure is a `cause` for the server log; the sender gets the one
 * `401 INVALID_SIGNATURE` the trigger answers every unverified post with. The
 * key, the header value and the body are ⛔ never part of a cause.
 */

/** Why a declared scheme did not verify. Server-log only. */
export type DeclaredSignatureCause =
    | 'declared-header-absent'
    | 'declared-header-malformed'
    | 'declared-prefix-missing'
    | 'declared-no-digest'
    | 'declared-mismatch'
    | 'declared-outside-window';

export type DeclaredSignatureVerdict =
    | { readonly valid: true }
    | { readonly valid: false; readonly cause: DeclaredSignatureCause };

/** The length of an HMAC-SHA256 digest, the only length a received digest may decode to. */
const DIGEST_BYTES = 32;

/** 32 bytes in hex: 64 hex digits, either case. */
const HEX_DIGEST = /^[0-9A-Fa-f]{64}$/;

/**
 * 32 bytes in base64, the RFC 4648 standard alphabet: 43 characters and one
 * `=` of padding. Node's decoder skips characters outside the alphabet, so the
 * shape is checked before decoding and the canonical spelling after.
 */
const BASE64_DIGEST = /^[A-Za-z0-9+/]{43}=$/;

/** A timestamp exactly as `x-objectstack-signature` writes its `t` (core's `TIMESTAMPED_FORM`). */
const TIMESTAMP = /^(0|[1-9][0-9]{0,14})$/;

/**
 * The 32 bytes a received digest spells, or `undefined` when it spells
 * anything else (another length, another alphabet, a non-canonical base64
 * tail): such a digest matches nothing.
 */
function decodeDigest(text: string, encoding: ApiTriggerSignature['encoding']): Buffer | undefined {
    if (encoding === 'hex') {
        return HEX_DIGEST.test(text) ? Buffer.from(text, 'hex') : undefined;
    }
    if (!BASE64_DIGEST.test(text)) return undefined;
    const bytes = Buffer.from(text, 'base64');
    if (bytes.length !== DIGEST_BYTES || bytes.toString('base64') !== text) return undefined;
    return bytes;
}

/**
 * Whether one of `digests` is `expected`, each compared in constant time. All
 * are compared, so the time taken does not say which one matched.
 */
function anyDigestMatches(expected: Buffer, digests: readonly Buffer[]): boolean {
    let matched = false;
    for (const digest of digests) {
        if (timingSafeEqual(expected, digest)) matched = true;
    }
    return matched;
}

function hmacSha256(key: string, material: string): Buffer {
    return createHmac('sha256', key).update(material, 'utf8').digest();
}

/**
 * Verify one post against the hook's declared scheme.
 *
 * @param scheme - the parsed declaration (`apiTriggerVerifierOf(config).signature`)
 * @param key - the key `config.secretRef` names, read for this post
 * @param rawBody - the body exactly as received (`request.text()`)
 * @param headerValue - the declared header's one value (`Headers.get`), or
 *   `undefined` when the post does not carry it
 * @param nowSeconds - this server's clock, in unix seconds
 */
export function verifyDeclaredSignature(
    scheme: ApiTriggerSignature,
    key: string,
    rawBody: string,
    headerValue: string | undefined,
    nowSeconds: number = Math.floor(Date.now() / 1000),
): DeclaredSignatureVerdict {
    const value = headerValue?.trim();
    if (!value) return { valid: false, cause: 'declared-header-absent' };

    if (scheme.signs === 'body') {
        let digestText = value;
        if (scheme.prefix !== undefined) {
            if (!value.startsWith(scheme.prefix)) return { valid: false, cause: 'declared-prefix-missing' };
            digestText = value.slice(scheme.prefix.length);
        }
        const digest = decodeDigest(digestText, scheme.encoding);
        if (!digest) return { valid: false, cause: 'declared-header-malformed' };
        return anyDigestMatches(hmacSha256(key, rawBody), [digest])
            ? { valid: true }
            : { valid: false, cause: 'declared-mismatch' };
    }

    const timestamps: string[] = [];
    const digestTexts: string[] = [];
    for (const raw of value.split(',')) {
        const element = raw.trim();
        if (!element) continue;
        const eq = element.indexOf('=');
        // Split at the first `=` and nothing more: base64 padding stays in the
        // value, and a value is read exactly as received (`<t>` is signed so).
        const name = eq === -1 ? element : element.slice(0, eq);
        const elementValue = eq === -1 ? undefined : element.slice(eq + 1);
        if (name === scheme.timestampElement) {
            // An element named as the timestamp with no value is a malformed timestamp.
            timestamps.push(elementValue ?? '');
        } else if (name === scheme.digestElement) {
            digestTexts.push(elementValue ?? '');
        }
        // Any other element is the sender's own business, and ignored.
    }
    if (timestamps.length !== 1 || !TIMESTAMP.test(timestamps[0]!)) {
        return { valid: false, cause: 'declared-header-malformed' };
    }
    if (digestTexts.length === 0) return { valid: false, cause: 'declared-no-digest' };
    const digests = digestTexts
        .map((text) => decodeDigest(text, scheme.encoding))
        .filter((d): d is Buffer => d !== undefined);
    if (digests.length === 0) return { valid: false, cause: 'declared-header-malformed' };

    const t = timestamps[0]!;
    if (!anyDigestMatches(hmacSha256(key, `${t}.${rawBody}`), digests)) {
        return { valid: false, cause: 'declared-mismatch' };
    }
    // At most fifteen digits, so always a safe integer. Judged after the HMAC,
    // as core judges `x-objectstack-signature`: only a signed `t` is weighed.
    if (Math.abs(nowSeconds - Number(t)) > HTTP_SIGNATURE_TOLERANCE_SECONDS) {
        return { valid: false, cause: 'declared-outside-window' };
    }
    return { valid: true };
}
