// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Global search and the metadata cache" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `getMetaItemCached` moved
 * out of `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolSearchAndCacheFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { FlowRegistration, MetadataCacheRequest, MetadataCacheResponse } from '@objectstack/spec/api';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { simpleHash } from './protocol-version-tokens.js';
import { metadataItemNotFoundError } from './protocol-client-failures.js';
import type { ProtocolHost } from './protocol-host.js';

export class ProtocolSearchAndCacheFacet {
    /** The body of `ObjectStackProtocolImplementation#getMetaItemCached`; the method's docblock there is its contract. */
    static async getMetaItemCached(host: Pick<ProtocolHost, 'getMetaItem'>, request: { type: string, name: string, cacheRequest?: MetadataCacheRequest, locale?: string }): Promise<MetadataCacheResponse & { registration?: FlowRegistration; disabledActions?: string[]; cascadeDeleteObjects?: string[] }> {
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. The ETag
        // and the cache entry are keyed by type, so two spellings would cache
        // the same item twice and invalidate only one of them.
        request = canonicalizeMetaRequestType(request);
        try {
            // Delegate to getMetaItem so the customization-overlay read order
            // (sys_metadata → registry → MetadataService) is honoured here too
            // (ADR-0005). Without this, cached reads silently bypass overlays.
            const result = await host.getMetaItem({
                type: request.type,
                name: request.name,
            });
            const item = (result as any)?.item;
            // [#23316] The automation engine's verdict on a flow, as the
            // delegate read above just resolved it — live, on every call. It
            // rides beside `data` for the REST layer's default door, and is
            // never hashed into the ETag below (see the 304 note there).
            const registration = (result as { registration?: FlowRegistration } | undefined)?.registration;
            // [#27842] …and, for an object, the packaged actions the activation
            // ledger switches off, on exactly those terms: live, beside `data`,
            // never hashed (see the 304 note below).
            const disabledActions = (result as { disabledActions?: string[] } | undefined)?.disabledActions;
            // [#28001] …and the objects a delete of one of its records can
            // cascade into, on the same terms.
            const cascadeDeleteObjects = (result as { cascadeDeleteObjects?: string[] } | undefined)?.cascadeDeleteObjects;

            if (!item) {
                // [#5532] Structured: 404 + the catalog's `RESOURCE_NOT_FOUND`.
                // Reaching here now means a real miss — `getMetaItem` throws
                // 503 rather than answering `undefined` when the store could
                // not be read (see
                // {@link rethrowUnlessMetadataStoreUnprovisioned}) — so the
                // 404 is a claim this layer is finally entitled to make.
                //
                // [#5840] That entitlement was only three-quarters earned when
                // it was written: it held for the `sys_metadata` overlay read,
                // whose failure arrives as a throw, and NOT for the
                // MetadataService read, whose failure `MetadataManager`
                // warn-logs and skips — so a loader outage still reached this
                // line as a plain missing `item` and was answered 404. Both
                // halves now refuse to guess (see
                // {@link readItemFromMetadataService}).
                throw metadataItemNotFoundError(request.type, request.name);
            }

            // Calculate ETag (simple hash of the stringified metadata).
            //
            // The ETag MUST vary by locale. The REST layer translates the
            // response body *after* this validator check, so an ETag computed
            // only from the (untranslated) content would let a language switch
            // match the prior `If-None-Match` and return `304 Not Modified`
            // carrying a stale-locale body — labels/headers stuck in the old
            // language until a hard refresh (issue #1319). Folding the resolved
            // locale into the hash gives each locale a distinct validator.
            //
            // [ADR-0131 D6] No organization is part of the validator: the
            // read is the environment's for every caller, so the document
            // hashed below is the whole scope. An org-less caller's validator
            // is byte-for-byte the one it was issued before.
            //
            // ⛔ The ONE invariant this block depends on: `content` — the bytes
            // actually being sent — is inside the hash below. A 304 is answered
            // only on an exact match over those bytes, so a caller is only ever
            // pinned to the representation IT received. Hashing anything
            // cheaper than the document — a version marker — destroys that
            // silently.
            const content = JSON.stringify(item);
            const scope = [
                request.locale || undefined,
            ].filter((part): part is string => part !== undefined);
            const hash = simpleHash(
                scope.length > 0
                    ? `${scope.join('\u0000')}\u0000${content}`
                    : content,
            );
            const etag = { value: hash, weak: false };

            // Check If-None-Match header
            //
            // [#23316] …except for a read that carries `registration`: the
            // served body holds the engine's verdict and this validator does
            // not (it hashes the document alone, and the verdict stays out of
            // it), so a 304 here would pin the caller to the verdict it was
            // served before — after the engine re-registered or refused the
            // flow under an unchanged body. Such a read is always answered in
            // full; the work is the same either way, since this method always
            // performs the delegate read.
            //
            // [#27842] The same holds for `disabledActions`: an administrator's
            // switch moves no byte of the object document, so a 304 would keep
            // the caller on the switched-off list it was served before.
            // [#28001] So does `cascadeDeleteObjects`: an object registered
            // later that cascades into this one moves no byte of it either.
            if (
                request.cacheRequest?.ifNoneMatch
                && registration === undefined && disabledActions === undefined && cascadeDeleteObjects === undefined
            ) {
                const clientEtag = request.cacheRequest.ifNoneMatch.replace(/^"(.*)"$/, '$1').replace(/^W\/"(.*)"$/, '$1');
                if (clientEtag === hash) {
                    // Return 304 Not Modified
                    return {
                        notModified: true,
                        etag,
                    };
                }
            }

            // Return full metadata with cache headers
            return {
                data: item,
                ...(registration !== undefined ? { registration } : {}),
                ...(disabledActions !== undefined ? { disabledActions } : {}),
                ...(cascadeDeleteObjects !== undefined ? { cascadeDeleteObjects } : {}),
                etag,
                lastModified: new Date().toISOString(),
                cacheControl: {
                    // Metadata is invalidated by publish, so freshness must be
                    // gated by the ETag validator — not a TTL. `no-cache` lets
                    // clients store the body but forces an `If-None-Match`
                    // revalidation on every use: a cheap 304 when unchanged,
                    // fresh fields the instant a publish bumps the ETag. The old
                    // `max-age=3600` pinned the schema for up to an hour, so the
                    // AI-build "New" form kept rendering pre-publish fields until
                    // the TTL lapsed (no revalidation in between). `private` also
                    // keeps per-tenant metadata out of shared CDN/proxy caches.
                    directives: ['private', 'no-cache'],
                },
                notModified: false,
            };
        } catch (error: any) {
            throw error;
        }
    }
}
