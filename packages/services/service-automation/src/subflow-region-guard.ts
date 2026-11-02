// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28897] The reading behind the arming gate's region half: does a `subflow`
 * / `map` node inside one of a flow's region bodies (a `loop` body, a
 * `parallel` branch, a `try_catch` slot, at any depth the spec walks) call a
 * child flow that can suspend?
 *
 * A region body runs synchronously inside the enclosing run and cannot carry a
 * durable pause (#3267, ruling D on #15646). The flow parse refuses the
 * pausing node TYPES inside a region (#18688), but it cannot see past a
 * `subflow` / `map` node: whether that node suspends is a fact of ANOTHER flow,
 * which may register after the caller. So the run met it, at the region
 * boundary, as the named refusal in `region-suspension-refusal.ts` (#18881),
 * the first time the child suspended. The engine now reads it here, over the
 * flows it holds, and {@link AutomationEngine.activateFlowTrigger} declines to
 * arm such a caller. The run-time refusal stays as the second door.
 *
 * Where the child suspends is the #28840 reading ({@link suspendingNode}): a
 * pausing node reachable from the child's start, or a top-level call of the
 * child's whose own child can suspend, transitively. A child's region-nested
 * call is not read as a way for the CHILD to suspend: it fails the run at the
 * child's own region instead, so it never parks the caller.
 *
 * [#29166, seat ruling record 6576815635, option B] So the decline is one
 * level deep BY DESIGN, not by omission. A caller whose call (top-level or
 * not) reaches a child that itself makes a region call to a suspending flow is
 * armed: that child's region refusal fails the CHILD run, and the caller meets
 * it as an ordinary child failure, which the `subflow` / `map` contract makes
 * routable. Measured: with no `fault` edge on the caller's call node, the
 * caller's run fails loudly naming the child's region; with one, the caller's
 * run completes. Declining such a caller would refuse a flow whose author
 * routed that failure. The defect is the child's, and this gate names it on
 * the child the moment the child has a trigger of its own. Keeping the
 * refusal un-routable one level up would be a separate narrowing decision.
 */

import { collectFlowGraphs } from '@objectstack/spec/automation';
import type { FlowParsed } from '@objectstack/spec/automation';
import { describeSuspendingNode, suspendingNode } from './subflow-notice-guard.js';
import type { SuspendingNode } from './subflow-notice-guard.js';

/** A `subflow` / `map` node of a flow and the flow it names. */
export interface SubflowCall {
    readonly id: string;
    readonly type: 'subflow' | 'map';
    /** The flow its `config.flowName` names. */
    readonly flowName: string;
    /**
     * The container node whose region body holds it, the innermost one when
     * regions nest. Absent for a node on the top-level graph.
     */
    readonly region?: { readonly id: string; readonly type: string };
}

/**
 * The container node a region graph's `path` names: the object at the path up
 * to and including the last `nodes` index (`['nodes', 1, 'config', 'body']` →
 * the flow's `nodes[1]`).
 */
function containerAt(flow: FlowParsed, path: readonly (string | number)[]): { id: string; type: string } | undefined {
    const last = path.lastIndexOf('nodes');
    if (last < 0) return undefined;
    let at: unknown = flow;
    for (const key of path.slice(0, last + 2)) {
        if (!at || typeof at !== 'object') return undefined;
        at = (at as Record<string | number, unknown>)[key];
    }
    const node = at as { id?: unknown; type?: unknown } | null | undefined;
    return node && typeof node.id === 'string' && typeof node.type === 'string'
        ? { id: node.id, type: node.type }
        : undefined;
}

/**
 * Every `subflow` / `map` node of `flow` that names a flow, on the top-level
 * graph and in every region body `collectFlowGraphs` (`@objectstack/spec`)
 * reaches, in that walk's order. The one reading
 * {@link AutomationEngine.subflowTargets} and the region half share (#28846,
 * #28897), so no second region walk exists.
 */
export function subflowCalls(flow: FlowParsed): SubflowCall[] {
    const calls: SubflowCall[] = [];
    for (const graph of collectFlowGraphs(flow)) {
        const region = graph.path.length === 0 ? undefined : containerAt(flow, graph.path);
        for (const node of graph.nodes) {
            const n = node as { id?: unknown; type?: unknown; config?: { flowName?: unknown } } | null;
            if (!n || (n.type !== 'subflow' && n.type !== 'map')) continue;
            if (typeof n.config?.flowName !== 'string') continue;
            calls.push({
                id: typeof n.id === 'string' ? n.id : '',
                type: n.type,
                flowName: n.config.flowName,
                ...(region ? { region } : {}),
            });
        }
    }
    return calls;
}

/** A region-nested `subflow` / `map` node whose child flow can suspend. */
export interface RegionSuspendingCall {
    /** The container node whose region body holds the call (the innermost). */
    readonly region: { readonly id: string; readonly type: string };
    /** The `subflow` / `map` node. */
    readonly callNode: { readonly id: string; readonly type: string };
    /** The flow that node calls. */
    readonly child: string;
    /** Where that child can suspend. */
    readonly suspends: SuspendingNode;
}

/** The first region-nested call of `name` whose child can suspend, or `undefined`. */
export function regionSuspendingCall(
    flows: ReadonlyMap<string, FlowParsed>,
    name: string,
): RegionSuspendingCall | undefined {
    const flow = flows.get(name);
    if (!flow) return undefined;
    for (const call of subflowCalls(flow)) {
        if (!call.region) continue;
        const suspends = suspendingNode(flows, call.flowName);
        if (suspends) {
            return { region: call.region, callNode: { id: call.id, type: call.type }, child: call.flowName, suspends };
        }
    }
    return undefined;
}

/**
 * The sentence the warn and the `/_status` reason share: the call, the region
 * that holds it, where the child suspends, why the run would fail, and the
 * move that makes the flow armable, the prescription the run-time refusal
 * gives.
 */
export function describeRegionSuspendingCall(trap: RegionSuspendingCall): string {
    const { region, callNode, child, suspends } = trap;
    return (
        `its \`${callNode.type}\` node '${callNode.id}' sits inside \`${region.type}\` node '${region.id}', and its ` +
        `child flow '${child}' can suspend the run at ${describeSuspendingNode(child, suspends)}. A region body ` +
        `runs synchronously inside the run and cannot carry a durable pause, so the run would fail at ` +
        `'${region.id}' the first time that child suspends, and nothing after it would run. Move '${callNode.id}' ` +
        `onto the top-level graph and route the region's exit to it`
    );
}
