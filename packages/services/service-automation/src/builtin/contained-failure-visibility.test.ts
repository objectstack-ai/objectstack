// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14456 — the visibility half of the ruled containment contract (#13681).
//
// `loop { body: [ try_catch { try, catch } ] }` is the containment spelling for
// a per-iteration failure that must not end the sweep (maintainer ruling
// 2026-08-31, branch B; there is deliberately no `loop.config.onIterationError`
// key). Containment already worked. What did not exist was any way to SEE what
// it contained: the measurement these tests reproduce (#13681) found a run that
// lost one row out of five reporting
//
//     status=completed selected=5 acted=9 skipped=0
//
// with nothing at run level naming the loss, the failing step carrying no
// iteration index, and `$error` binding no row identity at all. A sweep that
// lost two rows was indistinguishable from one that lost none.
//
// The fixture is that measurement's, on the real `AutomationEngine`: five rows,
// the THIRD one ownerless, `flag` always succeeding and `notify` failing on the
// ownerless row.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { FlowRunSummary } from '@objectstack/spec/automation';
import { TryCatchErrorValueSchema, FlowRunSummarySchema } from '@objectstack/spec/automation';
import { registerLoopNode } from './loop-node.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerLogicNodes } from './logic-nodes.js';
import { registerParallelNode } from './parallel-node.js';
import { registerSubflowNode } from './subflow-node.js';
import { formatRunSummaryLine, summarizeRun } from '../run-summary.js';

function silentLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}
const pluginCtx = (logger: any) => ({ logger, getService() { throw new Error('none'); } }) as any;

/** The five breached cases; the THIRD (index 2) is the one with no owner. */
const CASES = [
    { id: 'c1', owner: 'u1' },
    { id: 'c2', owner: 'u2' },
    { id: 'c3', owner: null },
    { id: 'c4', owner: 'u4' },
    { id: 'c5', owner: 'u5' },
];

describe('#14456 — a contained per-iteration failure is visible, attributed and bound', () => {
    let engine: AutomationEngine;
    let flagged: string[];
    let notified: string[];
    let caught: unknown[];

    /** Rows whose `owner` is null are the ones `notify` refuses. */
    function setup(cases: Array<{ id: string; owner: string | null }>): void {
        const logger = silentLogger();
        engine = new AutomationEngine(logger);
        flagged = [];
        notified = [];
        caught = [];

        registerLoopNode(engine, pluginCtx(logger));
        registerTryCatchNode(engine, pluginCtx(logger));
        registerLogicNodes(engine, pluginCtx(logger));
        registerParallelNode(engine, pluginCtx(logger));
        registerSubflowNode(engine, pluginCtx(logger));

        // Stands in for the `get_record` sweep query — seeds the collection and
        // reports `selected` the way a real query node does (#4354).
        engine.registerNodeExecutor({
            type: 'seed',
            async execute(_node, variables) {
                variables.set('cases', cases);
                return { success: true, metrics: { selected: cases.length } };
            },
        } as NodeExecutor);

        // "flag the breach" — always succeeds, writes one row. Its presence is
        // how the test reads "every iteration ran", independently of the fold.
        engine.registerNodeExecutor({
            type: 'flag',
            async execute(_node, variables) {
                flagged.push((variables.get('currentCase') as { id: string }).id);
                return { success: true, metrics: { acted: 1 } };
            },
        } as NodeExecutor);

        // "notify the owner" — fails on an ownerless row, as the real `notify`
        // builtin does when every recipient template resolves to nothing.
        engine.registerNodeExecutor({
            type: 'notify',
            async execute(_node, variables) {
                const c = variables.get('currentCase') as { id: string; owner: string | null };
                if (!c.owner) {
                    return { success: false, error: `notify: at least one recipient is required (${c.id})` };
                }
                notified.push(c.id);
                return { success: true, metrics: { acted: 1 } };
            },
        } as NodeExecutor);

        // The catch region's second node: an operator reading the binding. A
        // completed run does not hand its variable map back, so the assertion
        // has to happen inside the region — this is the only way to observe
        // `$error` at the moment the handler sees it.
        engine.registerNodeExecutor({
            type: 'capture',
            async execute(_node, variables) {
                caught.push(variables.get('$error'));
                return { success: true };
            },
        } as NodeExecutor);
    }

    /**
     * The card's shape: a `try_catch` per iteration, `assignment` as the
     * handler (the minimal working catch region), plus a `capture` probe.
     */
    const sweepFlow = (name: string) => ({
        name,
        label: name,
        type: 'autolaunched' as const,
        runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'query', type: 'seed', label: 'Query' },
            {
                id: 'each',
                type: 'loop',
                label: 'Each case',
                config: {
                    collection: '{cases}',
                    iteratorVariable: 'currentCase',
                    body: {
                        nodes: [
                            {
                                id: 'guard',
                                type: 'try_catch',
                                label: 'Guarded',
                                config: {
                                    try: {
                                        nodes: [
                                            { id: 'flag', type: 'flag', label: 'Flag' },
                                            { id: 'notify', type: 'notify', label: 'Notify' },
                                        ],
                                        edges: [{ id: 't1', source: 'flag', target: 'notify' }],
                                    },
                                    catch: {
                                        nodes: [
                                            { id: 'handled', type: 'assignment', label: 'Handled' },
                                            { id: 'seen', type: 'capture', label: 'Seen' },
                                        ],
                                        edges: [{ id: 'k1', source: 'handled', target: 'seen' }],
                                    },
                                },
                            },
                        ],
                        edges: [],
                    },
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'query' },
            { id: 'e2', source: 'query', target: 'each' },
            { id: 'e3', source: 'each', target: 'end' },
        ],
    });

    async function runSweep(cases = CASES) {
        setup(cases);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);
        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        const runs = await engine.listRuns('sweep');
        return { res, run: runs[0], summary: res.summary as FlowRunSummary };
    }

    // ── The measurement, reproduced ────────────────────────────────────────

    it('completes all five iterations and reports the one it lost (#13681 comment 5478851960)', async () => {
        const { res, run, summary } = await runSweep();

        // (a)/(b)/(c) of the measurement: contained, and every row processed.
        expect(res.success).toBe(true);
        expect(run.status).toBe('completed');
        expect(flagged).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
        expect(notified).toEqual(['c1', 'c2', 'c4', 'c5']);
        const bodySteps = run.steps.filter((s) => s.regionKind === 'loop-body');
        expect(bodySteps.map((s) => s.iteration)).toEqual([0, 1, 2, 3, 4]);

        // (d), the half that did not exist: the run-level count.
        expect(summary.failed).toBe(1);
        // …and it agrees with the breakdown it is declared to fold.
        expect(summary.failed).toBe(summary.nodes.reduce((n, node) => n + node.failures, 0));
        expect(summary.nodes.find((n) => n.nodeId === 'notify')).toMatchObject({ runs: 5, failures: 1 });
        // The container recovered, so IT did not fail — which is exactly why a
        // run-level counter was needed: `status` alone reports a clean sweep.
        expect(summary.nodes.find((n) => n.nodeId === 'guard')).toMatchObject({ runs: 5, failures: 0, status: 'success' });
    });

    it('counts two contained failures as two (the measurement\'s two-caught variant)', async () => {
        const { summary } = await runSweep([
            { id: 'c1', owner: 'u1' },
            { id: 'c2', owner: null },
            { id: 'c3', owner: null },
            { id: 'c4', owner: 'u4' },
            { id: 'c5', owner: 'u5' },
        ]);
        expect(summary.failed).toBe(2);
        expect(notified).toEqual(['c1', 'c4', 'c5']);
    });

    // ── Item 3: iteration through try_catch → runRegion ────────────────────

    it('tags the catch region\'s steps with the enclosing loop iteration, regionKind unchanged', async () => {
        const { run } = await runSweep();

        const handled = run.steps.filter((s) => s.nodeId === 'handled');
        expect(handled).toHaveLength(1);
        expect(handled[0]).toMatchObject({ parentNodeId: 'guard', regionKind: 'catch', iteration: 2 });
    });

    it('tags the try region\'s steps the same way — the failing step names its row', async () => {
        const { run } = await runSweep();

        const failing = run.steps.filter((s) => s.nodeId === 'notify' && s.status === 'failure');
        expect(failing).toHaveLength(1);
        expect(failing[0]).toMatchObject({ parentNodeId: 'guard', regionKind: 'try', iteration: 2 });

        // Every try-region step carries the row it ran for, not only the failing one.
        expect(run.steps.filter((s) => s.nodeId === 'flag').map((s) => s.iteration)).toEqual([0, 1, 2, 3, 4]);
    });

    // ── Item 4: `$error` binds the row ─────────────────────────────────────

    it('binds $error.iteration and $error.item to the row that failed', async () => {
        await runSweep();

        expect(caught).toHaveLength(1);
        expect(caught[0]).toMatchObject({ nodeId: 'guard', iteration: 2, item: CASES[2] });
        // The binding is the declared `TryCatchErrorValue`, not a shape of this
        // executor's own invention.
        expect(TryCatchErrorValueSchema.safeParse(caught[0]).success).toBe(true);
    });

    it('binds NEITHER outside a loop — absent means "not in a loop", never "row unknown"', async () => {
        setup(CASES);
        engine.registerFlow('bare', {
            name: 'bare', label: 'bare', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'guard', type: 'try_catch', label: 'Guarded',
                    config: {
                        try: { nodes: [{ id: 'notify', type: 'notify', label: 'Notify' }], edges: [] },
                        catch: { nodes: [{ id: 'seen', type: 'capture', label: 'Seen' }], edges: [] },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'guard' },
                { id: 'e2', source: 'guard', target: 'end' },
            ],
        } as never);
        // No loop, so nothing binds `currentCase`; `notify` refuses it.
        await engine.execute('bare', { event: 'manual' } as AutomationContext);

        expect(caught).toHaveLength(1);
        expect(caught[0]).not.toHaveProperty('iteration');
        expect(caught[0]).not.toHaveProperty('item');
    });

    it('does not leak a parent run\'s row identity into a subflow child (#14456)', async () => {
        setup(CASES);
        // The child owns the try_catch; the PARENT owns the loop. The child run
        // gets its own variable scope, so the frame the parent published is not
        // the child's — the binding must report no row.
        engine.registerFlow('child', {
            name: 'child', label: 'child', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'guard', type: 'try_catch', label: 'Guarded',
                    config: {
                        try: { nodes: [{ id: 'notify', type: 'notify', label: 'Notify' }], edges: [] },
                        catch: { nodes: [{ id: 'seen', type: 'capture', label: 'Seen' }], edges: [] },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'guard' },
                { id: 'e2', source: 'guard', target: 'end' },
            ],
        } as never);
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'query', type: 'seed', label: 'Query' },
                {
                    id: 'each', type: 'loop', label: 'Each',
                    config: {
                        collection: '{cases}', iteratorVariable: 'currentCase',
                        body: {
                            nodes: [{ id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child' } }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'query' },
                { id: 'e2', source: 'query', target: 'each' },
                { id: 'e3', source: 'each', target: 'end' },
            ],
        } as never);

        await engine.execute('parent', { event: 'schedule' } as AutomationContext);

        expect(caught.length).toBeGreaterThan(0);
        for (const bound of caught) {
            expect(bound).not.toHaveProperty('iteration');
            expect(bound).not.toHaveProperty('item');
        }
    });

    // ── The fence: `parallel` is untouched ─────────────────────────────────

    it('leaves `parallel` branch tagging exactly as it was — the #14414 fence', async () => {
        setup(CASES);
        engine.registerFlow('par', {
            name: 'par', label: 'par', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'query', type: 'seed', label: 'Query' },
                {
                    id: 'each', type: 'loop', label: 'Each',
                    config: {
                        collection: '{cases}', iteratorVariable: 'currentCase',
                        body: {
                            nodes: [{
                                id: 'fan', type: 'parallel', label: 'Fan',
                                config: {
                                    branches: [
                                        { name: 'a', nodes: [{ id: 'flag', type: 'flag', label: 'Flag' }], edges: [] },
                                        { name: 'b', nodes: [{ id: 'noop', type: 'assignment', label: 'Noop' }], edges: [] },
                                    ],
                                },
                            }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'query' },
                { id: 'e2', source: 'query', target: 'each' },
                { id: 'e3', source: 'each', target: 'end' },
            ],
        } as never);

        await engine.execute('par', { event: 'schedule' } as AutomationContext);
        const run = (await engine.listRuns('par'))[0];

        // A branch step still carries its BRANCH index on `iteration` and
        // `regionKind: 'parallel-branch'`, five times over (once per row) — the
        // pre-existing overload #14414 owns. Nothing here changed it.
        const branchSteps = run.steps.filter((s) => s.regionKind === 'parallel-branch');
        expect(branchSteps).toHaveLength(10);
        expect(branchSteps.filter((s) => s.nodeId === 'flag').every((s) => s.iteration === 0)).toBe(true);
        expect(branchSteps.filter((s) => s.nodeId === 'noop').every((s) => s.iteration === 1)).toBe(true);
    });
});

// ── Item 5 + the `unmeasured` convention ───────────────────────────────────

describe('#14456 — `failed=` on the summary line, and the absent convention', () => {
    const AT = '2026-09-04T00:00:00.000Z';
    const params = { flowName: 'sweep', runId: 'run_1', status: 'completed' };

    it('prints `failed=N` for a summary that carries the count', () => {
        const line = formatRunSummaryLine(params, summarizeRun([
            { nodeId: 'q', nodeType: 'seed', status: 'success', startedAt: AT, metrics: { selected: 5 } },
            { nodeId: 'notify', nodeType: 'notify', status: 'failure', startedAt: AT },
        ]));
        expect(line).toBe('[automation] run flow=sweep run=run_1 status=completed selected=5 acted=0 skipped=0 failed=1');
    });

    it('prints `failed=0` when the count is present and zero — "nothing failed" is a reading', () => {
        const line = formatRunSummaryLine(params, summarizeRun([
            { nodeId: 'w', nodeType: 'assignment', status: 'success', startedAt: AT, metrics: { acted: 1 } },
        ]));
        expect(line).toContain('failed=0');
    });

    it('prints NOTHING for a summary recorded before the count existed', () => {
        // Absent is "not tracked", not zero — the same convention `unmeasured`
        // carries, and the one a default would erase.
        const older: FlowRunSummary = { selected: 5, acted: 9, skipped: 0, unmeasured: 0, nodes: [], gates: [] };
        expect(formatRunSummaryLine(params, older)).not.toContain('failed');
    });

    it('a row persisted before this change still parses, with `failed` ABSENT — no migration, no default', () => {
        const stored = { selected: 5, acted: 9, skipped: 0, unmeasured: 0, nodes: [], gates: [] };
        const parsed = FlowRunSummarySchema.safeParse(stored);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.failed).toBeUndefined();
        expect('failed' in (parsed.data ?? {})).toBe(false);
    });

    it('summarizeRun always emits the count, `0` included — only stored rows are absent', () => {
        const s = summarizeRun([{ nodeId: 'w', nodeType: 'assignment', status: 'success', startedAt: AT }]);
        expect(s.failed).toBe(0);
        expect(FlowRunSummarySchema.safeParse(s).success).toBe(true);
    });
});
