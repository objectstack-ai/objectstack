// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28840] The reading behind the arming gate's save-notice half: does a
 * `save_notice` of a flow run after a `subflow` / `map` node whose child flow
 * can suspend?
 *
 * The flow parse refuses a `save_notice` that an always-suspending node
 * reaches (#28806, `save-notice-placement.ts` in `@objectstack/spec`). It
 * cannot see past a `subflow` / `map` node: whether that node suspends is a
 * fact of ANOTHER flow, which may register after the caller. A suspended child
 * suspends its caller, the write that fired the caller answers, and the
 * `save_notice` after the call then refuses by name when the run resumes. So
 * the engine reads it here, over the flows it holds, and
 * {@link AutomationEngine.activateFlowTrigger} declines to arm such a caller.
 *
 * The walk is the #28806 one: any path over the top-level `edges`, loops
 * included, with a region body's node judged by its top-level container. It
 * is repeated here rather than exported from `@objectstack/spec`, which keeps
 * no internal entry: the order prefers that to a new public helper.
 *
 * Only top-level `subflow` / `map` nodes are read, the ones
 * {@link AutomationEngine.subflowTargets} answers, so the gate and the
 * re-judge read the same calls.
 */

import { FLOW_PAUSE_CAPABLE_NODE_TYPES, collectFlowGraphs } from '@objectstack/spec/automation';
import type { FlowParsed } from '@objectstack/spec/automation';

/** A top-level node's `id` and `type`, and the flow a `subflow` / `map` node names. */
interface TopNode {
    readonly id: string;
    readonly type: string;
    readonly calls?: string;
}

/** The top-level nodes in order, and the successors of each node id. */
function topLevel(flow: FlowParsed): { nodes: TopNode[]; next: Map<string, string[]> } {
    const raw = flow as { nodes?: unknown; edges?: unknown };
    const nodes: TopNode[] = [];
    for (const node of Array.isArray(raw.nodes) ? raw.nodes : []) {
        const n = node as { id?: unknown; type?: unknown; config?: { flowName?: unknown } } | null;
        if (!n || typeof n.id !== 'string' || typeof n.type !== 'string') continue;
        const calls = (n.type === 'subflow' || n.type === 'map') && typeof n.config?.flowName === 'string'
            ? n.config.flowName
            : undefined;
        nodes.push({ id: n.id, type: n.type, ...(calls !== undefined ? { calls } : {}) });
    }
    const next = new Map<string, string[]>();
    for (const edge of Array.isArray(raw.edges) ? raw.edges : []) {
        const e = edge as { source?: unknown; target?: unknown } | null;
        if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
        const list = next.get(e.source);
        if (list) list.push(e.target);
        else next.set(e.source, [e.target]);
    }
    return { nodes, next };
}

/** Every node id a path from any of `from` reaches, `from` included. */
function reach(next: ReadonlyMap<string, string[]>, from: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...from];
    while (queue.length > 0) {
        const id = queue.shift() as string;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(next.get(id) ?? []));
    }
    return seen;
}

/** The node ids reachable from the flow's start node, or none without one. */
function fromStart(graph: { nodes: TopNode[]; next: Map<string, string[]> }): Set<string> {
    const start = graph.nodes.find((n) => n.type === 'start');
    return start ? reach(graph.next, [start.id]) : new Set();
}

/**
 * Where a flow can suspend: the pausing node, the flow that holds it, and the
 * calls that lead there, from the flow asked about to that one.
 */
export interface SuspendingNode {
    readonly id: string;
    readonly type: string;
    readonly flow: string;
    readonly through: readonly string[];
}

/**
 * The first node of an always-suspending type reachable from `name`'s start,
 * or else the first one a reachable `subflow` / `map` node's child reaches,
 * transitively. `undefined` when the flow is not registered or cannot suspend.
 * A flow already on the walk is not read again, so a cycle of calls ends.
 */
export function suspendingNode(
    flows: ReadonlyMap<string, FlowParsed>,
    name: string,
    seen: Set<string> = new Set(),
): SuspendingNode | undefined {
    if (seen.has(name)) return undefined;
    seen.add(name);
    const flow = flows.get(name);
    if (!flow) return undefined;
    const graph = topLevel(flow);
    const reached = fromStart(graph);
    const pause = graph.nodes.find((n) => reached.has(n.id) && FLOW_PAUSE_CAPABLE_NODE_TYPES.includes(n.type));
    if (pause) return { id: pause.id, type: pause.type, flow: name, through: [name] };
    for (const node of graph.nodes) {
        if (node.calls === undefined || !reached.has(node.id)) continue;
        const deeper = suspendingNode(flows, node.calls, seen);
        if (deeper) return { ...deeper, through: [name, ...deeper.through] };
    }
    return undefined;
}

/** A `save_notice` a suspending `subflow` / `map` node reaches. */
export interface SubflowNoticeTrap {
    /** The `save_notice` node's own id (inside a region body, the nested node's). */
    readonly noticeId: string;
    /** The `subflow` / `map` node the notice runs after. */
    readonly callNode: { readonly id: string; readonly type: string };
    /** The flow that node calls. */
    readonly child: string;
    /** Where that child can suspend. */
    readonly suspends: SuspendingNode;
}

/**
 * The first `save_notice` of `name` that a path start → … → `subflow` / `map`
 * node whose child can suspend → … → that notice reaches, or `undefined`.
 */
export function subflowNoticeTrap(flows: ReadonlyMap<string, FlowParsed>, name: string): SubflowNoticeTrap | undefined {
    const flow = flows.get(name);
    if (!flow) return undefined;
    const notices: Array<{ judgedAs: string; id: string }> = [];
    const topNodes = (flow as { nodes?: unknown }).nodes;
    for (const graph of collectFlowGraphs(flow)) {
        // A region body's node is judged by its top-level container, the node
        // `path` = ['nodes', <index>, 'config', …] starts at.
        const container = graph.path.length === 0 || !Array.isArray(topNodes)
            ? undefined
            : (topNodes[graph.path[1] as number] as { id?: unknown } | undefined)?.id;
        for (const node of graph.nodes) {
            const n = node as { id?: unknown; type?: unknown } | null;
            if (n?.type !== 'save_notice' || typeof n.id !== 'string') continue;
            const judgedAs = graph.path.length === 0 ? n.id : container;
            if (typeof judgedAs === 'string') notices.push({ judgedAs, id: n.id });
        }
    }
    if (notices.length === 0) return undefined;
    const graph = topLevel(flow);
    const reached = fromStart(graph);
    for (const node of graph.nodes) {
        if (node.calls === undefined || !reached.has(node.id)) continue;
        const suspends = suspendingNode(flows, node.calls);
        if (!suspends) continue;
        // From its successors, not itself: a node is "after" the call only on
        // a path that leaves it, which is also how a loop back counts.
        const after = reach(graph.next, graph.next.get(node.id) ?? []);
        const hit = notices.find((n) => after.has(n.judgedAs));
        if (hit) return { noticeId: hit.id, callNode: { id: node.id, type: node.type }, child: node.calls, suspends };
    }
    return undefined;
}

/**
 * Every registered flow other than `name` whose `subflow` / `map` calls reach
 * `name`, directly or through other flows: the callers whose save-notice
 * reading can move when `name` changes.
 */
export function transitiveSubflowCallers(
    flows: ReadonlyMap<string, FlowParsed>,
    subflowTargets: (flow: FlowParsed) => string[],
    name: string,
): string[] {
    const found = new Set<string>();
    const pending = [name];
    while (pending.length > 0) {
        const target = pending.pop() as string;
        for (const [callerName, flow] of flows) {
            if (callerName === name || found.has(callerName)) continue;
            if (!subflowTargets(flow).includes(target)) continue;
            found.add(callerName);
            pending.push(callerName);
        }
    }
    return [...found];
}

/**
 * The sentence the warn and the `/_status` reason share, in the #28806 shape:
 * the notice, the call node, where the child suspends, and the two moves that
 * make the flow armable.
 */
export function describeSubflowNoticeTrap(trap: SubflowNoticeTrap): string {
    const { noticeId, callNode, child, suspends } = trap;
    const where = suspends.flow === child
        ? ''
        : ` of '${suspends.flow}'${suspends.through.length > 2
            ? `, which it reaches through ${suspends.through.slice(1, -1).map((f) => `'${f}'`).join(', ')}`
            : ''}`;
    return (
        `its \`save_notice\` node '${noticeId}' is reached after \`${callNode.type}\` node '${callNode.id}', whose ` +
        `child flow '${child}' can suspend the run at \`${suspends.type}\` node '${suspends.id}'${where}. A suspended ` +
        `run resumes after the write has already answered, so on that path the node is refused by name at run time, ` +
        `and after an approval the decision cannot finish its run. Move the \`save_notice\` ahead of ` +
        `'${callNode.id}', or tell the person after it with a \`notify\` node`
    );
}
