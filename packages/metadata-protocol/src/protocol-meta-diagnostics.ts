// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 2] The metadata diagnostics sweep of
 * `ObjectStackProtocolImplementation` — `getMetaDiagnostics`, which sweeps the
 * metadata types a caller asks about, reports the entries that fail spec
 * validation and the per-type stats beside them (`GET /api/v1/meta/diagnostics`)
 * — moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, the same
 * findings, the same counts.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock, signature and position — and its body is one literal of exactly
 * the {@link MetaDiagnosticsHost} members it reads, plus a `.call`. The method
 * is no longer `async`: it returns the moved function's own promise, so a
 * caller awaits the same promise the body settles, with no extra wrapper. Each
 * member is handed over as a closure that calls it on the protocol at call
 * time, so a test double or spy set on the instance is still the one the body
 * reaches.
 *
 * The one module-level declaration the body reads, `ShippingPackages`, stays in
 * `protocol.ts`, where code that did not move reads it too, and is imported
 * from there as a type. `index.ts` names what it publishes from `protocol.ts`
 * one by one, so the `export` it gained for this keeps it off the published
 * surface, and nothing re-exports this module, so the published surface does
 * not move.
 */

import type { ObjectStackProtocolImplementation, ShippingPackages } from './protocol.js';
import { resolveItemLock } from './item-lock.js';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { computeMetadataDiagnostics } from './metadata-diagnostics.js';
import type { MetadataDiagnostics } from './metadata-diagnostics.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; its `this` is the `Pick` of them. Each is
 * typed AS the class member (an indexed access on the class), so a change to a
 * member's signature on the class is a change here too, and naming a member
 * the class does not have is a compile error.
 */
export interface MetaDiagnosticsHost {
    artifactLockLayerAt: ObjectStackProtocolImplementation['artifactLockLayerAt'];
    getMetaItems: ObjectStackProtocolImplementation['getMetaItems'];
    isArtifactBacked: ObjectStackProtocolImplementation['isArtifactBacked'];
    servedLockState: ObjectStackProtocolImplementation['servedLockState'];
    shippingPackagesOf: ObjectStackProtocolImplementation['shippingPackagesOf'];
}

/** The body of `ObjectStackProtocolImplementation#getMetaDiagnostics`; the method's docblock there is its contract. */
export async function getMetaDiagnostics(
    this: Pick<MetaDiagnosticsHost, 'artifactLockLayerAt' | 'getMetaItems' | 'isArtifactBacked' | 'servedLockState' | 'shippingPackagesOf'>,
    request: {
    type?: string;
    severity?: 'error' | 'warning';
    packageId?: string;
} = {}): Promise<{
    entries: Array<{ type: string; name: string; diagnostics: MetadataDiagnostics }>;
    total: number;
    scannedTypes: number;
    scannedItems: number;
    /**
     * Per-type aggregate stats — count of items and the list of
     * packages contributing to each type. Computed in the same
     * sweep so the Studio directory page can render tile counts
     * and a package filter in one round-trip. `locked` is the number
     * of items whose read envelope reports `lock` other than `'none'`
     * — the same derivation `getMetaItem` publishes (#21694).
     */
    stats: Record<string, { count: number; locked: number; packages: string[] }>;
}> {
    const includeWarnings = request.severity === 'warning';
    // [#27514] A named type is swept, and keyed in `stats` and `entries`, under
    // its CANONICAL spelling: the fold `canonicalMetaType` applies at every
    // `/meta` entry point. `getMetaItems` already listed `views` as `view`, but
    // the answer was keyed by the raw alias, so a consumer reading `stats.view`
    // missed an alias request's counts. A spelling the fold does not map
    // (`viewes`, `fieldz`) comes back unchanged, so the [#8924] refusal below
    // still sees what the caller wrote.
    const targetTypes = request.type
        ? [canonicalMetaUrlType(request.type)]
        : DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => getMetadataTypeSchema(e.type))
            .map((e) => e.type);

    const entries: Array<{ type: string; name: string; diagnostics: MetadataDiagnostics }> = [];
    const stats: Record<string, { count: number; locked: number; packages: string[] }> = {};
    let scannedItems = 0;

    for (const t of targetTypes) {
        let listed: any;
        try {
            listed = await this.getMetaItems({
                type: t,
                packageId: request.packageId,
            } as any);
        } catch (error) {
            // [#8855] TWO different failures used to leave through this
            // `continue`, and only one of them is benign.
            //
            // BENIGN, and the reason the comment named — it is real, which
            // is why this `catch` is narrowed rather than deleted: the type
            // is not listable in THIS kernel scope. Skipping it is the
            // truth, and a scope that cannot enumerate one type must not
            // fail the whole governance sweep.
            //
            // NOT BENIGN: the read already ran the platform's single
            // discrimination — `getMetaItems` classifies by error TYPE
            // through {@link rethrowUnlessMetadataStoreUnprovisioned},
            // returns normally for the one benign driver reason
            // (`isMissingTableError`: `sys_metadata` not provisioned yet,
            // so `items: []` IS the truth), and throws
            // {@link metadataStoreUnavailableError} — a 503 — for every
            // other read failure. That 503 says "whether rows exist is
            // UNKNOWN". Swallowing it here put the emptiness straight back
            // one layer up, and then published it as a NUMBER:
            //
            //   * `stats[t]` was never written, so the type is ABSENT from
            //     the response — not zero, absent — byte-shaped like an
            //     environment that declares none of it, and the Studio
            //     directory tile the field exists to feed simply loses it;
            //   * `total` counts entries that FAILED validation, and a
            //     store nobody can read contributes none — so a diagnostics
            //     endpoint whose whole job is reporting problems answered
            //     `0 problems` precisely when it could not read anything.
            //
            // ADR-0110 D3 is the rule: a miss and an outage are different
            // facts with opposite dispositions ("nothing to fix" vs "the
            // backend is down, retry"), and a consumer must never read one
            // as the other. #5108 restored it in `DatabaseLoader`, #5532 in
            // `getMetaItems` itself — this is the same rule one layer up,
            // on the consumer that turns the read into a published count.
            //
            // Classification is by the envelope the PRODUCER already built,
            // not by a second reading of the driver error. Re-running
            // `isMissingTableError` / `rethrowUnlessMetadataStoreUnprovisioned`
            // on what arrives here would re-wrap an already-shaped 503 in
            // another one and displace the driver error riding as `cause` —
            // the object `logWithheldServerFault` prints for the operator
            // (#5437). The original is rethrown UNCHANGED, so the envelope
            // that reaches the REST boundary is the one #5532 shaped.
            //
            // The test is `status === 503` rather than the narrower
            // `code === 'SERVICE_UNAVAILABLE'` on purpose, and in the
            // direction `rethrowUnlessMetadataStoreUnprovisioned`'s own doc
            // argues: a false "benign" silently mis-answers a question
            // nobody can re-ask, while a false "real" costs one 503 the
            // caller can retry.
            if ((error as { status?: unknown } | null | undefined)?.status === 503) throw error;
            // [#8924] TWO error classes leave through this catch — the 503
            // above and the 400 below — under ONE rule: an error the
            // producer already stamped with a status is a CLASSIFIED
            // VERDICT, and this sweep may not overrule a verdict into
            // silence. Everything else is a genuine listing failure nobody
            // classified, and for those the benign skip below is the ruled
            // disposition (maintainer, 2026-08-20, option 1).
            //
            //  * 503 (#8855, above): the store outage — "whether rows
            //    exist is UNKNOWN". Swallowing it published an outage as
            //    "0 problems".
            //  * 400 (#8924, here): the request-classification refusal
            //    `canonicalizeMetaRequestType` raises INSIDE `getMetaItems`
            //    (`status: 400`, `code: 'INVALID_REQUEST'`) for an
            //    unrecognised spelling of a DECLARED type (`fieldes`,
            //    `viewes`, `capabilitys`, …). Only the `request.type` arm
            //    can produce it — the full-sweep arm's `targetTypes` come
            //    canonical out of the registry — so rethrowing it cannot
            //    fail a whole-corpus sweep. Swallowing it answered
            //    `200 {"scannedTypes":1,"stats":{}}` — "scanned 1 type,
            //    no issues" — to a spelling every sibling `/meta` door
            //    refuses with a 400 that names both accepted spellings
            //    (measured: 27 such spellings on a booted kernel, while
            //    objectui's DiagnosticsPage paints that payload as "All
            //    clear"). The producer classified the caller's mistake;
            //    the caller gets to hear it. Declared = enforced.
            //
            // What still takes the `continue`: a listing failure with no
            // status, or any status that is not one of the two verdicts
            // above (the registry listing is not a guarded read, so its
            // failures arrive unclassified). That skip is genuine — a
            // kernel scope that cannot enumerate one type must not fail
            // the whole governance sweep — and measured to have NO
            // producer in kernel scope today (six booted scopes, zero
            // skips), which is exactly why it stays a guard rather than
            // becoming a payload field (`skippedTypes` was considered and
            // ruled out as motiveless).
            //
            // By `status` and not by `code`, mirroring the 503 test above
            // and its direction argument: a false "real" is loud and
            // correctable at the caller; a false "benign" silently
            // mis-answers a question nobody re-asks.
            if ((error as { status?: unknown } | null | undefined)?.status === 400) throw error;
            continue;
        }
        const items: any[] = Array.isArray(listed?.items)
            ? listed.items
            : Array.isArray(listed)
                ? listed
                : [];
        const pkgSet = new Set<string>();
        let lockedCount = 0;
        let shipping: ShippingPackages | undefined;
        for (const item of items) {
            scannedItems += 1;
            const pkg = (item?._packageId ?? null) as string | null;
            if (pkg) pkgSet.add(pkg);
            // [#21694] Counted from the envelope's own derivation
            // ({@link servedLockState}), never from the declared `_lock`
            // alone: a packaged base the write doors refuse reads locked on
            // its item envelope, so the per-type tile counts it too. The
            // derivation reads the registry only — no store read per item.
            // [#21738] Its lock is the one item-lock resolution
            // ({@link resolveItemLock}) over the item's artifact layer —
            // [#21803] every installed package that ships the name, from
            // the address the list's own merge used (ADR-0048 package
            // scope) — and the document the list serves for it.
            const itemName = typeof item?.name === 'string' ? item.name : '';
            shipping ??= this.shippingPackagesOf(t);
            const itemLock = resolveItemLock({
                artifact: this.artifactLockLayerAt({
                    type: t,
                    name: itemName,
                    packageId: request.packageId ?? (item?._packageId as string | undefined),
                }, shipping),
                overlay: item,
            });
            const served = this.servedLockState(t, itemName, item, this.isArtifactBacked(t, itemName), itemLock);
            if (served.lock !== 'none') lockedCount += 1;
            const diag: MetadataDiagnostics | undefined =
                item?._diagnostics ?? computeMetadataDiagnostics(t, item);
            if (!diag) continue;
            if (diag.valid && !includeWarnings) continue;
            if (diag.valid && includeWarnings && !diag.warnings?.length) continue;
            entries.push({
                type: t,
                name: typeof item?.name === 'string' ? item.name : '<unknown>',
                diagnostics: diag,
            });
        }
        stats[t] = { count: items.length, locked: lockedCount, packages: [...pkgSet].sort() };
    }

    // [#27514] A package that is not installed, and that no swept item is bound
    // to, scoped the sweep to nothing: every type answered `count: 0` and the
    // whole answer read as a clean package. Refused instead, with the [#8924]
    // refusal's status and code. Both halves are read, in this order: an item
    // bound to the package is proof enough (rows of an uninstalled package are
    // real, and this sweep is how an author finds them), and only an empty
    // sweep asks the installed-package listing (`getMetaItems` of type
    // `package`, the registry's records). An installed package with no items
    // still answers its honest zeros. Fails OPEN: a listing that cannot be read
    // keeps the answer, because "no such package" is an existence claim and an
    // unreadable authority cannot make it.
    if (request.packageId !== undefined && scannedItems === 0
        && !(await packageIsInstalled(this, request.packageId))) {
        const err = new Error(
            `'${request.packageId}' is not an installed package, and no metadata item is bound to it, so a sweep `
            + `scoped to it would report a clean package that does not exist. GET /api/v1/packages lists the `
            + `installed packages; omit package (or pass package=all) to sweep every package.`,
        );
        (err as any).code = 'INVALID_REQUEST';
        (err as any).status = 400;
        throw err;
    }

    return {
        entries,
        total: entries.length,
        scannedTypes: targetTypes.length,
        scannedItems,
        stats,
    };
}

/**
 * [#27514] Does the installed-package listing carry this id? `true` ("cannot
 * disprove, so do not refuse") when the listing cannot be read at all.
 */
async function packageIsInstalled(host: Pick<MetaDiagnosticsHost, 'getMetaItems'>, packageId: string): Promise<boolean> {
    let listed: unknown;
    try {
        listed = await host.getMetaItems({ type: 'package' });
    } catch {
        return true;
    }
    const items = (listed as { items?: unknown } | null | undefined)?.items;
    if (!Array.isArray(items)) return true;
    return items.some((record) => {
        const r = record as { manifest?: { id?: unknown }; id?: unknown } | null | undefined;
        return (r?.manifest?.id ?? r?.id) === packageId;
    });
}
