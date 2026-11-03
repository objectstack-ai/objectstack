// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the publish
// materializer, uninstall cleanup and delete-package request and response contracts.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.

/**
 * Result of projecting a published metadata body into its data-plane
 * representation. `success:false` with an `error` is the surfaced-not-thrown
 * failure contract — publishing the metadata itself always succeeds.
 */
export interface PublishMaterializeResult {
    success: boolean;
    inserted: number;
    updated: number;
    error?: string;
}

/**
 * Publish-time materializer (ADR-0086 P2). Receives the just-published body
 * plus the draft's package binding and org scope. Registered per metadata type
 * via {@link ObjectStackProtocolImplementation.registerPublishMaterializer}.
 */
export type PublishMaterializer = (args: {
    body: unknown;
    packageId: string | null;
    organizationId: string | null;
    actor: string;
}) => Promise<PublishMaterializeResult>;

/**
 * Uninstall-time data-plane cleanup (ADR-0086 D3, #2747). The exact mirror of
 * {@link PublishMaterializer}: domain plugins own data-plane tables the
 * protocol layer must not know the shape of (e.g. plugin-security's grant
 * table, `sys_user_permission_set`), so they register a named
 * cleanup here and {@link ObjectStackProtocolImplementation.deletePackage}
 * invokes every cleanup with the uninstalled package id. Cleanups run
 * best-effort — a failure is REPORTED on the uninstall response (`cleanups`),
 * never thrown — but ghost grants are a security condition, so callers must
 * surface a failed cleanup, not swallow it.
 */
export type UninstallCleanup = (args: {
    packageId: string;
    actor?: string;
    /**
     * What the package declared, read from the registry just before the door
     * withdrew it ({@link captureUninstallDeclared}). Optional: absent when the
     * registry did not hold the package or cannot answer, and a cleanup that
     * does not read it behaves as before.
     */
    declared?: UninstallDeclared;
}) => Promise<{ success: boolean; removed: number; error?: string }>;

/**
 * [ADR-0090 D5, ADR-0131 D4] The security-catalog names an uninstalled package
 * held. A grant names its set, and the package's sets are served from the
 * registry, not stored, so after the withdrawal nothing else knows them.
 */
export interface UninstallDeclared {
    /** The permission-set names the package held. */
    permission?: string[];
}

/**
 * Capture what `packageId` declared, for {@link UninstallCleanup}'s `declared`
 * — the ONE capture both uninstall doors (`deletePackage` and install-local's
 * `DELETE`) call, at the same point: after the uninstall is decided and just
 * BEFORE `registry.uninstallPackage`, which releases the names. The withdrawal
 * still precedes the cleanups (#21576); only what they are handed grows.
 *
 * Two sources, unioned: the names the registry says the package holds (an
 * installed package's claims and item slots), and the `permission` rows of the
 * package's `sys_metadata` the door already read (`stored`). The second is
 * what names a writable base's sets (ADR-0070): an item authored into a base
 * is stored, and the registry holds it in the bare slot with no `_packageId`
 * (provenance `org`, measured), so the registry alone cannot attribute it to
 * the base.
 *
 * `undefined` when neither source names a set — so a package that declared
 * none hands its cleanups exactly the request they had before.
 */
export function captureUninstallDeclared(
    registry: unknown,
    packageId: string,
    stored?: ReadonlyArray<{ type?: unknown; name?: unknown } | null | undefined>,
): UninstallDeclared | undefined {
    const names = new Set<string>();
    const held = (registry as { securityCatalogNamesHeldBy?: (id: string, type: 'permission') => unknown } | null | undefined)
        ?.securityCatalogNamesHeldBy;
    if (typeof held === 'function') {
        try {
            const fromRegistry = held.call(registry, packageId, 'permission');
            if (Array.isArray(fromRegistry)) {
                for (const n of fromRegistry) if (typeof n === 'string' && n !== '') names.add(n);
            }
        } catch { /* the registry could not say; the stored rows still can */ }
    }
    if (stored) {
        for (const row of stored) {
            const type = row?.type;
            if ((type === 'permission' || type === 'permissions') && typeof row?.name === 'string' && row.name !== '') names.add(row.name);
        }
    }
    return names.size > 0 ? { permission: [...names] } : undefined;
}

/** Per-cleanup outcome reported on the `deletePackage` response. */
export interface UninstallCleanupOutcome {
    name: string;
    success: boolean;
    removed: number;
    error?: string;
    /**
     * [#12536] The user-facing refusal text the failing cleanup MARKED with
     * `userMessage` (commit 79c46da90) — absent unless it declared one. This outcome is
     * response DATA riding inside a `PACKAGE_DELETE_PARTIAL` 400's `details`,
     * so no HTTP boundary reads a `userMessage` on its behalf; the channel has
     * to exist here or the mark has nowhere to go. Read it with
     * `declaredUserMessage`, never by probing the field.
     */
    userMessage?: string;
}

/**
 * [#9960] The declared REQUEST shape of
 * {@link ObjectStackProtocolImplementation.deletePackage} — the ONE statement
 * of this verb's contract, imported by every seam that speaks it.
 *
 * WHY IT IS NAMED. `deletePackage` has no `packages/spec` declaration (it is
 * absent from `PackageProtocol`), and until this type existed its shape was
 * stated THREE times, differently, by the three modules that share the seam:
 * an inline structural type on the method below; a narrower restatement on
 * `PackageRoutesOptions.protocol.deletePackage` in `@objectstack/rest`, which
 * named neither `organizationId` nor `keepData`; and no type at all in the
 * dispatcher twin (`packages/runtime/src/domains/packages.ts`), which reached
 * the verb through `(protocol as any)` and routinely sent exactly the two keys
 * the REST restatement could not express. Naming the shape once, HERE at the
 * producer, is what makes the other two seams compile-checked against the
 * contract instead of each against its own copy.
 *
 * ⛔ Deliberately NOT declared in `packages/spec`: minting protocol surface for
 * a verb with zero external consumers is declare-and-maintain the platform has
 * not asked for. Should an external consumer ever appear, the spec declaration
 * is its own card for the spec seat, not a rider on a typing convergence.
 *
 * [ADR-0131 D6/D12] No organization member: an uninstall is environment-wide
 * by construction. The `organizationId` and `allTenants` keys that once chose
 * its blast radius (#7780) are retired, and `deletePackage` refuses a request
 * still carrying either (`INVALID_REQUEST`, 400).
 */
export interface DeletePackageRequest {
    packageId: string;
    actor?: string;
    /** Remove the metadata but PRESERVE each object's physical table. */
    keepData?: boolean;
}

/**
 * [#9960] The declared RESPONSE shape of
 * {@link ObjectStackProtocolImplementation.deletePackage}, stated once for the
 * same reason as {@link DeletePackageRequest}.
 *
 * `deleted` is part of it. The REST seam's restatement omitted that member
 * entirely, so a caller reading the option's type was told this verb reports
 * only a COUNT of what it removed — while the producer has always returned the
 * per-item list beside it.
 */
export interface DeletePackageResponse {
    success: boolean;
    deletedCount: number;
    failedCount: number;
    deleted: Array<{ type: string; name: string; state: string }>;
    /**
     * Per-item failures. [#12536] `userMessage` is the mark (commit 79c46da90) the item's
     * own failure declared — present exactly when a producer marked its
     * refusal, so a caller can tell an application refusal apart from a store
     * failure on a path where no HTTP boundary can do it for them.
     */
    failed: Array<{ type: string; name: string; error: string; code?: string; userMessage?: string }>;
    cleanups: UninstallCleanupOutcome[];
}
