// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 35] The environment-wide package uninstall verb, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 * `deletePackage` — its refusals, the row removal, the cleanups and the
 * registry withdrawal.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link PackageUninstallHost} members it reads, plus a `.call`. The `engine`
 * field and the `getServicesRegistry` accessor are handed over as getters,
 * so each read reaches the class field as it stands at call time; each call
 * to another member is a closure, so it still reaches the class method.
 * Every caller keeps calling the class methods.
 *
 * The read-seam census follows both directions of this shape (its
 * `HOST_SPLIT` note in `scripts/check-durability-degradation-log-level.mjs`),
 * so the storage reads below are still counted as the seams they were.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { declaredUserMessage } from '@objectstack/types';
import type { DeletePackageRequest, DeletePackageResponse, ObjectStackProtocolImplementation } from './protocol.js';
import { canonicalMetaType, captureUninstallDeclared, metadataReadFailureError, packagePersistFailureError, remainingRowsPhrase } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface PackageUninstallHost {
    readonly deleteMetaItem: ObjectStackProtocolImplementation['deleteMetaItem'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    readonly packagelessAddress: ObjectStackProtocolImplementation['packagelessAddress'];
    readonly runUninstallCleanups: ObjectStackProtocolImplementation['runUninstallCleanups'];
    readonly shouldDropStorage: ObjectStackProtocolImplementation['shouldDropStorage'];
}

/** The body of `ObjectStackProtocolImplementation#deletePackage`; the method's docblock there is its contract. */
export async function deletePackage(this: Pick<PackageUninstallHost, 'deleteMetaItem' | 'engine' | 'findEnvironmentRows' | 'getServicesRegistry' | 'packagelessAddress' | 'runUninstallCleanups' | 'shouldDropStorage'>, request: DeletePackageRequest): Promise<DeletePackageResponse> {
    // [ADR-0131 D6/D12] An uninstall is environment-wide by construction:
    // every `sys_metadata` row bound to the package, in this environment,
    // whatever organization a legacy row was stored under. The
    // `organizationId` / `allTenants` request keys that once chose between
    // one organization's rows and every organization's (#7780) name
    // nothing now, and retire: a request still carrying either is refused
    // whole, before anything is read, rather than read past — the caller
    // believes the key still scopes something. Who may uninstall is the
    // package door's operator gate, not a request key.
    for (const retired of ['organizationId', 'allTenants'] as const) {
        if (Object.prototype.hasOwnProperty.call(request, retired)) {
            const err = new Error(
                `Refusing to uninstall '${request.packageId}': the '${retired}' request key is retired. `
                + `An uninstall is environment-wide — it removes every row bound to the package in this `
                + `environment — so no organization scope is stated or confirmed. Retry without '${retired}'. `
                + `See docs/adr/0131-total-organization-ownership-no-null-organization-id.md.`
            );
            (err as any).code = 'INVALID_REQUEST';
            (err as any).status = 400;
            throw err;
        }
    }
    const where: Record<string, unknown> = { package_id: request.packageId };
    // [#8136] This read is the uninstall's FIRST database touch, and until
    // now it sat outside every `try` in this method — the per-item `catch`
    // below wraps only the `deleteMetaItem` loop. So a driver failure here
    // propagated whole, out of the protocol and onto the wire: measured as
    // `500 INTERNAL_ERROR / "SQLITE_ERROR: no such table: sys_metadata"`
    // from `DELETE /api/v1/packages/:id`, a physical table name shipped to
    // a client.
    //
    // Declared rather than swallowed: {@link metadataStoreUnavailableError}
    // is this file's EXISTING answer for "a `sys_metadata` read failed" —
    // 503 / `SERVICE_UNAVAILABLE`, a message that quotes nothing, and the
    // driver error carried on `cause` so the operator still gets it whole.
    // Reusing it rather than minting a second sentence for one condition is
    // the point; see its docblock for why the verdict is 503.
    //
    // ⛔ Deliberately NOT routed through {@link
    // rethrowUnlessMetadataStoreUnprovisioned}, which returns normally for
    // `isMissingTableError` and would license the caller to treat the
    // overlay as absent. On a READ that is right — there are genuinely no
    // rows. Here it would turn an unreachable store into `rows = []`, and
    // this method reports that as a completed uninstall that deleted
    // nothing. An outage answered as "there was nothing to remove" is the
    // ADR-0110 D3 confusion in its most damaging direction, on a
    // destructive verb. Every failure stays a failure; only the disclosure
    // changes.
    let rows: any[];
    try {
        // [#21911] The explicit system opt-in — see findServedOverlayRow.
        rows = (await this.findEnvironmentRows('sys_metadata', { where, context: { isSystem: true } })) as any[];
    } catch (e) {
        // [#12536] …through the classifier: a marked application refusal
        // is not a store fault. See {@link metadataReadFailureError}.
        throw metadataReadFailureError(e);
    }

    // [#21276] THE REGISTRY'S UNINSTALL REFUSAL, ASKED BEFORE THE STORE
    // DELETE. `SchemaRegistry` refuses an uninstall when another package
    // `extend`s an object this one owns (ADR-0029), and it decides that
    // before it mutates (#7970). Here that refusal used to be met only at
    // the registry withdrawal below, after the stored row, the metadata rows
    // and the tables were already gone. `assertPackageUninstallable` asks
    // the same predicate (the one copy `unregisterObjectsByPackage` itself
    // calls) without performing the uninstall, so the refusal is thrown
    // here, as is, with nothing removed. The HTTP door answers it through
    // its `catch` around this verb, with the refusal's own `409
    // RESOURCE_CONFLICT`: nothing changed.
    //
    // [#28408, ADR-0146 D3] The same question also refuses a base whose
    // paired customization package (`<base>.custom`) the registry holds,
    // naming the pair, in the same refusal; both causes ride on one throw.
    // It is asked here, before the store delete, for the same reason: a base
    // removed under its pair strands every customization the pair holds.
    //
    // The registry is reached the way the withdrawal below reaches it. A
    // registry that does not carry the method (an engine double, a host on
    // a registry without it) is not asked, and this verb behaves as it did
    // before the method existed: the refusal surfaces at the withdrawal.
    const packageRegistry = (this.engine as any)?.registry;
    if (typeof packageRegistry?.assertPackageUninstallable === 'function') {
        packageRegistry.assertPackageUninstallable(request.packageId);
    }

    // [#23473, ADR-0048] THE SHARED-OBJECT REFUSAL, ALSO ASKED BEFORE THE
    // STORE DELETE. A `sys_metadata` row is keyed by its package, so an
    // object this package holds can also be held by another package's row,
    // or by the package-less row, all served over the ONE table its name
    // maps to. The per-item delete below drops an object's table only with
    // its last stored row and otherwise refuses `409`
    // ({@link dropStorageRemainingRowsRefusal}). Met there, that refusal
    // came after the stored package row was gone, so it left the package
    // half-uninstalled: no `sys_packages` row, and its row of the shared
    // object still stored and served.
    //
    // So the same question is asked here, of the same rows, before anything
    // durable: for each active object row whose table this uninstall would
    // drop ({@link shouldDropStorage}), the per-item delete's own address
    // read ({@link packagelessAddress}, the type folded as that delete
    // folds it). An object this package holds there beside any other row
    // refuses the whole uninstall, with nothing removed, as step 3 does
    // for an extended object. ⛔ Not "uninstall and keep the shared table":
    // dropping the tables is this verb's declared default, and an
    // uninstall that quietly drops fewer than it says is an opt-in the
    // runtime does not honour.
    //
    // With `keepData: true` no table is dropped, so sharing decides
    // nothing and nothing is read. `RESOURCE_CONFLICT` / 409, no code
    // minted: the per-item refusal's code for the same rows (environment
    // state, not the request: the same uninstall is accepted once the other
    // rows, or this package's row, are gone). A failed read is this verb's
    // step-2 read failure ({@link metadataReadFailureError}), never "not
    // shared". The prescription first: a 4xx message can be truncated.
    if (request.keepData !== true) {
        const shared: string[] = [];
        const asked = new Set<string>();
        for (const row of rows) {
            if (row?.state === 'draft' || typeof row?.name !== 'string') continue;
            const canonical = canonicalMetaType(String(row.type));
            const type = PLURAL_TO_SINGULAR[canonical] ?? canonical;
            if (!this.shouldDropStorage(type, row.name, true, 'active') || asked.has(row.name)) continue;
            asked.add(row.name);
            let at: { candidates: readonly string[]; unbound: boolean };
            try {
                at = await this.packagelessAddress(type, row.name, undefined, 'active');
            } catch (e) {
                throw metadataReadFailureError(e);
            }
            if (!at.candidates.includes(request.packageId)) continue;
            const others = at.candidates.filter((id) => id !== request.packageId);
            if (others.length === 0 && !at.unbound) continue;
            shared.push(`'${row.name}' (${remainingRowsPhrase(others, at.unbound, 'row')})`);
        }
        if (shared.length > 0) {
            const more = shared.length > 5 ? `; and ${shared.length - 5} more` : '';
            const err = new Error(
                `Uninstall package '${request.packageId}' with keepData (?keepData=true; keepData: true in `
                + 'process), which keeps all its object tables, or first delete, without dropStorage, its row '
                + 'or the other rows of each object below (DELETE /api/v1/meta/object/NAME?package=ID). '
                + "Nothing was removed: an uninstall drops an object's table only with the object's last row, and "
                + (shared.length === 1
                    ? 'an object of this package is'
                    : `${shared.length} objects of this package are`)
                + ` also held by other rows: ${shared.slice(0, 5).join('; ')}${more}.`,
            ) as Error & { code: 'RESOURCE_CONFLICT'; status: 409 };
            err.code = 'RESOURCE_CONFLICT';
            err.status = 409;
            throw err;
        }
    }

    // [#21276] THE STORE DELETE COMES FIRST, and its refusal is this verb's
    // refusal. Triage's ruling: refuse before withdrawing, not undo. Every
    // step above this one only reads; every step below it — the per-item
    // `sys_metadata` deletes and table teardown, the registry withdrawal,
    // the uninstall cleanups — runs only after the store has deleted the
    // package's row.
    //
    // #2532's reason for deleting the row at all still holds:
    // `PackageServicePlugin.start()` hydrates `sys_packages` back into the
    // registry at boot, so a row left behind brings the package back on the
    // next restart. This delete used to run AFTER the metadata deletes and
    // inside a `catch` that turned both of the service's failure channels
    // into a `console.warn` ("sys_packages cleanup skipped"): a returned
    // `{ success: false }` was never read, and a thrown failure was only
    // logged. So a refused delete answered success over a package whose
    // metadata, tables and grants were already gone, and the next boot
    // brought it back. Measured at `DELETE /api/v1/packages/:id` on SQLite,
    // with a trigger refusing the delete: 200, then 404 in the same process,
    // then 200 after a restart.
    //
    // Both channels (`PackageDeleteResult`, `service-package`) answer
    // through {@link packagePersistFailureError}, the error install and
    // edit throw for a refused store write (#21243): a declared 4xx leaves
    // as the producer answered it; anything else is a 500 that quotes
    // nothing, with the original on `cause`.
    //
    // ⛔ No undo: nothing durable has happened yet, so there is nothing to
    // put back. Without a `package` service there is no stored row to
    // delete (the install's in-memory-only path), and this step is skipped.
    const packageStore = this.getServicesRegistry?.()?.get('package') as
        | { delete?: (id: string) => Promise<unknown> }
        | undefined;
    if (typeof packageStore?.delete === 'function') {
        let refusal: { cause: unknown } | undefined;
        try {
            const out = await packageStore.delete(request.packageId);
            if (typeof out === 'object' && out !== null && (out as { success?: unknown }).success === false) {
                refusal = { cause: out };
            }
        } catch (cause) {
            refusal = { cause };
        }
        if (refusal) throw packagePersistFailureError(refusal.cause, request.packageId, 'delete');
    }

    const dropStorage = request.keepData !== true;
    // Delete drafts before active so an object's table is dropped once (on
    // the active delete), not pre-empted by a draft delete.
    const ordered = [...rows].sort((a, b) => (a.state === 'draft' ? 0 : 1) - (b.state === 'draft' ? 0 : 1));

    const deleted: Array<{ type: string; name: string; state: string }> = [];
    const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

    for (const row of ordered) {
        const state: 'active' | 'draft' = row.state === 'draft' ? 'draft' : 'active';
        try {
            await this.deleteMetaItem({
                type: row.type,
                name: row.name,
                state,
                // [#23165, ADR-0048] The package being uninstalled
                // owns this row, so the delete names it. Named no
                // package, the delete of a name a second package also
                // holds was a driver-order pick between the two rows
                // (and is now refused).
                packageId: request.packageId,
                ...(request.actor ? { actor: request.actor } : {}),
                ...(dropStorage ? { dropStorage: true } : {}),
            });
            deleted.push({ type: row.type, name: row.name, state });
        } catch (e: any) {
            // [#8136] NO filter here, deliberately, and this comment is why
            // the absence is a decision rather than an oversight.
            //
            // This `try` wraps exactly one call, and every exit
            // `deleteMetaItem` has is now either a refusal it DECLARED
            // (its two-tier authorization block and `assertLockAllowsDelete`
            // — 4xx with a catalogued code) or one of its two re-wraps,
            // which withhold at the source via {@link
            // overlayDeleteFailureMessage}. Its one engine touch outside
            // its own `try`, `getEffectiveLock`, has been fail-closed
            // through `rethrowUnlessMetadataStoreUnprovisioned` since
            // #5706, so that arrives as the non-quoting 503 too.
            //
            // So `failed[].error` — which rides onto the
            // `PACKAGE_DELETE_PARTIAL` 400 inside `details`, out of reach
            // of any boundary's message withhold — is clean BECAUSE the
            // producer is, which is the whole shape of this fix. Adding a
            // second filter here would be consumer-side tolerance over a
            // producer that no longer needs it (Prime Directive #12), and
            // it would blank the per-item refusals that make a partial
            // uninstall actionable.
            // [#12536] …and the per-item path follows the SAME
            // classification the read seam now applies (maintainer ruling,
            // 2026-08-27): a marked application refusal is reported as one,
            // in the author's own words, rather than dissolving into a row
            // that reads like a store failure. `failed[]` had no channel
            // for the mark at all — `error` is the diagnostic sentence and
            // `code` is the closed vocabulary — so `userMessage` is the
            // member that carries it, absent (never `''`) when the item's
            // failure declared none, so nothing invents a marked refusal.
            const itemUserMessage = declaredUserMessage(e);
            failed.push({
                type: row.type,
                name: row.name,
                error: e?.message ?? 'delete failed',
                ...(e?.code ? { code: e.code } : {}),
                ...(itemUserMessage !== undefined ? { userMessage: itemUserMessage } : {}),
            });
        }
    }

    // [#2747] Unregister from the in-memory SchemaRegistry too, so the
    // running kernel stops serving the package without waiting for a
    // restart. [#21276] The HTTP door no longer unregisters before calling
    // this verb; it withdraws only after this verb has answered, and skips
    // that when this step already did it.
    //
    // [#21276] The registry's own refusal (ADR-0029 extenders) was asked
    // before the store delete, through `assertPackageUninstallable`, so it
    // does not arrive here. The `catch` stays as a safety net for a
    // registry that lacks that method, or a throw nothing asked ahead of
    // time: it is logged, not fatal, because the durable row is already
    // gone and the next boot is clean either way.
    //
    // [ADR-0090 D5] What the package declared is captured first: the
    // withdrawal releases its names, and the cleanups below revoke the
    // grants that name them.
    const declared = captureUninstallDeclared((this.engine as any)?.registry, request.packageId, rows);
    try {
        (this.engine as any)?.registry?.uninstallPackage?.(request.packageId);
    } catch (e) {
        console.warn(
            `[protocol.deletePackage] registry unregistration skipped for '${request.packageId}': ${(e as Error)?.message}`,
        );
    }

    // [#2747] Data-plane cleanups registered by domain plugins (mirror of
    // the publish materializers): revoke what the package's metadata
    // granted — e.g. plugin-security revokes every grant naming a set the
    // package declared. Best-effort per cleanup;
    // outcomes ride on the response so a failed revocation (ghost grants —
    // a security condition) is visible to the caller, never silent.
    // [#21490] Through the registry's one runner, which install-local's
    // uninstall door calls too.
    const cleanups = await this.runUninstallCleanups({ ...request, ...(declared ? { declared } : {}) });

    return {
        success: failed.length === 0 && deleted.length > 0,
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed,
        cleanups,
    };
}
