// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4/D5, epic #31527 child B (flow), #31696] One package's flow
 * of a name two packages hold, as the automation service a door reads.
 *
 * Once two namespaces may each hold a flow name (ADR-0150 D9: the flow's
 * one-holder rule narrowed to the namespace), the engine holds each holder's
 * flow in its own slot (service-automation `flow-slots.ts`), and its BARE
 * entries (`execute`, `getFlow`, `toggleFlow`) refuse the shared name, 409
 * naming both: a caller with no package reaches neither (D3). A door that
 * knows which package's flow it means reaches that one through the engine's
 * slot entries (`executeSlot`, `getFlowSlot`, `toggleFlowSlot`, `flowSlotKey`;
 * engine-local, not on the service contract).
 *
 * {@link flowSlotView} is such a door's service: the same service, with its
 * by-name members bound to the one slot for the one name. Every step of the
 * door (the existence probe, the start admission, the run, the run reads)
 * then reads the same flow, and none of them falls back to the bare name. A
 * run of the other slot keeps its slot key as its flow name, so the door's
 * run-ownership check (`runIsOutsideFlow`) reads it as another flow's run.
 *
 * Who reads it:
 *  - the `/automation` doors, for an address whose namespace names the one
 *    holder of a shared name (`domains/automation.ts`, `admitAutomationAddress`);
 *  - a flow action and a flow endpoint, which run the flow their own
 *    package's item names (D3: the caller package's own item first), through
 *    {@link flowServiceForCaller}.
 *
 * ⛔ No slot entries, no view: a door then keeps the bare service, whose bare
 * entries refuse the shared name. Never a guess at which holder was meant.
 */

import { PackageScopedNameRefusedError } from '@objectstack/core';
import { resolvePackageScopedName, type PackageScopedRegistry } from '@objectstack/objectql';
import type { FlowWalkReads } from './flow-start-admission.js';

/** The engine-local slot entries (service-automation's `AutomationEngine`). */
interface FlowSlotEntries {
    executeSlot(packageId: string | null, name: string, context?: unknown): Promise<unknown>;
    getFlowSlot(packageId: string | null, name: string): unknown;
    toggleFlowSlot(packageId: string, name: string, enabled: boolean, caller?: unknown): Promise<void>;
    flowSlotKey(packageId: string | null, name: string): string | undefined;
}

/** The slot a {@link flowSlotView} is bound to, read back by {@link flowWalkReads}. */
const BOUND_SLOT: unique symbol = Symbol('objectstack.runtime.flowSlotView.boundSlot');

/** The `(package, name)` a {@link flowSlotView} is bound to, or `undefined` for any other service. */
function boundSlotOf(service: unknown): { packageId: string; name: string } | undefined {
    if (!service || typeof service !== 'object') return undefined;
    return (service as { [BOUND_SLOT]?: { packageId: string; name: string } })[BOUND_SLOT];
}

function slotEntriesOf(service: unknown): FlowSlotEntries | undefined {
    const s = service as Partial<FlowSlotEntries> | null | undefined;
    if (!s || typeof s !== 'object') return undefined;
    return typeof s.executeSlot === 'function'
        && typeof s.getFlowSlot === 'function'
        && typeof s.toggleFlowSlot === 'function'
        && typeof s.flowSlotKey === 'function'
        ? (s as FlowSlotEntries)
        : undefined;
}

/**
 * `service` with its by-name members bound to package `packageId`'s flow
 * `name` (see the module note), or `undefined` when the service has no slot
 * entries. A member the service does not have stays absent, so a door's own
 * `typeof … === 'function'` probes answer as they did. A name other than
 * `name` passes through to the bare member.
 */
export function flowSlotView<T extends object>(service: T, packageId: string, name: string): T | undefined {
    const slots = slotEntriesOf(service);
    if (!slots) return undefined;
    const target = service as Record<string, any>;
    const key = (): string | undefined => slots.flowSlotKey(packageId, name);
    // A run of this slot reads as a run of the name the door addressed. A run
    // filed under the bare name while that is NOT this slot's key (the name's
    // lone slot is another package's, [M1]) is not this slot's run: it reads
    // as the unfiled spelling, which names no flow, so a run door's own scope
    // check refuses it under this address.
    const asNamed = <R>(entry: R): R => {
        if (!entry || typeof entry !== 'object') return entry;
        const held = (entry as { flowName?: unknown }).flowName;
        const k = key();
        if (k !== undefined && held === k) return k === name ? entry : { ...entry, flowName: name };
        return held === name ? { ...entry, flowName: `\u0000${name}` } : entry;
    };
    const runsOf = async (member: 'listRuns' | 'listRunsPage', flowName: string, options?: unknown) => {
        if (flowName !== name) return target[member](flowName, options);
        const k = key();
        if (k === undefined) return member === 'listRuns' ? [] : { runs: [], hasMore: false };
        const answer = await target[member](k, options);
        if (Array.isArray(answer)) return answer.map(asNamed);
        return answer && Array.isArray(answer.runs) ? { ...answer, runs: answer.runs.map(asNamed) } : answer;
    };
    const bound: Record<string, (...args: any[]) => unknown> = {
        execute: (flowName: string, context?: unknown) =>
            flowName === name ? slots.executeSlot(packageId, name, context) : target.execute(flowName, context),
        getFlow: async (flowName: string) =>
            flowName === name ? (slots.getFlowSlot(packageId, name) ?? null) : target.getFlow(flowName),
        toggleFlow: (flowName: string, enabled: boolean, caller?: unknown) =>
            flowName === name ? slots.toggleFlowSlot(packageId, name, enabled, caller) : target.toggleFlow(flowName, enabled, caller),
        listRuns: (flowName: string, options?: unknown) => runsOf('listRuns', flowName, options),
        listRunsPage: (flowName: string, options?: unknown) => runsOf('listRunsPage', flowName, options),
        getRun: async (runId: string) => asNamed(await target.getRun(runId)),
        listSuspendedRuns: () => {
            const parked = target.listSuspendedRuns();
            return Array.isArray(parked) ? parked.map(asNamed) : parked;
        },
    };
    return new Proxy(service, {
        get(held, prop) {
            if (prop === BOUND_SLOT) return { packageId, name };
            const value = Reflect.get(held, prop, held);
            if (typeof value !== 'function') return value;
            return typeof prop === 'string' && Object.prototype.hasOwnProperty.call(bound, prop) ? bound[prop] : value.bind(held);
        },
    });
}

/**
 * The registry answers the holder table. A caller's closure is read through
 * `getPackage` / `getAllPackages` where it has them; the closure walk reads a
 * registry without them as declaring no dependency (`packageResolutionClosure`).
 */
function canResolveForCaller(registry: Partial<PackageScopedRegistry>): registry is PackageScopedRegistry {
    return typeof registry.packageScopedHoldersOf === 'function'
        && typeof registry.getPackageScopedItem === 'function'
        && typeof registry.getEnvironmentScopedItem === 'function';
}

/**
 * The automation service a door reads to run the flow `name` that package
 * `callerPackageId`'s own item names: a flow action's `target`, a flow
 * endpoint's `target`. ADR-0150 D3 resolves the name from that package.
 *
 *  - A name a caller with no package reaches (one holder, or none) is the
 *    service itself, as before: its bare entries serve it.
 *  - A name two packages hold, which the bare entries refuse, resolves for the
 *    caller's package: its own flow, else the one holder in its closure,
 *    served from that holder's slot ({@link flowSlotView}). A name the
 *    resolver refuses for that package throws its refusal
 *    (`PackageScopedNameRefusedError`, 409, every candidate named), before
 *    anything is read or run.
 *  - No caller package, a registry that cannot answer, or an engine with no
 *    slot entries: the service itself, whose bare entries refuse the shared
 *    name, naming both (fail closed).
 */
export function flowServiceForCaller<T extends object>(
    service: T,
    registry: Partial<PackageScopedRegistry> | undefined,
    name: unknown,
    callerPackageId: string | undefined,
): T {
    if (!callerPackageId || typeof name !== 'string' || name === '' || !registry || !canResolveForCaller(registry)) return service;
    const bare = resolvePackageScopedName(registry, { type: 'flow', name, callerPackageId: null });
    if (bare.status !== 'refused') return service;
    const own = resolvePackageScopedName(registry, { type: 'flow', name, callerPackageId });
    if (own.status === 'refused') throw new PackageScopedNameRefusedError(own);
    if (own.status !== 'resolved' || own.holder.kind !== 'package') return service;
    return flowSlotView(service, own.holder.packageId, name) ?? service;
}

/**
 * The package whose `api` item `endpointName` is, as the resolver names it
 * for a caller with no package, or `undefined` for an environment item, a
 * name the resolver refuses, or a registry that cannot answer. A flow
 * endpoint's `target` resolves from it ({@link flowServiceForCaller}).
 */
export function endpointPackageOf(registry: Partial<PackageScopedRegistry> | undefined, endpointName: unknown): string | undefined {
    if (!registry || typeof endpointName !== 'string' || endpointName === '' || !canResolveForCaller(registry)) return undefined;
    const held = resolvePackageScopedName(registry, { type: 'api', name: endpointName, callerPackageId: null });
    return held.status === 'resolved' && held.holder.kind === 'package' ? held.holder.packageId : undefined;
}

/**
 * [ADR-0150 D3/D4, #31696] How the start admission's record-read walk
 * (`flowDeclaredRecordReads`) reads the flows a run reaches, the way the
 * engine's run reads them (its `resolveFlowKey`):
 *
 *  - the started flow's package: the slot `service` is bound to when it is a
 *    {@link flowSlotView} of that flow, else the one holder the bare name
 *    resolves to (`null` for the environment's own flow, or none);
 *  - a `subflow` / `map` callee: a name a caller with no package reaches is
 *    the bare read, as before; a name two packages hold resolves from the
 *    CALLING flow's package (its own flow, else the one holder in its
 *    closure), read from that holder's slot, and a name that resolver refuses
 *    throws its refusal (`409`, every candidate named), as the run's call
 *    would answer.
 *
 * ⛔ A registry that cannot answer, or an engine with no slot entries, reads
 * every callee bare, whose read refuses a shared name (fail closed).
 * `registry` is read once, and only when the walk asks.
 */
export function flowWalkReads(
    service: object,
    registry: () => Promise<Partial<PackageScopedRegistry> | undefined>,
): FlowWalkReads {
    let held: Promise<PackageScopedRegistry | undefined> | undefined;
    const resolver = (): Promise<PackageScopedRegistry | undefined> => (held ??= Promise.resolve()
        .then(registry)
        .then((r) => (r && canResolveForCaller(r) ? r : undefined), () => undefined));
    const bareRead = (name: string): Promise<unknown> => (service as { getFlow(name: string): Promise<unknown> }).getFlow(name);
    const packageOf = (resolution: ReturnType<typeof resolvePackageScopedName>): string | null =>
        resolution.status === 'resolved' && resolution.holder.kind === 'package' ? resolution.holder.packageId : null;
    return {
        async rootPackage(flowName) {
            const bound = boundSlotOf(service);
            if (bound && bound.name === flowName) return bound.packageId;
            const table = await resolver();
            return table ? packageOf(resolvePackageScopedName(table, { type: 'flow', name: flowName, callerPackageId: null })) : null;
        },
        async callee(name, callerPackageId) {
            const table = await resolver();
            const slots = slotEntriesOf(service);
            if (!table || !slots) return { flow: await bareRead(name), packageId: null };
            const bare = resolvePackageScopedName(table, { type: 'flow', name, callerPackageId: null });
            if (bare.status !== 'refused') return { flow: await bareRead(name), packageId: packageOf(bare) };
            const own = resolvePackageScopedName(table, { type: 'flow', name, callerPackageId });
            if (own.status === 'refused') throw new PackageScopedNameRefusedError(own);
            const holder = packageOf(own);
            if (holder === null) return { flow: await bareRead(name), packageId: null };
            return { flow: slots.getFlowSlot(holder, name) ?? null, packageId: holder };
        },
    };
}

/**
 * [ADR-0150 D4/D8, #31696] The flow a run row names, read off the key it
 * carries: a run of a name two packages hold carries its slot key,
 * `PACKAGE/NAME` (a flow name admits `[a-z0-9_]` only, so the last `/`
 * splits the two); any other run carries its flow's bare name, and no
 * package. A run id names exactly one run, so this is the run's own flow,
 * never a guess at a name. `undefined` for a run with no flow name.
 */
export function runFlowOf(flowName: unknown): { name: string; packageId?: string } | undefined {
    if (typeof flowName !== 'string' || flowName === '') return undefined;
    const cut = flowName.lastIndexOf('/');
    if (cut <= 0 || cut === flowName.length - 1) return { name: flowName };
    return { name: flowName.slice(cut + 1), packageId: flowName.slice(0, cut) };
}

/**
 * [ADR-0150 D3, #31696] The package whose flow `name` a caller of package
 * `callerPackageId` (`undefined`: none) reaches — the holder a flow action's
 * `target` runs ({@link flowServiceForCaller}) — or `undefined` when the
 * resolver refuses it, reaches the environment's own flow or nothing, or the
 * registry cannot answer.
 */
export function flowHolderForCaller(
    registry: Partial<PackageScopedRegistry> | undefined,
    name: string,
    callerPackageId: string | undefined,
): string | undefined {
    if (!registry || !canResolveForCaller(registry)) return undefined;
    const resolution = resolvePackageScopedName(registry, { type: 'flow', name, callerPackageId: callerPackageId ?? null });
    return resolution.status === 'resolved' && resolution.holder.kind === 'package' ? resolution.holder.packageId : undefined;
}

/**
 * [ADR-0150 D4, #31696] The automation service a bare run door
 * (`/automation/:name/runs/:runId/…`) reads when `name` is one two packages
 * hold, which the bare doors refuse: a run id names exactly one run, and the
 * run carries its own slot key, so the door acts on THAT run's slot when the
 * key is `name`'s slot, `PACKAGE/name`, the engine files. `undefined` — the
 * door keeps its `409` naming every holder — for a run it cannot read, a run
 * of another flow, a run carrying no package (a package-less run of a shared
 * name), or an engine with no slot entries.
 */
export async function runSlotView<T extends object>(service: T, name: string, runId: string): Promise<T | undefined> {
    const slots = slotEntriesOf(service);
    if (!slots) return undefined;
    const key = await runFlowKeyOf(service, runId);
    const flow = runFlowOf(key);
    if (!flow || flow.name !== name || flow.packageId === undefined) return undefined;
    if (slots.flowSlotKey(flow.packageId, name) !== key) return undefined;
    return flowSlotView(service, flow.packageId, name);
}

/**
 * The flow key the service records for the run `runId`: its `getRun` row's
 * `flowName`, else the suspended-run list's (which still names a parked run
 * when `getRun` answers `null`), as the run doors' own scope check reads it.
 */
async function runFlowKeyOf(service: object, runId: string): Promise<unknown> {
    const svc = service as {
        getRun?: (runId: string) => Promise<{ flowName?: unknown } | null | undefined>;
        listSuspendedRuns?: () => unknown;
    };
    if (typeof svc.getRun === 'function') {
        const run = await Promise.resolve().then(() => svc.getRun!(runId)).catch(() => undefined);
        if (typeof run?.flowName === 'string' && run.flowName !== '') return run.flowName;
    }
    if (typeof svc.listSuspendedRuns === 'function') {
        let parked: unknown;
        try {
            parked = svc.listSuspendedRuns();
        } catch {
            parked = undefined;
        }
        const entry = Array.isArray(parked) ? parked.find((r) => (r as { runId?: unknown } | null)?.runId === runId) : undefined;
        return (entry as { flowName?: unknown } | undefined)?.flowName;
    }
    return undefined;
}
