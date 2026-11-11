// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D8 row R8, #31696] The engine's view of an attached
 * {@link SuspendedRunStore}: what the engine hands it and reads back carries
 * the flow's slot KEY (./flow-slots.ts) as `flowName`, as every record the
 * engine keeps does; what the store holds carries the flow's NAME and, beside
 * it, its PACKAGE (`sys_automation_run.flow_name` / `flow_package`).
 *
 * So every row the engine writes names the package whose flow the run is,
 * and a stored run resumes on the slot `(flow_name, flow_package)` names — on
 * no other package's flow of that name. A row that names no package (an
 * environment-authored flow, a row written before the column was stamped)
 * reads as the bare name, as before.
 *
 * The view is transparent where it can be: a record whose key is its name and
 * whose flow no package holds passes through unchanged, and an optional
 * method the store does not implement is not implemented here either, so the
 * engine's own capability checks (`typeof store.claimSuspension`) read the
 * store's answer.
 */

import type { RunRecord, SuspendedRun, SuspendedRunStore } from './engine.js';

/** How the view maps a key to the stored pair and back. */
export interface FlowSlotRunCoordinates {
    /** The stored `(name, package)` of the run of the flow filed under `key`. */
    readonly stored: (key: string, flowPackage: string | undefined) => { flowName: string; flowPackage?: string };
    /** The key a stored `(name, package)` names now. */
    readonly key: (flowName: string, flowPackage: string | undefined) => string;
}

function toStored<T extends { flowName: string; flowPackage?: string }>(record: T, coordinates: FlowSlotRunCoordinates): T {
    const stored = coordinates.stored(record.flowName, record.flowPackage);
    if (stored.flowName === record.flowName && stored.flowPackage === record.flowPackage) return record;
    const { flowPackage: _dropped, ...rest } = record;
    return { ...rest, flowName: stored.flowName, ...(stored.flowPackage ? { flowPackage: stored.flowPackage } : {}) } as T;
}

function fromStored<T extends { flowName: string; flowPackage?: string }>(record: T, coordinates: FlowSlotRunCoordinates): T {
    const key = coordinates.key(record.flowName, record.flowPackage);
    return key === record.flowName ? record : { ...record, flowName: key };
}

/**
 * The engine's slot-keyed view of `inner` — see the module doc. A proxy, so
 * every member is read off the store at the moment of use: a method the store
 * gains, loses or replaces later is the view's too.
 */
export function flowSlotRunStore(inner: SuspendedRunStore, coordinates: FlowSlotRunCoordinates): SuspendedRunStore {
    const read = <T extends SuspendedRun | RunRecord>(record: T | null): T | null =>
        record ? fromStored(record, coordinates) : record;
    const nameOf = (key: string): string => coordinates.stored(key, undefined).flowName;
    const views: Partial<Record<keyof SuspendedRunStore, (store: SuspendedRunStore) => unknown>> = {
        save: (store) => (run: SuspendedRun) => store.save(toStored(run, coordinates)),
        load: (store) => async (runId: string) => read(await store.load(runId)),
        list: (store) => async () => (await store.list()).map((run) => fromStored(run, coordinates)),
        listByFlow: (store) => async (keys: readonly string[]) => {
            const wanted = new Set(keys);
            const names = [...new Set(keys.map(nameOf))];
            return (await store.listByFlow!(names))
                .map((run) => fromStored(run, coordinates))
                .filter((run) => wanted.has(run.flowName));
        },
        recordTerminal: (store) => (record: RunRecord) => store.recordTerminal!(toStored(record, coordinates)),
        // [N2] The store's window is by name and the slot filter runs after it: widen the window until the
        // slot's `limit` rows are in it or the store has no more, so another slot's newer rows hide none.
        listHistory: (store) => async (key: string, limit: number) => {
            for (let window = limit; ; window *= 2) {
                const rows = await store.listHistory!(nameOf(key), window);
                const mine = rows.map((record) => fromStored(record, coordinates)).filter((record) => record.flowName === key);
                if (mine.length >= limit || rows.length < window || !(window > 0)) return mine.slice(0, limit);
            }
        },
        loadTerminal: (store) => async (runId: string) => read(await store.loadTerminal!(runId)),
    };
    return new Proxy(inner, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            const view = views[property as keyof SuspendedRunStore];
            if (view === undefined || typeof value !== 'function') {
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return view(target);
        },
    });
}
