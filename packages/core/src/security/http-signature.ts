// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The outbound HTTP signature scheme — the ONE definition every ObjectStack
 * sender signs with and every receiver verifies against.
 *
 * A request carries {@link HTTP_SIGNATURE_HEADER} whose value is
 * {@link signHttpBody} of the exact bytes of its body under the shared secret:
 * `sha256=` followed by the lowercase hex HMAC-SHA256. A request with no body is
 * signed over the empty string, which is what its receiver reads.
 *
 * It lives in `@objectstack/core` because two senders that cannot import each
 * other at runtime both sign with it: `@objectstack/service-messaging`'s durable
 * HTTP outbox (which signs at enqueue) and `@objectstack/service-automation`'s
 * flow `http` node, whose inline arm — and its durable arm's fallback when no
 * outbox is wired — calls `fetch` itself. `service-messaging` re-exports both
 * names unchanged, so its published surface still carries them. ⛔ Never a
 * second copy of this HMAC input anywhere: two copies are how one key comes to
 * mean two things on two arms.
 *
 * What the scheme does NOT own is WHICH bytes are the body — each sender signs
 * the serialization it actually sends.
 *
 * ## The timestamped form, and the receiver's side
 *
 * The body-only value signs no time, so a captured request verifies forever: a
 * replay of it is indistinguishable from the original. The header therefore
 * has a second, versioned form, {@link signHttpBodyAt}:
 * `t=<unix seconds>,v1=<hex>`, where the hex is the HMAC-SHA256 of
 * `<t>.<body>` — the timestamp is INSIDE the signed material, so it cannot be
 * moved without the secret, and a receiver refuses a `t` outside
 * {@link HTTP_SIGNATURE_TOLERANCE_SECONDS} of its own clock. The two forms
 * share the one header and are told apart by their prefix (`sha256=` against
 * `t=`), so a receiver needs no second header and a sender changes one value.
 *
 * {@link verifyHttpSignature} is the receiver's half of both forms, and the
 * only one: it re-signs with the functions above and compares in constant
 * time, so the material a receiver checks is, by construction, the material a
 * sender signs. Our own senders still send the body-only form — a receiver
 * outside ObjectStack verifies exactly that today, and switching them would
 * break it — so the body-only form stays accepted; refusing it is a decision
 * of its own, not this definition's.
 */

/** Header carrying the HMAC-SHA256 signature of the request body. */
export const HTTP_SIGNATURE_HEADER = 'X-Objectstack-Signature';

/**
 * How far, in seconds, a timestamped signature's `t` may sit from the
 * receiver's clock, in either direction, and still verify. Five minutes: wide
 * enough for ordinary clock skew and a sender's retry, narrow enough that a
 * captured request stops verifying soon after it was sent. Fixed, not
 * configured — the window is part of the scheme every sender targets.
 */
export const HTTP_SIGNATURE_TOLERANCE_SECONDS = 300;

/** The body-only form's prefix — what {@link signHttpBody} produces. */
const BODY_ONLY_PREFIX = 'sha256=';

/**
 * The timestamped form, exactly as {@link signHttpBodyAt} writes it: a
 * canonical decimal `t` (no sign, no leading zero) and one 64-digit lowercase
 * hex `v1`. Anything else claiming the form is malformed, never re-read.
 */
const TIMESTAMPED_FORM = /^t=(0|[1-9][0-9]{0,14}),v1=[0-9a-f]{64}$/;

/** The lowercase hex HMAC-SHA256 of `material` — the one HMAC both forms use. */
function hmacSha256Hex(material: string, secret: string): string {
    return createHmac('sha256', secret).update(material).digest('hex');
}

/**
 * Compute the {@link HTTP_SIGNATURE_HEADER} value for a body: `sha256=<hex>` of
 * `HMAC-SHA256(body, secret)`.
 *
 * The output is safe to persist (it is handed to the receiver on the wire
 * anyway); the `secret` argument is NOT.
 */
export function signHttpBody(body: string, secret: string): string {
    return `${BODY_ONLY_PREFIX}${hmacSha256Hex(body, secret)}`;
}

/**
 * Compute the timestamped {@link HTTP_SIGNATURE_HEADER} value for a body sent
 * at `timestampSeconds` (Unix time, whole seconds): `t=<timestampSeconds>,v1=<hex>`
 * where the hex is `HMAC-SHA256(<timestampSeconds>.<body>, secret)`.
 *
 * Sign at send time, not at enqueue: a receiver refuses the value once its
 * clock is more than {@link HTTP_SIGNATURE_TOLERANCE_SECONDS} from `t`, so a
 * value persisted and replayed later stops verifying — which is the point.
 *
 * @throws RangeError when `timestampSeconds` is not a non-negative safe integer.
 */
export function signHttpBodyAt(body: string, secret: string, timestampSeconds: number): string {
    if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
        throw new RangeError(
            `signHttpBodyAt: timestampSeconds must be a non-negative whole number of seconds since the Unix epoch, ` +
                `got ${String(timestampSeconds)} — pass Math.floor(Date.now() / 1000).`,
        );
    }
    return `t=${timestampSeconds},v1=${hmacSha256Hex(`${timestampSeconds}.${body}`, secret)}`;
}

/**
 * What {@link verifyHttpSignature} concluded. A receiver answers every
 * `valid: false` alike; `reason` is for its own tests and logs, never for the
 * sender. `scheme` says which form verified, so a receiver can signal the
 * body-only form's deprecation.
 *
 *  - `absent` — no header, or a blank one.
 *  - `malformed` — neither form's shape.
 *  - `mismatch` — the shape is right, and the HMAC is not the secret's for
 *    this body (and, for the timestamped form, this `t`).
 *  - `outside-window` — a timestamped value whose HMAC verified, with a `t`
 *    more than {@link HTTP_SIGNATURE_TOLERANCE_SECONDS} from the receiver's
 *    clock: a replay, or a sender clock that is wrong.
 */
export type HttpSignatureVerdict =
    | { readonly valid: true; readonly scheme: 'v1' | 'body-only' }
    | { readonly valid: false; readonly reason: 'absent' | 'malformed' | 'mismatch' | 'outside-window' };

/** Constant-time compare of two equal-length strings (a length difference is not secret). */
function constantTimeEqual(expected: string, received: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * Verify an inbound {@link HTTP_SIGNATURE_HEADER} value against the exact bytes
 * of the body received and the shared secret, in either form:
 *
 *  - `sha256=<hex>` — the body-only form, verified by re-signing with
 *    {@link signHttpBody}.
 *  - `t=<seconds>,v1=<hex>` — the timestamped form, verified by re-signing
 *    with {@link signHttpBodyAt} at the `t` it carries, and then refused unless
 *    `t` is within {@link HTTP_SIGNATURE_TOLERANCE_SECONDS} of this clock. A
 *    value that claims this form is judged by it alone: it never falls back to
 *    the body-only form.
 *
 * The header is trimmed first. Both comparisons are constant-time.
 */
export function verifyHttpSignature(body: string, secret: string, header: string | undefined): HttpSignatureVerdict {
    const value = header?.trim();
    if (!value) return { valid: false, reason: 'absent' };

    if (value.startsWith(BODY_ONLY_PREFIX)) {
        return constantTimeEqual(signHttpBody(body, secret), value)
            ? { valid: true, scheme: 'body-only' }
            : { valid: false, reason: 'mismatch' };
    }

    const form = TIMESTAMPED_FORM.exec(value);
    if (!form) return { valid: false, reason: 'malformed' };
    // At most fifteen digits, so always a safe integer.
    const timestampSeconds = Number(form[1]);
    if (!constantTimeEqual(signHttpBodyAt(body, secret, timestampSeconds), value)) {
        return { valid: false, reason: 'mismatch' };
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > HTTP_SIGNATURE_TOLERANCE_SECONDS) {
        return { valid: false, reason: 'outside-window' };
    }
    return { valid: true, scheme: 'v1' };
}
