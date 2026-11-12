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

/** The engine-local slot entries (service-automation's `AutomationEngine`). */
interface FlowSlotEntries {
    executeSlot(packageId: string | null, name: string, context?: unknown): Promise<unknown>;
    getFlowSlot(packageId: string | null, name: string): unknown;
    toggleFlowSlot(packageId: string, name: string, enabled: boolean, caller?: unknown): Promise<void>;
    flowSlotKey(packageId: string | null, name: string): string | undefined;
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
    // A run of this slot reads as a run of the name the door addressed.
    const asNamed = <R>(entry: R): R => {
        const k = key();
        if (k === undefined || !entry || typeof entry !== 'object') return entry;
        return (entry as { flowName?: unknown }).flowName === k ? { ...entry, flowName: name } : entry;
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
