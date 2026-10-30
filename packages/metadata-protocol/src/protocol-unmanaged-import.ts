// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 35] Two halves of the unmanaged import (ADR-0131 D6), from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 *
 *  - `unmanagedImportCollisions` — the names the import would take that
 *    something already holds;
 *  - `rollBackUnmanagedImport` — undoing a failed import.
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
 * the {@link UnmanagedImportHost} members it reads, plus a `.call`. Each call to
 * another member is a closure, so it still reaches the class method.
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
import type { ObjectStackProtocolImplementation } from './protocol.js';
import { clientFacingFailureText } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface UnmanagedImportHost {
    readonly deletePackage: ObjectStackProtocolImplementation['deletePackage'];
    readonly findEnvironmentRows: ObjectStackProtocolImplementation['findEnvironmentRows'];
    readonly isArtifactBacked: ObjectStackProtocolImplementation['isArtifactBacked'];
    readonly rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
}

/** The body of `ObjectStackProtocolImplementation#unmanagedImportCollisions`; the method's docblock there is its contract. */
export async function unmanagedImportCollisions(
    this: Pick<UnmanagedImportHost, 'findEnvironmentRows' | 'isArtifactBacked' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    items: ReadonlyArray<{ type: string; name: string; expands: readonly string[] }>,
): Promise<Array<{ type: string; name: string; heldBy: string }>> {
    const wanted = new Map<string, { type: string; name: string }>();
    for (const item of items) {
        wanted.set(`${item.type}/${item.name}`, { type: item.type, name: item.name });
        for (const view of item.expands) wanted.set(`view/${view}`, { type: 'view', name: view });
    }
    const found = new Map<string, { type: string; name: string; heldBy: string }>();
    const names = [...new Set([...wanted.values()].map((slot) => slot.name))];
    try {
        for (let at = 0; at < names.length; at += 200) {
            // [#21911] The explicit system opt-in — see findServedOverlayRow.
            const rows = (await this.findEnvironmentRows('sys_metadata', {
                where: { name: { $in: names.slice(at, at + 200) } },
                context: { isSystem: true },
            })) as Array<{ type?: unknown; name?: unknown; package_id?: unknown }>;
            for (const row of rows ?? []) {
                const type = PLURAL_TO_SINGULAR[String(row.type)] ?? String(row.type);
                const key = `${type}/${String(row.name)}`;
                if (!wanted.has(key) || found.has(key)) continue;
                found.set(key, {
                    type,
                    name: String(row.name),
                    heldBy: typeof row.package_id === 'string' && row.package_id !== ''
                        ? `an environment item of package '${row.package_id}'`
                        : 'an environment item',
                });
            }
        }
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    // The managed side asks the save door's own predicate and nothing else:
    // it answers whether a package ships the name, not which one, and a
    // second spelling of the registry lookup to name it would be the
    // drift the predicate exists to prevent.
    for (const [key, slot] of wanted) {
        if (found.has(key) || !this.isArtifactBacked(slot.type, slot.name)) continue;
        found.set(key, { ...slot, heldBy: 'shipped by a managed package' });
    }
    return [...found.values()];
}

/** The body of `ObjectStackProtocolImplementation#rollBackUnmanagedImport`; the method's docblock there is its contract. */
export async function rollBackUnmanagedImport(
    this: Pick<UnmanagedImportHost, 'deletePackage'>,
    cause: any,
    context: {
        sourcePackageId: string;
        targetPackageId: string;
        failed: { type: string; name: string };
        copiedCount: number;
        actor?: string;
    },
): Promise<Error> {
    const { sourcePackageId, targetPackageId, failed, copiedCount, actor } = context;
    let residue: string | undefined;
    try {
        const outcome = await this.deletePackage({ packageId: targetPackageId, ...(actor ? { actor } : {}) });
        if (outcome.failedCount > 0) {
            residue = `${outcome.failedCount} of its items could not be removed`;
        }
    } catch (rollbackError) {
        residue = `the uninstall failed: ${clientFacingFailureText(rollbackError, 'uninstall failed')}`;
    }
    if (residue !== undefined) {
        console.error(
            `[protocol.importUnmanagedPackage] the unmanaged install of '${sourcePackageId}' failed and its base `
            + `'${targetPackageId}' was NOT fully removed (${residue}): the environment still holds a partial copy `
            + `while the install answered failure. Uninstall the package '${targetPackageId}' to remove it.`,
        );
    }
    const rolledBack = residue === undefined
        ? `the new base '${targetPackageId}' was removed, so nothing of the package remains`
        : `the new base '${targetPackageId}' could NOT be fully removed (${residue}) — uninstall it to finish`;
    return Object.assign(
        new Error(
            `The unmanaged install of '${sourcePackageId}' was rolled back: ${failed.type} '${failed.name}' could not `
            + `be written — ${clientFacingFailureText(cause, 'write failed')}. ${rolledBack}.`,
        ),
        {
            ...(typeof cause?.code === 'string' ? { code: cause.code } : {}),
            ...(typeof cause?.status === 'number' ? { status: cause.status } : {}),
            ...(typeof cause?.statusCode === 'number' ? { statusCode: cause.statusCode } : {}),
            ...(Array.isArray(cause?.issues) ? { issues: cause.issues } : {}),
            details: {
                failedItem: { type: failed.type, name: failed.name },
                copiedBeforeFailure: copiedCount,
                rolledBack: residue === undefined,
            },
            cause,
        },
    );
}
