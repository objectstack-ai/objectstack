// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The cache validator of a JSON response whose body is decided per caller or
 * per request — the `/meta` lists and uncached item doors (`@objectstack/rest`),
 * `/auth/me/localization` (`@objectstack/plugin-hono-server`) and
 * `/runtime/config` (`@objectstack/cloud-connection`). One rule for the three
 * transports, so none of them grows its own reading of `If-None-Match`.
 *
 * ## The one invariant
 *
 * The ETag is a hash of the value actually being SENT, computed after every
 * per-caller step (read gates, masks, translation, per-host resolution). It is
 * the invariant `getMetaItemCached` states for the cached item read ("`content`
 * — the bytes actually being sent — is inside the hash"), applied where that
 * read cannot reach.
 *
 * Hashing the served body is what makes a per-caller fold unnecessary rather
 * than forgotten: two callers whose gates differ are served different bytes,
 * so they are handed different validators, and a `304` is only ever answered
 * to a caller holding the representation the server would send it now. ⛔ A
 * validator computed over anything cheaper than the served body — the stored
 * list before the gate, a version marker, a store checksum — lets one caller's
 * `If-None-Match` pin another caller's body: a shared ETag over a gated body.
 *
 * ## The posture
 *
 * `private, no-cache` ({@link REVALIDATE_PRIVATE_CACHE_CONTROL}): the client
 * may store the body but revalidates on every use, so a publish, a permission
 * change or a locale switch is seen on the next read, and a shared cache (CDN,
 * proxy) stores nothing — ⛔ never `public` on a body a per-caller gate varies.
 *
 * The validator is WEAK (`W/"…"`): it identifies the JSON value, and a
 * compressing layer between the server and the client may re-encode the bytes.
 * `If-None-Match` compares weakly (RFC 9110 §13.1.2), so a weak validator
 * revalidates exactly as a strong one would.
 */

/** Stored by the client, revalidated on every use, never stored by a shared cache. */
export const REVALIDATE_PRIVATE_CACHE_CONTROL = 'private, no-cache';

/**
 * Two independent FNV-1a/32 lanes (different offset bases), 16 hex chars. Not
 * cryptographic, and it need not be: a validator is compared only against one
 * the same client was issued, so what matters is that any edit moves it. Two
 * lanes keep the accidental-collision odds far below one 32-bit lane's.
 */
function hash64(text: string): string {
    let a = 0x811c9dc5;
    let b = 0x050c5d1f;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a ^= c;
        a = Math.imul(a, 0x01000193) >>> 0;
        b ^= c;
        b = Math.imul(b, 0x01000193) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * The weak ETag of one served JSON body. Pass exactly the value the transport
 * is about to serialize — after every per-caller step, never an earlier stage.
 */
export function representationEtag(body: unknown): string {
    return `W/"${hash64(JSON.stringify(body) ?? 'undefined')}"`;
}

/**
 * Whether a request's `If-None-Match` names `etag` — the weak comparison of
 * RFC 9110 §13.1.2: each listed validator is compared with its `W/` prefix
 * stripped, and `*` matches any current representation.
 */
export function ifNoneMatchHits(ifNoneMatch: unknown, etag: string): boolean {
    const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch;
    if (typeof raw !== 'string' || raw.trim() === '') return false;
    const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
    const mine = opaque(etag);
    return raw.split(',').some((candidate) => {
        const tag = candidate.trim();
        return tag === '*' || opaque(tag) === mine;
    });
}
