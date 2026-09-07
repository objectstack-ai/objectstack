// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15616 — a `map` node inside a `loop` body ran its collection ONCE.
//
// `map` tracks its progress through the collection in `<nodeId>.$mapState`,
// which it wrote into the flow's **shared** variable scope and never removed.
// A `loop` body region runs in that same scope (`runRegion` is handed the
// caller's map, deliberately — the iterator variable and body mutations have to
// be visible), so the state written by iteration 1 was still there when
// iteration 2 entered the map: `started === collection.length`, nothing left to
// start, return success. Iterations 2..n ran nothing, every map step reported
// `success`, and the run finished `completed`.
//
// The measurement these tests reproduce, on the real `AutomationEngine`:
// **5 iterations × 2 items ⇒ 2 child runs instead of 10**, with `failed = 0`.
// That last clause is why this needed its own card rather than riding #14456:
// nothing throws, nothing is caught, so `FlowRunSummary.failed` — the counter
// built to expose silently-contained failures — reports a clean run over it.
//
// ⚠️ The lifetime is the point, not the key. `$mapState` MUST survive a durable
// pause: a `map` whose per-item child run paused resumes by re-entering this
// node and reading that state back. What it must not do is survive the node's
// own completion. Both halves are pinned here — the last test fails if the fix
// is spelled as an unconditional delete.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerLoopNode } from './loop-node.js';
import { registerMapNode } from './map-node.js';

function silentLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}
const pluginCtx = (logger: any) => ({ logger, getService() { throw new Error('none'); } }) as any;

/** The card's fixture: five loop iterations, two mapped items each. */
const ROWS = ['r1', 'r2', 'r3', 'r4', 'r5'];
const CELLS = ['a', 'b'];

interface Harness {
    engine: AutomationEngine;
    /** One entry per CHILD RUN that actually executed, in order: `row:cell`. */
    ran: string[];
    /** Per loop iteration: what the body observed after the map node returned. */
    observed: Array<{ results: unknown; stateKeyPresent: boolean }>;
}

/**
 * `loop { body: [ map { flowName: cell_flow }, probe ] }` over the real engine.
 *
 * `probe` sits after the map INSIDE the body region, so it reads the same
 * shared scope the map just wrote — which is how the state key's lifetime is
 * observed directly rather than inferred from the child-run count.
 */
function setup(): Harness {
    const logger = silentLogger();
    const engine = new AutomationEngine(logger);
    registerLoopNode(engine, pluginCtx(logger));
    registerMapNode(engine, pluginCtx(logger));

    const ran: string[] = [];
    const observed: Array<{ results: unknown; stateKeyPresent: boolean }> = [];

    // The child flow's only node: records that this child run happened.
    engine.registerNodeExecutor({
        type: 'cellmark',
        async execute(_node, variables, context) {
            const p = (context as any)?.params ?? {};
            ran.push(`${p.row}:${p.cell}`);
            variables.set('result', `${p.row}:${p.cell}`);
            return { success: true };
        },
    } as NodeExecutor);

    // Loop-body probe, downstream of the map in the SAME region scope.
    engine.registerNodeExecutor({
        type: 'probe',
        async execute(_node, variables) {
            observed.push({
                results: variables.get('cellResults'),
                stateKeyPresent: variables.has('per_cell.$mapState'),
            });
            return { success: true };
        },
    } as NodeExecutor);

    engine.registerFlow('cell_flow', {
        name: 'cell_flow',
        label: 'Cell',
        type: 'autolaunched',
        variables: [{ name: 'result', type: 'text', isOutput: true }],
        nodes: [
            { id: 'cs', type: 'start', label: 'Start' },
            { id: 'cm', type: 'cellmark', label: 'Mark' },
            { id: 'ce', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'c1', source: 'cs', target: 'cm' },
            { id: 'c2', source: 'cm', target: 'ce' },
        ],
    } as never);

    engine.registerFlow('sweep_flow', {
        name: 'sweep_flow',
        label: 'Sweep',
        type: 'autolaunched',
        variables: [
            { name: 'rows', type: 'list', isInput: true },
            { name: 'cells', type: 'list', isInput: true },
        ],
        nodes: [
            { id: 'ss', type: 'start', label: 'Start' },
            {
                id: 'sweep', type: 'loop', label: 'For each row',
                config: {
                    collection: '{rows}',
                    iteratorVariable: 'row',
                    body: {
                        nodes: [
                            {
                                id: 'per_cell', type: 'map', label: 'For each cell',
                                config: {
                                    flowName: 'cell_flow',
                                    collection: '{cells}',
                                    iteratorVariable: 'cell',
                                    input: { row: '{row}', cell: '{cell}' },
                                    outputVariable: 'cellResults',
                                },
                            },
                            { id: 'probe', type: 'probe', label: 'Probe' },
                        ],
                        edges: [{ id: 'be', source: 'per_cell', target: 'probe' }],
                    },
                },
            },
            { id: 'se', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 's1', source: 'ss', target: 'sweep' },
            { id: 's2', source: 'sweep', target: 'se' },
        ],
    } as never);

    return { engine, ran, observed };
}

describe('#15616 — a `map` in a `loop` body runs its collection on EVERY iteration', () => {
    it("runs 5 iterations x 2 items as 10 child runs (the card's measurement: it was 2)", async () => {
        const { engine, ran } = setup();

        const result = await engine.execute('sweep_flow', { params: { rows: ROWS, cells: CELLS } });

        expect(result.success).toBe(true);
        // The defect's signature was `ran.length === 2` — row r1 only, with
        // rows r2..r5 contributing nothing at all.
        expect(ran).toEqual([
            'r1:a', 'r1:b', 'r2:a', 'r2:b', 'r3:a', 'r3:b', 'r4:a', 'r4:b', 'r5:a', 'r5:b',
        ]);
        expect(ran).toHaveLength(ROWS.length * CELLS.length);
    });

    it('reports the run green with `failed = 0` either way — the counter cannot see this defect', async () => {
        const { engine, ran } = setup();

        const result = await engine.execute('sweep_flow', { params: { rows: ROWS, cells: CELLS } });
        const runs = await engine.listRuns('sweep_flow');

        // Both halves of the card's point, asserted together: the run really is
        // clean (nothing throws, nothing is caught, so #14456's fold reports 0)
        // AND the work really happened. Before the fix the first half held and
        // the second did not — which is exactly why `failed` could not be the
        // instrument that caught it.
        expect(runs[0]?.status).toBe('completed');
        expect(result.summary?.failed).toBe(0);
        expect(ran).toHaveLength(10);
    });

    it('collects a FRESH result set per iteration, and leaves no progress state behind', async () => {
        const { engine, observed } = setup();

        await engine.execute('sweep_flow', { params: { rows: ROWS, cells: CELLS } });

        expect(observed).toHaveLength(ROWS.length);
        // Each iteration's `outputVariable` holds that iteration's two items —
        // not the first iteration's results re-read, and not an accumulation.
        expect(observed.map(o => o.results)).toEqual(
            ROWS.map(r => [{ result: `${r}:a` }, { result: `${r}:b` }]),
        );
        // The mechanism itself: once the collection is exhausted the node's
        // progress state is gone from the shared scope, so the next entry to
        // this node starts from zero. This is the assertion that fails on the
        // unfixed engine even if the child-run count somehow did not.
        expect(observed.map(o => o.stateKeyPresent)).toEqual(ROWS.map(() => false));
    });
});

/**
 * The other half of the lifetime — and the reason "delete the state key" is
 * only correct on the node's TERMINAL paths.
 *
 * A `map` whose per-item child run pauses suspends the parent at this node and
 * is re-entered when the child completes; the re-entry reads its progress back
 * out of the suspend-time snapshot. `resumeInternal` rebuilds the scope with
 * `new Map(Object.entries(run.variables))`, so the ONLY write that can reach a
 * resume is the one the node makes before returning `suspend: true`. An
 * unconditional delete removes it and the resumed map restarts the collection
 * from item 0 — re-running every item that already ran.
 *
 * (A pausing `map` is unreachable from inside a `loop` body: `runRegion`
 * converts a durable pause inside a structured region into an error. So this
 * fixture is a TOP-LEVEL map, which is where the resume path is live.)
 */
describe('#15616 — the progress state still survives a durable pause (the half that must NOT change)', () => {
    function pausingSetup() {
        const logger = silentLogger();
        const engine = new AutomationEngine(logger);
        registerMapNode(engine, pluginCtx(logger));
        // The durable store is read directly below: `listSuspendedRuns()`
        // deliberately projects away `variables`, and the snapshot is the exact
        // object `resumeInternal` rebuilds the scope from.
        const store = new InMemorySuspendedRunStore();
        engine.setSuspendedRunStore(store);

        const ran: string[] = [];
        let doneResults: unknown;
        let stateKeyAfterCompletion: boolean | undefined;

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
                ran.push(String(p.cell));
                variables.set('result', String(p.cell));
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'after',
            async execute(_node, variables) {
                doneResults = variables.get('cellResults');
                stateKeyAfterCompletion = variables.has('per_cell.$mapState');
                return { success: true };
            },
        } as NodeExecutor);

        engine.registerFlow('cell_flow', {
            name: 'cell_flow', label: 'Cell', type: 'autolaunched',
            variables: [{ name: 'result', type: 'text', isOutput: true }],
            nodes: [
                { id: 'cs', type: 'start', label: 'Start' },
                { id: 'cp', type: 'pauser', label: 'Pause' },
                { id: 'cm', type: 'cellmark', label: 'Mark' },
                { id: 'ce', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'c1', source: 'cs', target: 'cp' },
                { id: 'c2', source: 'cp', target: 'cm' },
                { id: 'c3', source: 'cm', target: 'ce' },
            ],
        } as never);
        engine.registerFlow('batch_flow', {
            name: 'batch_flow', label: 'Batch', type: 'autolaunched',
            variables: [{ name: 'cells', type: 'list', isInput: true }],
            nodes: [
                { id: 'bs', type: 'start', label: 'Start' },
                {
                    id: 'per_cell', type: 'map', label: 'For each cell',
                    config: {
                        flowName: 'cell_flow', collection: '{cells}', iteratorVariable: 'cell',
                        input: { cell: '{cell}' }, outputVariable: 'cellResults',
                    },
                },
                { id: 'af', type: 'after', label: 'After' },
                { id: 'be', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'b1', source: 'bs', target: 'per_cell' },
                { id: 'b2', source: 'per_cell', target: 'af' },
                { id: 'b3', source: 'af', target: 'be' },
            ],
        } as never);

        return {
            engine, store, ran,
            results: () => doneResults,
            stateKeyAfterCompletion: () => stateKeyAfterCompletion,
        };
    }

    const childRunId = (engine: AutomationEngine) =>
        engine.listSuspendedRuns().find(r => r.flowName === 'cell_flow')?.runId;

    it('carries `$mapState` into the suspend snapshot and resumes the collection where it left off', async () => {
        const h = pausingSetup();

        // Item 0 pauses → the parent parks at the map node.
        const first = await h.engine.execute('batch_flow', { params: { cells: ['a', 'b', 'c'] } });
        expect(first.status).toBe('paused');

        // The state is in the SNAPSHOT the resume will rebuild the scope from —
        // already advanced past the in-flight item (ADR-0019).
        const parked = h.engine.listSuspendedRuns().find(r => r.flowName === 'batch_flow')!;
        expect(parked.nodeId).toBe('per_cell');
        const snapshot = await h.store.load(parked.runId);
        expect(snapshot!.variables['per_cell.$mapState']).toMatchObject({ started: 1 });

        // Drive the three items through. Each resume re-enters the map, which
        // must read its progress back — not restart from item 0.
        await h.engine.resume(childRunId(h.engine)!);
        await h.engine.resume(childRunId(h.engine)!);
        await h.engine.resume(childRunId(h.engine)!);

        // Every item ran EXACTLY once, in order.
        expect(h.ran).toEqual(['a', 'b', 'c']);
        expect(h.results()).toEqual([{ result: 'a' }, { result: 'b' }, { result: 'c' }]);
        // …and once the collection is exhausted the state is gone again.
        expect(h.stateKeyAfterCompletion()).toBe(false);
        expect(h.engine.listSuspendedRuns()).toHaveLength(0);
    });
});
