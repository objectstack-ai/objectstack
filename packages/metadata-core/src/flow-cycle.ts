// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE judge of an undeclared cycle in a flow's top-level graph (ADR-0044).
 *
 * A flow is a DAG once its declared back edges (`type: 'back'`) are set aside:
 * an author opts a rework loop in edge by edge, and an unmarked cycle is
 * refused. The automation engine refuses to REGISTER such a flow
 * (`AutomationEngine.detectCycles`, `@objectstack/service-automation`). Until
 * this module the judgement lived only there, so the metadata draft read said
 * `valid: true` and the publish doors published a flow the engine then refused,
 * and it never ran.
 *
 * Every door now asks this function: the engine at registration, and the
 * runtime authoring gate (`@objectstack/metadata-protocol`) that the draft
 * verdict and every publish door run. Both depend on this package, which
 * depends on `@objectstack/spec` alone, so neither face pulls the other's code
 * in. Both answer with {@link FlowUndeclaredCycle.message}, so the author reads
 * the same sentence wherever the flow is refused.
 *
 * Scope: the flow's own `nodes` / `edges`. Cycles inside an ADR-0031 region
 * (a `loop` body, a `parallel` branch, a `try_catch` region) are judged by the
 * spec's `validateControlFlow`, not here.
 */

/** The structural slice of a flow node this judge reads. */
export interface FlowCycleNode {
    readonly id: string;
}

/** The structural slice of a flow edge this judge reads. */
export interface FlowCycleEdge {
    readonly source: string;
    readonly target: string;
    /** `'back'` sets the edge aside (ADR-0044); absent reads as the schema's `'default'`. */
    readonly type?: string;
}

/** What the judge finds: the first undeclared cycle, located. */
export interface FlowUndeclaredCycle {
    /**
     * The cycle as a node-id walk that starts and ends on the same node —
     * `['push', 'check', 'revise', 'push']`.
     */
    readonly path: readonly string[];
    /**
     * The index in `edges` of the edge that closes the cycle (the walk's last
     * step), so a door can locate the refusal on the edge an author would
     * mark `back`.
     */
    readonly closingEdgeIndex: number;
    /** The refusal, the same sentence at every door. */
    readonly message: string;
}

/** The refusal sentence for a cycle walk; the engine's registration error since ADR-0044. */
export function undeclaredFlowCycleMessage(path: readonly string[]): string {
    return (
        `Flow contains a cycle: ${path.join(' → ')}. Only DAG flows are allowed — ` +
        `to author an intentional rework loop, mark the cycle-closing edge with type: 'back' (ADR-0044).`
    );
}

/**
 * Find the first cycle in a flow's top-level graph once its `back` edges are
 * set aside, or `null` when there is none.
 *
 * Depth-first with white/gray/black colouring, nodes visited in declaration
 * order and edges followed in declaration order, so the cycle reported is the
 * one the engine has always named. An edge whose source or target names no
 * node takes no part (a dangling endpoint is another check's refusal).
 */
export function findUndeclaredFlowCycle(flow: {
    readonly nodes: readonly FlowCycleNode[];
    readonly edges: readonly FlowCycleEdge[];
}): FlowUndeclaredCycle | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string>();

    const adj = new Map<string, string[]>();
    for (const node of flow.nodes) {
        color.set(node.id, WHITE);
        adj.set(node.id, []);
    }
    for (const edge of flow.edges) {
        if (edge.type === 'back') continue; // ADR-0044 declared back-edge
        const targets = adj.get(edge.source);
        if (targets) targets.push(edge.target);
    }

    const dfs = (nodeId: string): string[] | null => {
        color.set(nodeId, GRAY);
        for (const neighbor of adj.get(nodeId) ?? []) {
            if (color.get(neighbor) === GRAY) {
                // Back edge found — reconstruct the cycle.
                const cycle = [neighbor, nodeId];
                let cur = nodeId;
                while (cur !== neighbor) {
                    cur = parent.get(cur)!;
                    if (cur) cycle.push(cur);
                    else break;
                }
                return cycle.reverse();
            }
            if (color.get(neighbor) === WHITE) {
                parent.set(neighbor, nodeId);
                const result = dfs(neighbor);
                if (result) return result;
            }
        }
        color.set(nodeId, BLACK);
        return null;
    };

    for (const node of flow.nodes) {
        if (color.get(node.id) !== WHITE) continue;
        const path = dfs(node.id);
        if (!path) continue;
        const from = path[path.length - 2];
        const to = path[path.length - 1];
        const closingEdgeIndex = flow.edges.findIndex(
            (edge) => edge.type !== 'back' && edge.source === from && edge.target === to,
        );
        return { path, closingEdgeIndex, message: undeclaredFlowCycleMessage(path) };
    }
    return null;
}
