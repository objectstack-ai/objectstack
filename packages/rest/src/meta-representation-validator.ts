// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] The cache validator of a metadata read whose body is decided per
 * caller: the `/meta` type list, every `/meta/:type` list, and the item doors
 * the shared item cache cannot serve (`app`, `dashboard`, `doc`, `book`,
 * drafts, `?package=` and member-scoped reads).
 *
 * The rule — the ETag hashes the served body, after every per-caller step, and
 * the posture is `private, no-cache` — is `representationEtag` in
 * `@objectstack/types`, whose docblock carries why. This module adds the two
 * things only the `/meta` reads need: the ADR-0106 D6 tier-2 exception, and
 * the send on `RestServer`'s response.
 */

import { ifNoneMatchHits, representationEtag, REVALIDATE_PRIVATE_CACHE_CONTROL } from '@objectstack/types';

/**
 * The validator and posture an answer is served under: `private, no-cache`
 * and the weak ETag of `body`. `undetermined` is the ADR-0106 D6 tier-2
 * posture a chain already decided (`private, no-store`, the body unmasked): it
 * is kept, and no validator is issued, so nothing can revalidate that body.
 */
export function metaRepresentationCaching(
    body: unknown,
    undetermined?: string,
): { cacheControl: string; etag?: string } {
    if (undetermined !== undefined) return { cacheControl: undetermined };
    return { cacheControl: REVALIDATE_PRIVATE_CACHE_CONTROL, etag: representationEtag(body) };
}

/** The response surface {@link sendMetaRepresentation} writes on — `RestServer`'s `IHttpResponse` subset. */
interface RepresentationResponse {
    header(name: string, value: string): unknown;
    status(code: number): { send(body?: unknown): unknown };
    json(body: unknown): unknown;
}

/**
 * Send `body` under its caching answer: `Cache-Control`, the `ETag` when one
 * was issued, and a bodiless `304` when the request's `If-None-Match` already
 * names it.
 *
 * `enableCache` is the deployment's `metadata.enableCache`, declared as
 * "Enable HTTP cache headers (ETag, Last-Modified)" (`rest-server.zod.ts`).
 * Switched off, no validator and no revalidation posture is sent and nothing
 * is answered `304`; the ADR-0106 D6 tier-2 `private, no-store` still is,
 * because that one forbids storing an unmasked body rather than enabling a
 * cache.
 */
export function sendMetaRepresentation(
    req: { headers?: Record<string, unknown> },
    res: RepresentationResponse,
    body: unknown,
    caching: { cacheControl: string; etag?: string },
    enableCache: boolean,
): void {
    if (!enableCache && caching.etag !== undefined) {
        res.json(body);
        return;
    }
    res.header('Cache-Control', caching.cacheControl);
    if (caching.etag !== undefined) {
        res.header('ETag', caching.etag);
        if (ifNoneMatchHits(req.headers?.['if-none-match'], caching.etag)) {
            res.status(304).send();
            return;
        }
    }
    res.json(body);
}
