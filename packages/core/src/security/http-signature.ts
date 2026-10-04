// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac } from 'node:crypto';

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
 */

/** Header carrying the HMAC-SHA256 signature of the request body. */
export const HTTP_SIGNATURE_HEADER = 'X-Objectstack-Signature';

/**
 * Compute the {@link HTTP_SIGNATURE_HEADER} value for a body: `sha256=<hex>` of
 * `HMAC-SHA256(body, secret)`.
 *
 * The output is safe to persist (it is handed to the receiver on the wire
 * anyway); the `secret` argument is NOT.
 */
export function signHttpBody(body: string, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
