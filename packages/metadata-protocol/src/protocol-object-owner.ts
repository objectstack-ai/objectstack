// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 17] The object-owner verdicts of
 * `ObjectStackProtocolImplementation`: which contributor kind a stored object
 * row registers as against the registry's owner of that name
 * (`classifyObjectContribution`), and handing an adopted object's name from the
 * `'sys_metadata'` sentinel owner to its rebound row
 * (`releaseAdoptedObjectOwner`), moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same registry reads in the
 * same order, the same verdicts, and the same logged line.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link ObjectOwnerHost} members that method reads, plus a
 * `.call`. The engine is handed over as a getter, so the body reads the
 * protocol's engine (and so its registry) at call time. Every other reader of
 * these two methods keeps calling the class method.
 *
 * Neither body reads a module-level declaration of `protocol.ts`, and neither
 * imports anything, so this module imports only the class type. Nothing
 * re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface ObjectOwnerHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
}

/** The body of `ObjectStackProtocolImplementation#classifyObjectContribution`; the method's docblock there is its contract. */
export function classifyObjectContribution(
    this: Pick<ObjectOwnerHost, 'engine'>,
    name: string,
    rowPackageId: string | null | undefined,
):
    | { kind: 'own' | 'overlay'; packageId: string }
    | { kind: 'mismatch'; packageId: string; ownerPackageId: string } {
    // `||`, not `??`: an empty-string binding is "no package", the same
    // normalisation both hydration seams apply to `package_id`.
    const binding = rowPackageId || '';
    const registry: any = (this.engine as any)?.registry;
    const owner = typeof registry?.getPackagedObjectOwner === 'function'
        ? registry.getPackagedObjectOwner(name)
        : undefined;
    const ownerPackageId: unknown = owner?.packageId;
    if (typeof ownerPackageId !== 'string' || ownerPackageId === '') {
        // [#23416] No packaged owner: the runtime-authored one, if any.
        const runtimeOwner = typeof registry?.getObjectOwner === 'function'
            ? registry.getObjectOwner(name)
            : undefined;
        const runtimeOwnerPackageId: unknown = runtimeOwner?.packageId;
        // [#23514] The `'sys_metadata'` sentinel owner is judged too: see the header.
        if (
            binding !== ''
            && typeof runtimeOwnerPackageId === 'string'
            && runtimeOwnerPackageId !== ''
            && binding !== runtimeOwnerPackageId
        ) {
            return { kind: 'mismatch', packageId: binding, ownerPackageId: runtimeOwnerPackageId };
        }
        return { kind: 'own', packageId: binding || 'sys_metadata' };
    }
    if (binding !== '' && binding !== ownerPackageId) {
        return { kind: 'mismatch', packageId: binding, ownerPackageId };
    }
    return { kind: 'overlay', packageId: binding || 'sys_metadata' };
}

/** The body of `ObjectStackProtocolImplementation#releaseAdoptedObjectOwner`; the method's docblock there is its contract. */
export function releaseAdoptedObjectOwner(
    this: Pick<ObjectOwnerHost, 'engine'>,
    name: string, item: unknown, targetPackageId: string,
): boolean {
    const registry: any = (this.engine as any)?.registry;
    if (typeof registry?.registerObject !== 'function') return false;
    if (!item || typeof item !== 'object' || typeof (item as { name?: unknown }).name !== 'string') return false;
    const owner: { packageId?: unknown } | undefined = typeof registry.getObjectOwner === 'function'
        ? registry.getObjectOwner(name)
        : undefined;
    if (owner === undefined) return true;
    if (owner.packageId !== 'sys_metadata' || typeof registry.unregisterObject !== 'function') return false;
    try {
        registry.unregisterObject(name);
        return true;
    } catch (err: any) {
        console.error(
            `[Protocol] reassignOrphanedMetadata: object '${name}' was adopted into package `
            + `'${targetPackageId}' in sys_metadata, but the registry keeps its package-less definition `
            + `(owner 'sys_metadata') until the next restart: ${err?.message ?? err}. Until then the data `
            + `plane serves the pre-adoption definition, and a save of the object naming '${targetPackageId}' `
            + 'answers success without going live. Fix: restart the server; the boot registers the object '
            + `under '${targetPackageId}'.`,
        );
        return false;
    }
}
