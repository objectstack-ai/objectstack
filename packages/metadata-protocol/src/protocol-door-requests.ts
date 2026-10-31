// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the request
// shapes of the four single-item doors (save, publish, rollback, delete).
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import { type MetadataAuthoringClient, type MetadataAuthoringSurface } from '@objectstack/spec/api';
import type { MetadataWriteFace } from './protocol-write-face.js';

/*
 * [#28355] The request shapes of the four single-item doors. Each door is a
 * public wrapper (refusal audit) over a private body, and both read the shape
 * from here: a private member's type is not published, so a wrapper typed off
 * its body would publish an untyped `request`. Deliberately not exported — the
 * published signatures are what they were, under these local names.
 */

/** The request of {@link ObjectStackProtocolImplementation.saveMetaItem}. */
type SaveMetaItemRequest = { type: string, name: string, item?: any, parentVersion?: string | null, storedParentVersion?: string | null, actor?: string, force?: boolean, mode?: 'draft' | 'publish', packageId?: string | null, source?: string, writeFace?: MetadataWriteFace, surface?: MetadataAuthoringSurface, client?: MetadataAuthoringClient };

/** The request of {@link ObjectStackProtocolImplementation.publishMetaItem}. */
type PublishMetaItemRequest = {
    type: string;
    name: string;
    actor?: string;
    message?: string;
    /**
     * [commit 490879ad0] ADR-0048 — the software package the draft being promoted was
     * listed under, when the caller has one to state. Forwarded whole to
     * {@link promoteDraftForPublish}, which threads it into BOTH the #9612
     * gate closure and `repo.promoteDraft`, so the gate and the write
     * resolve the draft under the SAME key it was listed by.
     *
     * Declared because it is REAL on this door, not merely tolerated:
     * since commit 9e04c3e35 `POST /meta/:type/:name/publish?package=PKG_ID` states it
     * on every HTTP-driven promotion that names a package — which is
     * Studio's designer save-then-publish loop. Until it was declared the
     * value flowed correctly but was invisible to every typed caller, and
     * the only caller that states one reaches this method through a cast,
     * so the binding was enforced by nothing. Commit 490879ad0 added the pins in
     * `protocol-publish-drafts-package-scope.test.ts`.
     *
     * ⚠️ `null` is NOT the same as absent, and the difference is load
     * bearing the whole way down: {@link promoteDraftForPublish} branches on
     * the KEY BEING PRESENT (`'packageId' in request`), so an ABSENT key
     * names no package while `null` pins the lookup to the UNBOUND row.
     * [#23495] Naming no package is no longer "match any package": the
     * publish promotes the draft a draft save naming no package writes
     * ({@link packagelessDraftAddress}), and is refused `409
     * RESOURCE_CONFLICT` when the item's active rows are bound to two or
     * more packages. Spread it in conditionally; never write
     * `packageId: maybeUndefined`, which arrives as a present-and-undefined
     * key, coerces to `null` downstream, and makes a package-bound draft
     * unfindable — a silent `no_draft` on the untouched path.
     */
    packageId?: string | null;
    // [commit 490879ad0] `environmentId` is deliberately NOT declared here, although
    // the REST door spreads it into this very request literal. It is the
    // multi-kernel ROUTING key, and it is out of the protocol request shape
    // by explicit maintainer ruling (recorded 2026-08-18, landed as commit 2a29caa53):
    // `resolveProtocol(environmentId)` has already selected the target
    // kernel before this method is entered, and this class reads its
    // environment off the INSTANCE (`this.environmentId`, set at
    // construction) and never off a request — measured, `request.environmentId`
    // occurs nowhere in this file. `packages/rest` declares that one
    // transport-level member on top of the declared shape instead
    // (`TransportScopedMetaRequest`), which is where a routing key belongs.
    // Adding it here would reverse that ruling rather than record it.
    /**
     * INTERNAL — `publishPackageDrafts` publishes many drafts and batch-applies
     * every seed body in ONE loader pass afterwards (cross-seed references need
     * multi-pass over the whole set), so it suppresses the per-item apply here.
     */
    _skipSeedApply?: boolean;
    /** [#22877] The bundle member whose draft to publish — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
    member?: string;
};

/** The request of {@link ObjectStackProtocolImplementation.rollbackMetaItem}. */
type RollbackMetaItemRequest = {
    type: string;
    name: string;
    toVersion: number;
    actor?: string;
    message?: string;
    /**
     * [#22877] The bundle member to revert — {@link resolveBundleMemberSelector};
     * omitted, the canonical one. The bundle shares one lineage counter, so
     * a version of ANOTHER member answers 404 `VERSION_NOT_FOUND`.
     */
    member?: string;
};

/** The request of {@link ObjectStackProtocolImplementation.deleteMetaItem}. */
type DeleteMetaItemRequest = {
    type: string;
    name: string;
    parentVersion?: string | null;
    actor?: string;
    state?: 'active' | 'draft';
    /**
     * When true, also drop the object's physical table after the metadata
     * is removed (object + active only; never `sys_`). Default false keeps
     * delete non-destructive to data. Used by the "discard a previewed
     * object" flow so a publish-to-preview leaves no orphan table.
     * [#23415] Only with the object's last stored row: while another row
     * of it stays stored, the delete is refused `409 RESOURCE_CONFLICT`
     * ({@link dropStorageRemainingRowsRefusal}).
     */
    dropStorage?: boolean;
    /** [#22877] The bundle member to reset — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
    member?: string;
    /**
     * [#23165, ADR-0048] The package whose row this delete removes, as a
     * save names the row it writes (`?package=` on the REST door). Named,
     * the delete removes that package's row and no other. Absent or `null`
     * names no package: the delete removes the row of the one package the
     * item's rows at its state are bound to, is refused `409
     * RESOURCE_CONFLICT` when they are bound to two or more, and with none
     * removes the package-unbound row ({@link packagelessAddress}).
     * [#23495] A draft discard naming none removes the draft a draft save
     * naming none writes ({@link packagelessDraftAddress}), the one the
     * per-item publish naming none promotes.
     */
    packageId?: string | null;
};

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export type { DeleteMetaItemRequest, PublishMetaItemRequest, RollbackMetaItemRequest, SaveMetaItemRequest };
