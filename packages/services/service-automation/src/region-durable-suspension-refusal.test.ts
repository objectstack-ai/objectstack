// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #18881 — the RUNTIME half of #15646's ruling D (director batch #153 item 1).
//
// A node contained in a structured region body (`loop`, a `parallel` branch,
// `try_catch`'s try or catch, at any depth) that DURABLY SUSPENDS must fail the
// run with a named, structured error carrying the region node id, the
// suspending node id and the sub-flow name. #3267 ruled the limit 禁 —
// structured regions do not carry a durable pause — and this is its loud form.
//
// ## What was measured before the fix, on the card's own reproduction
//
// `loop { try_catch { map(pausing child) } }`: `runRegion` converted the
// suspension into a PLAIN `Error`, the enclosing `try_catch` read that as "the
// try region failed" and ran its catch handler, and the run finished
// `completed` with `summary.failed = 0`. The `map`'s progress state
// (`<nodeId>.$mapState`) stayed in the enclosing scope, so the next iteration
// read `started === collection.length`, ran nothing, and reported success. A
// sweep that reports green having processed nothing is the failure this closes.
//
// ⛔ The parse-time half is NOT here and is not re-litigated: #18688 landed it
// in `packages/spec` and it refuses `screen` / `wait` / `approval` /
// `approval_revise` / `end` inside a region body by TYPE. `map` and `subflow`
// are deliberately NOT refused there — whether they pause is decided by the
// child flow record their `config.flowName` names, which no parse holds — so
// every fixture below is still declarable, and that is precisely why the
// runtime arm has to exist.
//
// ⚠️ The CONTROL is not optional (the card says so in those words): the same
// shape over a SYNCHRONOUS child must keep running exactly as it does today.
// Without it a reader cannot tell "the durable pause is refused" from "the
// region path was closed off".

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerParallelNode } from './builtin/parallel-node.js';
import { registerTryCatchNode } from './builtin/try-catch-node.js';

function silentLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}
const pluginCtx = (logger: any) => ({ logger, getService() { throw new Error('none'); } }) as any;

/** #15616's fixture dimensions, kept identical so the two cards read as one shape. */
const ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'];
const CELLS = ['a', 'b'];

interface Harness {
    engine: AutomationEngine;
    /** One entry per CHILD RUN that actually executed, in order: `row:cell`. */
    ran: string[];
    /** One entry per entry to the `try_catch` node's CATCH handler. */
    recovered: string[];
    /** One entry per loop-body probe pass, downstream of the region. */
    probed: number[];
}

/**
 * Build the engine, the child flow and the shared executors.
 *
 * `pausing` decides the ONE thing under test: whether the child flow parks on a
 * durable pause. Everything else — the graph, the collection, the executors —
 * is byte-identical between the defect fixture and its control.
 */
function base(pausing: boolean): Harness & { registerParent: (flow: unknown) => void } {
    const logger = silentLogger();
    const engine = new AutomationEngine(logger);
    registerLoopNode(engine, pluginCtx(logger));
    registerMapNode(engine, pluginCtx(logger));
    registerParallelNode(engine, pluginCtx(logger));
    registerTryCatchNode(engine, pluginCtx(logger));
    engine.setSuspendedRunStore(new InMemorySuspendedRunStore());

    const ran: string[] = [];
    const recovered: string[] = [];
    const probed: number[] = [];

    engine.registerNodeExecutor({
        type: 'pauser',
        descriptor: defineActionDescriptor({
            type: 'pauser', version: '1.0.0', name: 'pauser',
            supportsPause: true, resumeAuthority: 'any',
        }),
        async execute() { return { success: true, suspend: true }; },
    } as NodeExecutor);
    engine.registerNodeExecutor({
        type: 'cellmark',
        async execute(_node, variables, context) {
            const p = (context as any)?.params ?? {};
            ran.push(`${p.row}:${p.cell}`);
            variables.set('result', `${p.row}:${p.cell}`);
            return { success: true };
        },
    } as NodeExecutor);
    engine.registerNodeExecutor({
        type: 'recover',
        async execute(_node, variables) {
            recovered.push(String(variables.get('row') ?? '?'));
            return { success: true };
        },
    } as NodeExecutor);
    engine.registerNodeExecutor({
        type: 'probe',
        async execute() { probed.push(probed.length); return { success: true }; },
    } as NodeExecutor);

    engine.registerFlow('cell_flow', {
        name: 'cell_flow',
        label: 'Cell',
        type: 'autolaunched',
        variables: [{ name: 'result', type: 'text', isOutput: true }],
        nodes: [
            { id: 'cs', type: 'start', label: 'Start' },
            ...(pausing ? [{ id: 'cp', type: 'pauser', label: 'Pause' }] : []),
            { id: 'cm', type: 'cellmark', label: 'Mark' },
            { id: 'ce', type: 'end', label: 'End' },
        ],
        edges: pausing
            ? [
                { id: 'c1', source: 'cs', target: 'cp' },
                { id: 'c2', source: 'cp', target: 'cm' },
                { id: 'c3', source: 'cm', target: 'ce' },
            ]
            : [
                { id: 'c1', source: 'cs', target: 'cm' },
                { id: 'c2', source: 'cm', target: 'ce' },
            ],
    } as never);

    return { engine, ran, recovered, probed, registerParent: (flow) => engine.registerFlow('sweep_flow', flow as never) };
}

/** The mapped node, shared by every parent graph below. */
const MAP_NODE = {
    id: 'per_cell', type: 'map', label: 'For each cell',
    config: {
        flowName: 'cell_flow',
        collection: '{cells}',
        iteratorVariable: 'cell',
        input: { row: '{row}', cell: '{cell}' },
        outputVariable: 'cellResults',
    },
} as const;

const PARENT_VARIABLES = [
    { name: 'rows', type: 'list', isInput: true },
    { name: 'cells', type: 'list', isInput: true },
] as const;

/** #15646's exact reproduction: `loop { try_catch { map } }` — depth 2. */
function containedSetup(pausing: boolean): Harness {
    const h = base(pausing);
    h.registerParent({
        name: 'sweep_flow', label: 'Sweep', type: 'autolaunched',
        variables: PARENT_VARIABLES,
        nodes: [
            { id: 'ss', type: 'start', label: 'Start' },
            {
                id: 'sweep', type: 'loop', label: 'For each row',
                config: {
                    collection: '{rows}', iteratorVariable: 'row',
                    body: {
                        nodes: [
                            {
                                id: 'guard', type: 'try_catch', label: 'Contain the row',
                                config: {
                                    try: { nodes: [MAP_NODE], edges: [] },
                                    catch: {
                                        nodes: [{ id: 'rec', type: 'recover', label: 'Recover' }],
                                        edges: [],
                                    },
                                },
                            },
                            { id: 'probe', type: 'probe', label: 'Probe' },
                        ],
                        edges: [{ id: 'be', source: 'guard', target: 'probe' }],
                    },
                },
            },
            { id: 'se', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 's1', source: 'ss', target: 'sweep' },
            { id: 's2', source: 'sweep', target: 'se' },
        ],
    });
    return h;
}

/** `loop { map }` — depth 1, the region kind a `loop` body is. */
function loopBodySetup(pausing: boolean): Harness {
    const h = base(pausing);
    h.registerParent({
        name: 'sweep_flow', label: 'Sweep', type: 'autolaunched',
        variables: PARENT_VARIABLES,
        nodes: [
            { id: 'ss', type: 'start', label: 'Start' },
            {
                id: 'sweep', type: 'loop', label: 'For each row',
                config: {
                    collection: '{rows}', iteratorVariable: 'row',
                    body: { nodes: [MAP_NODE], edges: [] },
                },
            },
            { id: 'se', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 's1', source: 'ss', target: 'sweep' },
            { id: 's2', source: 'sweep', target: 'se' },
        ],
    });
    return h;
}

/** `parallel { branch: [map] }` — the third region kind. */
function parallelBranchSetup(pausing: boolean): Harness {
    const h = base(pausing);
    h.registerParent({
        name: 'sweep_flow', label: 'Sweep', type: 'autolaunched',
        variables: PARENT_VARIABLES,
        nodes: [
            { id: 'ss', type: 'start', label: 'Start' },
            {
                id: 'fan', type: 'parallel', label: 'Fan out',
                // Two branches, because `validateControlFlow` refuses a
                // `parallel` with fewer — the sibling branch is also the
                // control for "the region refusal is not simply every branch
                // failing": it completes normally either way.
                config: {
                    branches: [
                        { nodes: [MAP_NODE], edges: [] },
                        { nodes: [{ id: 'sibling', type: 'probe', label: 'Sibling' }], edges: [] },
                    ],
                },
            },
            { id: 'se', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 's1', source: 'ss', target: 'fan' },
            { id: 's2', source: 'fan', target: 'se' },
        ],
    });
    return h;
}

const run = (h: Harness) =>
    h.engine.execute('sweep_flow', { params: { rows: ROWS, cells: CELLS } });

describe('#18881 — a durable suspension inside a structured region FAILS the run', () => {
    it("the card's reproduction: `loop { try_catch { map(pausing) } }` fails, and the catch handler never sees it", async () => {
        const h = containedSetup(true);

        const result = await run(h);
        const runs = await h.engine.listRuns('sweep_flow');

        // The headline: the run FAILS. Before this card it reported
        // `completed` — the `try_catch` swallowed the region's refusal.
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(runs[0]?.status).toBe('failed');
        // ⛔ Never `success` with nothing run: the catch handler must not be
        // handed a region refusal, and the loop must not go on to iteration 2.
        expect(h.recovered).toEqual([]);
        expect(h.probed).toEqual([]);
    });

    it('the error NAMES the region node, the suspending node and the sub-flow', async () => {
        const h = containedSetup(true);

        const result = await run(h);

        // Three names, each independently checkable — an operator who reads
        // only the run row can find the region, the node inside it, and the
        // child flow whose pause could not be carried.
        expect(result.error).toContain('guard');
        expect(result.error).toContain('per_cell');
        expect(result.error).toContain('cell_flow');
    });

    it('counts the refusal ONCE: `summary.failed = 1`, on the region node', async () => {
        const h = containedSetup(true);

        const result = await run(h);

        // The counter #14456 built to expose silently-contained failures now
        // sees this one. Exactly 1: the region that could not carry the pause,
        // ⛔ not one per enclosing container the unwind passes through.
        expect(result.summary?.failed).toBe(1);
        const failing = result.summary?.nodes?.filter(n => n.failures > 0) ?? [];
        expect(failing.map(n => n.nodeId)).toEqual(['guard']);
    });

    it('CONTROL — the same shape over a SYNCHRONOUS child runs exactly as today', async () => {
        const h = containedSetup(false);

        const result = await run(h);
        const runs = await h.engine.listRuns('sweep_flow');

        // #15616's measurement, on this card's graph: 5 iterations x 2 items
        // ⇒ 10 child runs, a clean run, nothing caught.
        expect(result.success).toBe(true);
        expect(runs[0]?.status).toBe('completed');
        expect(result.summary?.failed).toBe(0);
        expect(h.ran).toHaveLength(ROWS.length * CELLS.length);
        expect(h.recovered).toEqual([]);
        expect(h.probed).toHaveLength(ROWS.length);
    });
});

describe('#18881 — the same refusal in the other two region kinds', () => {
    it('`loop { map(pausing) }` — the region node is the `loop`', async () => {
        const h = loopBodySetup(true);

        const result = await run(h);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('sweep');
        expect(result.error).toContain('per_cell');
        expect(result.error).toContain('cell_flow');
        expect(result.summary?.failed).toBe(1);
    });

    it('CONTROL — `loop { map(synchronous) }` still runs its collection every iteration', async () => {
        const h = loopBodySetup(false);

        const result = await run(h);

        expect(result.success).toBe(true);
        expect(result.summary?.failed).toBe(0);
        expect(h.ran).toHaveLength(ROWS.length * CELLS.length);
    });

    it('`parallel { branch: [map(pausing)] }` — the region node is the `parallel`', async () => {
        const h = parallelBranchSetup(true);

        const result = await run(h);

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('fan');
        expect(result.error).toContain('per_cell');
        expect(result.error).toContain('cell_flow');
        expect(result.summary?.failed).toBe(1);
    });

    it('CONTROL — `parallel { branch: [map(synchronous)] }` still completes', async () => {
        const h = parallelBranchSetup(false);

        const result = await run(h);

        expect(result.success).toBe(true);
        expect(result.summary?.failed).toBe(0);
        expect(h.ran).toHaveLength(CELLS.length);
    });
});
