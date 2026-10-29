// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] `sys_metadata`'s overlay-uniqueness indexes and the
 * bundle-member backfill they need first, each run once per process, from
 * `ObjectStackProtocolImplementation`, moved out of `protocol.ts` whole:
 * `ensureOverlayIndex` and `ensureOverlayMembersBackfilled`.
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
 * the {@link OverlayIndexHost} members it reads, plus a `.call`; a body that
 * reads no member is called as a plain function. The `engine` field and the
 * two run-once flags are handed over as getters (and the flags as setters),
 * so each read and write reaches the class field as it stands at call time;
 * the call to `ensureOverlayMembersBackfilled` is a closure, so it still
 * reaches the class method. Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { driverCanRunSql, resolveDriverExec } from './migrations/driver-exec.js';
import { backfillOverlayBundleMembers, ensureMetadataOverlayIndexes } from './migrations/overlay-index.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface OverlayIndexHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly ensureOverlayMembersBackfilled: ObjectStackProtocolImplementation['ensureOverlayMembersBackfilled'];
    overlayIndexEnsured: ObjectStackProtocolImplementation['overlayIndexEnsured'];
    overlayMembersBackfilled: ObjectStackProtocolImplementation['overlayMembersBackfilled'];
}

/** The body of `ObjectStackProtocolImplementation#ensureOverlayIndex`. */
export async function ensureOverlayIndex(this: Pick<OverlayIndexHost, 'engine' | 'ensureOverlayMembersBackfilled' | 'overlayIndexEnsured'>): Promise<void> {
    if (this.overlayIndexEnsured) return;
    this.overlayIndexEnsured = true;
    // [#22877] Rows stored before the member column existed get their
    // body's member before the first write can address them.
    await this.ensureOverlayMembersBackfilled();
    try {
        const engineAny = this.engine as any;
        let driver: any = engineAny?.driver ?? engineAny?.getDriver?.();
        if (!driver && engineAny?.drivers instanceof Map) {
            for (const candidate of engineAny.drivers.values()) {
                if (driverCanRunSql(candidate)) {
                    driver = candidate;
                    break;
                }
            }
        }
        if (!driver) return;
        const resolved = resolveDriverExec(driver);
        // The refusal stays INSIDE the seam rather than becoming an early
        // return: a driver taken from `engineAny?.driver` is not
        // capability-checked above, and when it offers neither surface it is
        // the migration that classifies and reports the failure — an early
        // return here would put that back into the silent `catch` below.
        const exec = async (sql: string): Promise<void> => {
            if (!resolved) throw new Error('driver has neither raw nor execute');
            await resolved(sql);
        };
        // `console` satisfies the logger surface structurally; this class
        // carries no injected logger, and its own diagnostics go to
        // `console.warn` throughout (see `emitMetadataMutation`).
        await ensureMetadataOverlayIndexes(exec, console);
    } catch {
        // A boot must never fail over an index. Note this arm is now only
        // reachable for driver RESOLUTION failures: every DDL failure past
        // this point is classified and reported by the migration itself,
        // instead of vanishing into an empty catch (#6418).
    }
}

/** The body of `ObjectStackProtocolImplementation#ensureOverlayMembersBackfilled`. */
export async function ensureOverlayMembersBackfilled(this: Pick<OverlayIndexHost, 'engine' | 'overlayMembersBackfilled'>): Promise<void> {
    if (this.overlayMembersBackfilled) return;
    this.overlayMembersBackfilled = true;
    await backfillOverlayBundleMembers(this.engine as any, console);
}
