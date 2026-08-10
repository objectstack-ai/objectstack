// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4354 — per-run summaries. The premise: a scheduled flow that selects records
// and acts on none is INDISTINGUISHABLE from one with nothing to do. Both report
// success, both write nothing, both stay silent. These tests pin the three
// surfaces that separate them — a structured log line, a value on the run
// result, and queryable columns on `sys_automation_run` — and the counters they
// all read.

import { describe, it, expect } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AutomationEngine } from './engine.js';
import type { StepLogEntry, NodeExecutor, RunRecord } from './engine.js';
import { summarizeRun, formatRunSummaryLine } from './run-summary.js';
import { InMemorySuspendedRunStore, ObjectStoreSuspendedRunStore } from './suspended-run-store.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { registerLogicNodes } from './builtin/logic-nodes.js';
import { registerNotifyNode } from './builtin/notify-node.js';
import { registerSubflowNode } from './builtin/subflow-node.js';
import { registerMapNode } from './builtin/map-node.js';
import { registerHttpNodes } from './builtin/http-nodes.js';
import { registerConnectorNodes } from './builtin/connector-nodes.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/**
 * `resumeAuthority: 'any'` is required of a pausing fixture since #5561: these
 * tests continue their pause through the public `resume` door, which a node type
 * now opts into rather than inherits. Nothing here is about the resume gate
 * (`resume-authority-gate.test.ts` owns that), so the fixture states the posture
 * it relies on — the same declaration the pausing built-ins carry.
 */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

const AT = '2026-07-31T00:00:00.000Z';

function makeLogger(): any {
    const info: Array<{ msg: string; meta?: any }> = [];
    const debug: Array<{ msg: string; meta?: any }> = [];
    const l: any = {
        info(msg: string, meta?: any) { info.push({ msg, meta }); },
        debug(msg: string, meta?: any) { debug.push({ msg, meta }); },
        warn() {},
        error() {},
    };
    l.child = () => l;
    l.lines = info;
    l.debugLines = debug;
    return l;
}

const step = (over: Partial<StepLogEntry> & { nodeId: string }): StepLogEntry => ({
    nodeType: 'noop',
    status: 'success',
    startedAt: AT,
    ...over,
});

// ── The fold ────────────────────────────────────────────────────────────────

describe('summarizeRun', () => {
    it('sums selected / acted across the run', () => {
        const s = summarizeRun([
            step({ nodeId: 'query', nodeType: 'get_record', metrics: { selected: 30 } }),
            step({ nodeId: 'write', nodeType: 'create_record', metrics: { acted: 1 } }),
            step({ nodeId: 'write2', nodeType: 'update_record', metrics: { acted: 4 } }),
        ]);
        expect(s.selected).toBe(30);
        expect(s.acted).toBe(5);
        expect(s.skipped).toBe(0);
    });

    it('folds repeated executions of one node into a single entry', () => {
        // A loop body node that ran 30 times is ONE node entry with runs: 30 —
        // not 30 entries the reader has to add up.
        const steps = Array.from({ length: 30 }, (_, i) =>
            step({ nodeId: 'write', nodeType: 'create_record', metrics: { acted: 1 }, parentNodeId: 'each', iteration: i }),
        );
        const s = summarizeRun(steps);
        expect(s.nodes).toHaveLength(1);
        expect(s.nodes[0]).toMatchObject({ nodeId: 'write', runs: 30, acted: 30, status: 'success' });
        expect(s.acted).toBe(30);
    });

    it('omits selected / acted for a node that reports no metrics', () => {
        // Absent means "this kind of node touches no records" — different from
        // `0`, which means "it looked and found none".
        const s = summarizeRun([step({ nodeId: 'gate', nodeType: 'decision' })]);
        expect(s.nodes[0].selected).toBeUndefined();
        expect(s.nodes[0].acted).toBeUndefined();
    });

    it('counts gate skips per gate, most-skipped first, and excludes them from runs', () => {
        const steps: StepLogEntry[] = [];
        for (let i = 0; i < 3; i++) {
            steps.push(step({
                nodeId: 'nudge', nodeType: 'notify', status: 'skipped',
                skippedBy: { nodeId: 'gate', edgeId: 'b1', label: 'Go' },
            }));
        }
        steps.push(step({
            nodeId: 'other', nodeType: 'notify', status: 'skipped',
            skippedBy: { nodeId: 'gate2', edgeId: 'b2' },
        }));

        const s = summarizeRun(steps);
        expect(s.skipped).toBe(4);
        expect(s.gates).toEqual([
            { nodeId: 'gate', targetNodeId: 'nudge', edgeId: 'b1', label: 'Go', skipped: 3 },
            { nodeId: 'gate2', targetNodeId: 'other', edgeId: 'b2', skipped: 1 },
        ]);
        // A node that only ever got skipped never RAN.
        expect(s.nodes.find((n) => n.nodeId === 'nudge')).toMatchObject({ runs: 0, skipped: 3, status: 'skipped' });
    });

    it('reports a node as failed when any of its executions failed', () => {
        const s = summarizeRun([
            step({ nodeId: 'call', nodeType: 'http' }),
            step({ nodeId: 'call', nodeType: 'http', status: 'failure' }),
            step({ nodeId: 'call', nodeType: 'http' }),
        ]);
        expect(s.nodes[0]).toMatchObject({ nodeId: 'call', runs: 3, failures: 1, status: 'failure' });
    });

    it('keeps the counts of a node that failed part way through writing', () => {
        const s = summarizeRun([
            step({ nodeId: 'w', nodeType: 'update_record', status: 'failure', metrics: { acted: 7 } }),
        ]);
        expect(s.acted).toBe(7);
    });
});

describe('formatRunSummaryLine', () => {
    it('is one greppable line carrying selected / acted and the top gate', () => {
        const line = formatRunSummaryLine(
            { flowName: 'stalled_deal_sweep', runId: 'run_1', status: 'completed', durationMs: 42 },
            summarizeRun([
                step({ nodeId: 'q', nodeType: 'get_record', metrics: { selected: 30 } }),
                ...Array.from({ length: 30 }, () => step({
                    nodeId: 'nudge', nodeType: 'notify', status: 'skipped',
                    skippedBy: { nodeId: 'gate', edgeId: 'b1' },
                })),
            ]),
        );
        expect(line).not.toContain('\n');
        expect(line).toBe(
            '[automation] run flow=stalled_deal_sweep run=run_1 status=completed durationMs=42 ' +
            'selected=30 acted=0 skipped=30 gate=gate->nudge:30',
        );
    });
});

// ── End to end: the shape #4347 shipped ─────────────────────────────────────

/**
 * A sweep in the shape that shipped inert three times over: query rows, loop
 * them, and act only when a gate opens. `shouldRun` decides whether the gate
 * opens, which is the difference between "nothing to do" and "broken" — the
 * two states that used to look identical from outside.
 */
function sweepFlow(name: string) {
    const condition = { dialect: 'cel', source: 'row.shouldRun == true' };
    return {
        name, label: name, type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'query', type: 'get_record', label: 'Query',
                config: { objectName: 'deal', filter: { stalled: true }, limit: 10, outputVariable: 'rows' },
            },
            {
                id: 'each', type: 'loop', label: 'Each',
                config: {
                    collection: '{rows}', iteratorVariable: 'row',
                    body: {
                        nodes: [
                            { id: 'gate', type: 'decision', label: 'Gate' },
                            { id: 'nudge', type: 'create_record', label: 'Nudge', config: { objectName: 'nudge', fields: { note: 'x' } } },
                        ],
                        edges: [{ id: 'b1', source: 'gate', target: 'nudge', type: 'conditional', condition, label: 'Go' }],
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
    };
}

function sweepEngine(rows: Array<Record<string, unknown>>, logger = makeLogger(), store?: any) {
    const written: Array<Record<string, unknown>> = [];
    let seq = 0;
    const data: any = {
        async find() { return rows; },
        async findOne() { return rows[0] ?? null; },
        async insert(obj: string, fields: any) { seq += 1; const r = { id: `${obj}_${seq}`, ...fields }; written.push(r); return r; },
        async update() { return 0; },
        async delete() { return 0; },
    };
    const ctx: any = { logger, getService: (n: string) => (n === 'data' ? data : undefined) };
    const engine = new AutomationEngine(logger, store);
    registerCrudNodes(engine, ctx);
    registerLogicNodes(engine, ctx);
    registerLoopNode(engine, ctx);
    return { engine, written, logger };
}

describe('flow run summary — a sweep that selects rows and writes none (#4354)', () => {
    it('reports selected 3 / acted 0 and NAMES the gate that closed', async () => {
        const rows = [1, 2, 3].map((i) => ({ id: `d${i}`, shouldRun: false }));
        const { engine, written } = sweepEngine(rows);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);

        // The old world stopped here: success, nothing written, no signal.
        expect(res.success).toBe(true);
        expect(written).toHaveLength(0);

        // The new one keeps going.
        expect(res.summary).toBeDefined();
        expect(res.summary!.selected).toBe(3);
        expect(res.summary!.acted).toBe(0);
        expect(res.summary!.skipped).toBe(3);
        expect(res.summary!.gates).toEqual([
            { nodeId: 'gate', targetNodeId: 'nudge', edgeId: 'b1', label: 'Go', skipped: 3 },
        ]);
        expect(res.summary!.nodes.find((n) => n.nodeId === 'nudge')).toMatchObject({
            runs: 0, skipped: 3, status: 'skipped',
        });
    });

    it('reports selected 3 / acted 3 for the SAME flow once the gate opens', async () => {
        // Same graph, same nodes, same query — only the data differs. If the
        // summary could not tell these two runs apart it would be worthless.
        const rows = [1, 2, 3].map((i) => ({ id: `d${i}`, shouldRun: true }));
        const { engine, written } = sweepEngine(rows);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        expect(res.success).toBe(true);
        expect(written).toHaveLength(3);
        expect(res.summary).toMatchObject({ selected: 3, acted: 3, skipped: 0, gates: [] });
    });

    it('distinguishes "nothing to do" — selected 0, acted 0, no gate blamed', async () => {
        const { engine } = sweepEngine([]);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        expect(res.summary).toMatchObject({ selected: 0, acted: 0, skipped: 0, gates: [] });
    });

    it('logs ONE structured line per terminal run', async () => {
        const rows = [1, 2, 3].map((i) => ({ id: `d${i}`, shouldRun: false }));
        const { engine, logger } = sweepEngine(rows);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);
        await engine.execute('sweep', { event: 'schedule' } as AutomationContext);

        const lines = logger.lines.filter((l: any) => l.msg.startsWith('[automation] run flow='));
        expect(lines).toHaveLength(1);
        expect(lines[0].msg).toContain('selected=3 acted=0 skipped=3');
        expect(lines[0].msg).toContain('gate=gate->nudge:3');
        expect(lines[0].meta).toMatchObject({ flow: 'sweep', selected: 3, acted: 0, skipped: 3 });
    });

    it('runSummaryLog:"off" silences the line but still MEASURES the run', async () => {
        const rows = [{ id: 'd1', shouldRun: false }];
        const logger = makeLogger();
        const { engine } = sweepEngine(rows, logger);
        (engine as unknown as { runSummaryLog: string }).runSummaryLog = 'off';
        engine.registerFlow('sweep', sweepFlow('sweep') as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        expect(logger.lines.filter((l: any) => l.msg.startsWith('[automation] run flow='))).toHaveLength(0);
        // Turning the narration down must never turn the measurement off.
        expect(res.summary).toMatchObject({ selected: 1, acted: 0, skipped: 1 });
    });

    it('records a gate that closes on every one of 40 iterations without inflating runs', async () => {
        // The observability signal must not change execution semantics: 40 skips
        // are 40 non-events, so `runs` for the skipped node stays 0 and the run
        // still completes. (The top-level twin of this — a closed back-edge not
        // counting toward the ADR-0044 re-entry cap — is pinned in engine.test.ts.)
        const rows = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, shouldRun: false }));
        const { engine } = sweepEngine(rows);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        expect(res.success).toBe(true); // not aborted as a runaway loop
        expect(res.summary!.skipped).toBe(40);
        expect(res.summary!.nodes.find((n) => n.nodeId === 'nudge')!.runs).toBe(0);
    });
});

// ── Durability ──────────────────────────────────────────────────────────────

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('run summary durability', () => {
    it('survives a restart via listRuns / getRun', async () => {
        const rows = [1, 2, 3].map((i) => ({ id: `d${i}`, shouldRun: false }));
        const store = new InMemorySuspendedRunStore();
        const { engine } = sweepEngine(rows, makeLogger(), store);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);
        await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        await flush(); // recordTerminal is fire-and-forget

        // Fresh engine, empty in-memory logs, same durable store.
        const fresh = new AutomationEngine(makeLogger(), store);
        const [listed] = await fresh.listRuns('sweep', { limit: 1 });
        expect(listed.summary).toMatchObject({ selected: 3, acted: 0, skipped: 3 });
        const run = await fresh.getRun(listed.id);
        expect(run!.summary!.gates[0]).toMatchObject({ nodeId: 'gate', skipped: 3 });
    });

    it('counts stay EXACT when the step log is compacted past its cap', async () => {
        // The counts are folded before compaction, so a 300-iteration sweep does
        // not silently shrink to the 200 steps that fit in the history row.
        const rows = Array.from({ length: 300 }, (_, i) => ({ id: `d${i}`, shouldRun: true }));
        const store = new InMemorySuspendedRunStore();
        const { engine } = sweepEngine(rows, makeLogger(), store);
        engine.registerFlow('sweep', sweepFlow('sweep') as never);
        await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        await flush();

        const fresh = new AutomationEngine(makeLogger(), store);
        const [listed] = await fresh.listRuns('sweep', { limit: 1 });
        expect(listed.steps.length).toBeLessThanOrEqual(200); // compacted…
        expect(listed.summary).toMatchObject({ selected: 300, acted: 300 }); // …counts are not
    });

    it('writes the counts as QUERYABLE columns on sys_automation_run', async () => {
        // `selected_count > 0 AND acted_count = 0` has to be a filter an operator
        // can alert on, not a value buried inside a JSON blob.
        const rows: any[] = [];
        const engine: any = {
            async find() { return []; },
            async insert(_obj: string, row: any) { rows.push(row); return row; },
            async update() { return 1; },
            async delete() { return 1; },
        };
        const store = new ObjectStoreSuspendedRunStore(engine);
        const record: RunRecord = {
            runId: 'r1', flowName: 'sweep', status: 'completed', startedAt: AT,
            summary: {
                selected: 30, acted: 0, skipped: 30,
                nodes: [{ nodeId: 'q', nodeType: 'get_record', status: 'success', runs: 1, failures: 0, skipped: 0, selected: 30 }],
                gates: [{ nodeId: 'gate', targetNodeId: 'nudge', skipped: 30 }],
            },
        };
        await store.recordTerminal(record);

        expect(rows).toHaveLength(1);
        expect(rows[0].selected_count).toBe(30);
        expect(rows[0].acted_count).toBe(0);
        expect(rows[0].skipped_count).toBe(30);
        expect(JSON.parse(rows[0].summary_json).gates[0].nodeId).toBe('gate');
    });

    it('leaves the count columns NULL — never 0 — when no summary was computed', async () => {
        // "Not measured" must not read as "measured zero", or every legacy row
        // becomes a false alarm the first time someone writes the query.
        const rows: any[] = [];
        const engine: any = {
            async find() { return []; },
            async insert(_obj: string, row: any) { rows.push(row); return row; },
            async update() { return 1; },
            async delete() { return 1; },
        };
        await new ObjectStoreSuspendedRunStore(engine).recordTerminal({
            runId: 'r1', flowName: 'sweep', status: 'completed', startedAt: AT,
        });
        expect(rows[0].selected_count).toBeNull();
        expect(rows[0].acted_count).toBeNull();
        expect(rows[0].summary_json).toBeNull();
    });
});

// ── Executor-reported metrics ───────────────────────────────────────────────

describe('node executors report what they touched', () => {
    const flowOf = (nodes: any[], edges: any[]) => ({
        name: 'f', label: 'f', type: 'autolaunched', runAs: 'system', nodes, edges,
    });

    it('update_record reports the row COUNT a bulk write returned', async () => {
        const logger = makeLogger();
        const data: any = {
            async find() { return []; },
            async findOne() { return null; },
            async insert(_o: string, f: any) { return { id: 'x', ...f }; },
            async update() { return 7; }, // driver.updateMany contract: Promise<number>
            async delete() { return 0; },
        };
        const engine = new AutomationEngine(logger);
        registerCrudNodes(engine, { logger, getService: (n: string) => (n === 'data' ? data : undefined) } as never);
        engine.registerFlow('f', flowOf(
            [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'u', type: 'update_record', label: 'U', config: { objectName: 'deal', filter: { stalled: true }, fields: { nudged: true } } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            [{ id: 'e1', source: 'start', target: 'u' }, { id: 'e2', source: 'u', target: 'end' }],
        ) as never);

        const res = await engine.execute('f', { event: 'schedule' } as AutomationContext);
        expect(res.summary).toMatchObject({ acted: 7, selected: 0 });
    });

    it('delete_record reports 0 when the driver reports nothing deleted', async () => {
        const logger = makeLogger();
        const data: any = {
            async find() { return []; },
            async findOne() { return null; },
            // #5197 — the double's delete opens with the PRODUCER's own dispatch
            // decision, so a sweep this fixture accepts is one `ObjectQL.delete`
            // accepts. It used to answer `false` to anything, which is how the
            // shape below stayed green here while #5225's real purge flow died
            // on it every run.
            async delete(_object: string, options: any) {
                assertEngineDeleteDispatch(options);
                return 0; // driver.deleteMany contract: Promise<number> — nothing matched
            },
        };
        const engine = new AutomationEngine(logger);
        registerCrudNodes(engine, { logger, getService: (n: string) => (n === 'data' ? data : undefined) } as never);
        engine.registerFlow('f', flowOf(
            [
                { id: 'start', type: 'start', label: 'S' },
                // `multi: true` is what makes a PREDICATE delete reach the driver
                // at all (#5393); without it the engine refuses the call, which
                // `builtin/crud-bulk-intent.test.ts` pins on the executor side.
                // Here the subject is the counter, so the sweep declares intent
                // and the driver reports that it matched nothing.
                { id: 'd', type: 'delete_record', label: 'D', config: { objectName: 'deal', filter: { stale: true }, multi: true } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            [{ id: 'e1', source: 'start', target: 'd' }, { id: 'e2', source: 'd', target: 'end' }],
        ) as never);

        const res = await engine.execute('f', { event: 'schedule' } as AutomationContext);
        // `acted: 0` alone does NOT say the sweep deleted nothing — it is equally
        // what a REFUSED delete leaves behind, so the counter has to be read
        // together with the outcome or the case passes for the empty reason
        // (measured: with the fake pinned and `multi` dropped, the run fails and
        // this assertion alone still went green).
        expect(res.success).toBe(true);
        expect(res.summary!.acted).toBe(0);
        expect(res.summary!.nodes.find((n) => n.nodeId === 'd')).toMatchObject({
            nodeType: 'delete_record', runs: 1, failures: 0, acted: 0,
        });
    });

    it('notify counts DELIVERED notifications as acted — a nudge sweep acts by notifying', async () => {
        const logger = makeLogger();
        const messaging: any = { async emit() { return { notificationId: 'n1', delivered: 4, failed: 0 }; } };
        const engine = new AutomationEngine(logger);
        registerNotifyNode(engine, { logger, getService: (n: string) => (n === 'messaging' ? messaging : undefined) } as never);
        engine.registerFlow('f', flowOf(
            [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'n', type: 'notify', label: 'N', config: { recipients: ['u1'], title: 'Stalled deal' } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            [{ id: 'e1', source: 'start', target: 'n' }, { id: 'e2', source: 'n', target: 'end' }],
        ) as never);

        const res = await engine.execute('f', { event: 'schedule' } as AutomationContext);
        expect(res.summary!.acted).toBe(4);
    });

    it('notify with NO messaging service reports acted 0 — green, but inert', async () => {
        const logger = makeLogger();
        const engine = new AutomationEngine(logger);
        registerNotifyNode(engine, { logger, getService: () => undefined } as never);
        engine.registerFlow('f', flowOf(
            [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'n', type: 'notify', label: 'N', config: { recipients: ['u1'], title: 'Stalled deal' } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            [{ id: 'e1', source: 'start', target: 'n' }, { id: 'e2', source: 'n', target: 'end' }],
        ) as never);

        const res = await engine.execute('f', { event: 'schedule' } as AutomationContext);
        expect(res.success).toBe(true);
        expect(res.summary!.acted).toBe(0);
    });

    it('subflow rolls its child run up, so a parent that delegates is not read as inert', async () => {
        const logger = makeLogger();
        const written: any[] = [];
        const data: any = {
            async find() { return []; },
            async findOne() { return null; },
            async insert(o: string, f: any) { const r = { id: `${o}_1`, ...f }; written.push(r); return r; },
        };
        const ctx: any = { logger, getService: (n: string) => (n === 'data' ? data : undefined) };
        const engine = new AutomationEngine(logger);
        registerCrudNodes(engine, ctx);
        registerSubflowNode(engine, ctx);

        engine.registerFlow('child', flowOf(
            [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'w', type: 'create_record', label: 'W', config: { objectName: 'nudge', fields: { note: 'x' } } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            [{ id: 'e1', source: 'start', target: 'w' }, { id: 'e2', source: 'w', target: 'end' }],
        ) as never);
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child' } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'sub' }, { id: 'e2', source: 'sub', target: 'end' }],
        } as never);

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        expect(written).toHaveLength(1);
        // Without the roll-up the parent would report `acted: 0` — a healthy
        // run indistinguishable from a broken one, which is the whole bug.
        expect(res.summary!.acted).toBe(1);
    });
});

describe('map rolls its per-item child runs up', () => {
    // `map` is a sweep construct ("process each row"), so a map whose items all
    // write while the parent reports `acted: 0` would make the detector fire on
    // healthy runs — worse than no signal, because it trains people to ignore it.
    it('counts every item its per-item flow wrote', async () => {
        const logger = makeLogger();
        const written: any[] = [];
        const data: any = {
            async find() { return []; },
            async findOne() { return null; },
            async insert(o: string, f: any) { const r = { id: `${o}_${written.length + 1}`, ...f }; written.push(r); return r; },
        };
        const ctx: any = { logger, getService: (n: string) => (n === 'data' ? data : undefined) };
        const engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
        registerCrudNodes(engine, ctx);
        registerMapNode(engine, ctx);

        engine.registerFlow('per_item', {
            name: 'per_item', label: 'per_item', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'w', type: 'create_record', label: 'W', config: { objectName: 'nudge', fields: { note: 'x' } } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'w' }, { id: 'e2', source: 'w', target: 'end' }],
        } as never);
        engine.registerFlow('sweep', {
            name: 'sweep', label: 'sweep', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                {
                    id: 'each', type: 'map', label: 'Each',
                    config: { collection: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], flowName: 'per_item', iteratorVariable: 'row' },
                },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'each' }, { id: 'e2', source: 'each', target: 'end' }],
        } as never);

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        expect(res.success).toBe(true);
        expect(written).toHaveLength(3);
        expect(res.summary!.acted).toBe(3);
    });
});

// ── Children that pause ─────────────────────────────────────────────────────

describe('a child run that PAUSED still counts toward its parent', () => {
    // The synchronous roll-up rides on NodeExecutionResult.metrics, which a
    // paused child cannot use: the parent's step for the node was written at
    // suspend time, before the child had done anything. The engine credits the
    // child's totals to that step when it bubbles back.

    function makeEngine() {
        const logger = makeLogger();
        const written: any[] = [];
        const data: any = {
            async find() { return []; },
            async findOne() { return null; },
            async insert(o: string, f: any) { const r = { id: `${o}_${written.length + 1}`, ...f }; written.push(r); return r; },
        };
        const ctx: any = { logger, getService: (n: string) => (n === 'data' ? data : undefined) };
        const engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
        registerCrudNodes(engine, ctx);
        registerSubflowNode(engine, ctx);
        engine.registerNodeExecutor({
            type: 'hold',
            descriptor: HOLD_DESCRIPTOR,
            async execute() { return { success: true, suspend: true, correlation: 'held' }; },
        } as NodeExecutor);
        // A child that pauses, then writes a row once resumed.
        engine.registerFlow('child', {
            name: 'child', label: 'child', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'hold', type: 'hold', label: 'H' },
                { id: 'w', type: 'create_record', label: 'W', config: { objectName: 'nudge', fields: { note: 'x' } } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'hold' },
                { id: 'e2', source: 'hold', target: 'w' },
                { id: 'e3', source: 'w', target: 'end' },
            ],
        } as never);
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child' } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'sub' }, { id: 'e2', source: 'sub', target: 'end' }],
        } as never);
        return { engine, written };
    }

    it('credits the child when resuming the CHILD bubbles up to the parent', async () => {
        const { engine, written } = makeEngine();
        const paused = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        expect(paused.status).toBe('paused');

        // Resume the child directly (what an approval service / wait timer does).
        const [childRun] = await engine.listRuns('child', { limit: 1 });
        const done = await engine.resume(childRun.id);
        expect(done.success).toBe(true);
        expect(written).toHaveLength(1);

        const parent = await engine.getRun(paused.runId!);
        expect(parent!.status).toBe('completed');
        expect(parent!.summary!.acted).toBe(1);
    });

    it('credits the child when resuming the PARENT delegates down', async () => {
        const { engine, written } = makeEngine();
        const paused = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        expect(paused.status).toBe('paused');

        // Resume the parent (what a UI holding the launch run id does).
        const done = await engine.resume(paused.runId!);
        expect(done.success).toBe(true);
        expect(written).toHaveLength(1);
        expect(done.summary!.acted).toBe(1);
    });
});

// ── The third answer: effects the platform cannot count ─────────────────────

describe('uncountable effects (#4354 follow-up)', () => {
    // `acted: 0` and "we cannot tell" are different facts. Collapsing them
    // either way breaks the detector: understating fires it on healthy runs
    // until operators tune it out; overstating makes it never fire at all.

    it('counts an unmeasured execution without touching acted', () => {
        const s = summarizeRun([
            step({ nodeId: 'q', nodeType: 'get_record', metrics: { selected: 5 } }),
            step({ nodeId: 'push', nodeType: 'connector_action', metrics: { unmeasuredEffect: true } }),
        ]);
        expect(s).toMatchObject({ selected: 5, acted: 0, unmeasured: 1 });
        expect(s.nodes.find((n) => n.nodeId === 'push')).toMatchObject({ runs: 1, unmeasured: 1 });
    });

    it('counts once per EXECUTION, so a connector call in a 30-item loop shows 30', () => {
        const s = summarizeRun(
            Array.from({ length: 30 }, (_, i) =>
                step({ nodeId: 'push', nodeType: 'connector_action', metrics: { unmeasuredEffect: true }, parentNodeId: 'each', iteration: i }),
            ),
        );
        expect(s.unmeasured).toBe(30);
        expect(s.nodes).toHaveLength(1);
    });

    it('leaves unmeasured at 0 for a run with nothing uncountable', () => {
        expect(summarizeRun([step({ nodeId: 'w', nodeType: 'create_record', metrics: { acted: 1 } })]).unmeasured).toBe(0);
    });

    it('names itself on the log line ONLY when non-zero', () => {
        const clean = formatRunSummaryLine(
            { flowName: 'f', runId: 'r', status: 'completed' },
            summarizeRun([step({ nodeId: 'w', nodeType: 'create_record', metrics: { acted: 1 } })]),
        );
        expect(clean).not.toContain('unmeasured');

        const murky = formatRunSummaryLine(
            { flowName: 'f', runId: 'r', status: 'completed' },
            summarizeRun([
                step({ nodeId: 'q', nodeType: 'get_record', metrics: { selected: 9 } }),
                step({ nodeId: 'push', nodeType: 'connector_action', metrics: { unmeasuredEffect: true } }),
            ]),
        );
        // The line an operator greps for `acted=0` must carry the qualifier that
        // says the zero is incomplete.
        expect(murky).toContain('selected=9 acted=0 skipped=0 unmeasured=1');
    });

    it('an http node reports by METHOD — the one case the platform CAN count', async () => {
        const calls: string[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (_url: string, init: any) => {
            calls.push(init.method);
            return { ok: init.method !== 'PUT', status: init.method === 'PUT' ? 500 : 200, async json() { return {}; }, async text() { return ''; } };
        }) as never;
        try {
            for (const [method, expected] of [
                ['GET', { acted: 0, unmeasured: 0 }],
                ['POST', { acted: 1, unmeasured: 0 }],
                ['PUT', { acted: 0, unmeasured: 1 }], // rejected → unknown, not zero
            ] as const) {
                const logger = makeLogger();
                const engine = new AutomationEngine(logger);
                registerHttpNodes(engine, { logger, getService: () => undefined } as never);
                engine.registerFlow('f', {
                    name: 'f', label: 'f', type: 'autolaunched',
                    nodes: [
                        { id: 'start', type: 'start', label: 'S' },
                        { id: 'call', type: 'http', label: 'C', config: { url: 'https://example.test/x', method } },
                        { id: 'end', type: 'end', label: 'E' },
                    ],
                    edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }],
                } as never);
                const res = await engine.execute('f', {} as AutomationContext);
                expect(res.summary, `method ${method}`).toMatchObject(expected);
            }
        } finally {
            globalThis.fetch = realFetch;
        }
        expect(calls).toEqual(['GET', 'POST', 'PUT']);
    });

    it('a connector_action that declares no effect is unmeasured (#4395: still the default)', async () => {
        const logger = makeLogger();
        const engine = new AutomationEngine(logger);
        registerConnectorNodes(engine, { logger, getService: () => undefined } as never);
        engine.registerConnector(
            { name: 'crm', label: 'CRM', type: 'saas', actions: [{ key: 'push', label: 'Push' }] } as never,
            { push: async () => ({ id: 'ext_1' }) },
        );
        engine.registerFlow('f', {
            name: 'f', label: 'f', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'push', type: 'connector_action', label: 'P', config: { connectorId: 'crm', actionId: 'push', input: {} } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'push' }, { id: 'e2', source: 'push', target: 'end' }],
        } as never);

        const res = await engine.execute('f', {} as AutomationContext);
        expect(res.success).toBe(true);
        // NOT acted:1 — the platform cannot know whether `push` wrote anything.
        expect(res.summary).toMatchObject({ acted: 0, unmeasured: 1 });
    });

    it('a connector_action that DECLARES its effect is counted (#4395)', async () => {
        // The same flow as above, with the one difference #4395 introduces:
        // the action says what it does upstream, so the run stops reporting
        // "cannot count" and reports the count. This is the whole point — a
        // connector-driven sweep can now both prove it worked (`acted`) and be
        // flagged when it stops (`acted: 0` with `unmeasured: 0` matches the
        // broken-sweep query, which a blanket `unmeasuredEffect` never could).
        for (const [effect, expected] of [
            ['write', { acted: 1, unmeasured: 0 }],
            ['read', { acted: 0, unmeasured: 0 }],
        ] as const) {
            const logger = makeLogger();
            const engine = new AutomationEngine(logger);
            registerConnectorNodes(engine, { logger, getService: () => undefined } as never);
            engine.registerConnector(
                { name: 'crm', label: 'CRM', type: 'saas', actions: [{ key: 'push', label: 'Push', effect }] } as never,
                { push: async () => ({ id: 'ext_1' }) },
            );
            engine.registerFlow('f', {
                name: 'f', label: 'f', type: 'autolaunched',
                nodes: [
                    { id: 'start', type: 'start', label: 'S' },
                    { id: 'push', type: 'connector_action', label: 'P', config: { connectorId: 'crm', actionId: 'push', input: {} } },
                    { id: 'end', type: 'end', label: 'E' },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'push' }, { id: 'e2', source: 'push', target: 'end' }],
            } as never);

            const res = await engine.execute('f', {} as AutomationContext);
            expect(res.success, `effect ${effect}`).toBe(true);
            expect(res.summary, `effect ${effect}`).toMatchObject(expected);
        }
    });

    it('propagates through a subflow roll-up, so the parent knows its acted is incomplete', async () => {
        const logger = makeLogger();
        const engine = new AutomationEngine(logger);
        const ctx: any = { logger, getService: () => undefined };
        registerConnectorNodes(engine, ctx);
        registerSubflowNode(engine, ctx);
        engine.registerConnector(
            { name: 'crm', label: 'CRM', type: 'saas', actions: [{ key: 'push', label: 'Push' }] } as never,
            { push: async () => ({ id: 'ext_1' }) },
        );
        engine.registerFlow('child', {
            name: 'child', label: 'child', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'push', type: 'connector_action', label: 'P', config: { connectorId: 'crm', actionId: 'push', input: {} } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'push' }, { id: 'e2', source: 'push', target: 'end' }],
        } as never);
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: 'child' } },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'sub' }, { id: 'e2', source: 'sub', target: 'end' }],
        } as never);

        const res = await engine.execute('parent', {} as AutomationContext);
        expect(res.summary).toMatchObject({ acted: 0, unmeasured: 1 });
    });

    it('persists as a queryable column, null when never tracked', async () => {
        const rows: any[] = [];
        const engine: any = {
            async find() { return []; },
            async insert(_o: string, row: any) { rows.push(row); return row; },
            async update() { return 1; },
            async delete() { return 1; },
        };
        const store = new ObjectStoreSuspendedRunStore(engine);
        await store.recordTerminal({
            runId: 'r1', flowName: 'f', status: 'completed', startedAt: AT,
            summary: { selected: 9, acted: 0, skipped: 0, unmeasured: 3, nodes: [], gates: [] },
        });
        await store.recordTerminal({ runId: 'r2', flowName: 'f', status: 'completed', startedAt: AT });

        expect(rows[0].unmeasured_count).toBe(3);
        expect(rows[1].unmeasured_count).toBeNull(); // not measured ≠ measured zero
    });
});

// ── The engine's own contract with executors ────────────────────────────────

describe('engine ↔ executor metrics plumbing', () => {
    it('copies an executor\'s metrics onto its step, and no further', async () => {
        const logger = makeLogger();
        const engine = new AutomationEngine(logger);
        engine.registerNodeExecutor({
            type: 'counter',
            async execute() { return { success: true, metrics: { selected: 5, acted: 2 } }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'quiet',
            async execute() { return { success: true }; },
        } as NodeExecutor);
        engine.registerFlow('f', {
            name: 'f', label: 'f', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'S' },
                { id: 'c', type: 'counter', label: 'C' },
                { id: 'q', type: 'quiet', label: 'Q' },
                { id: 'end', type: 'end', label: 'E' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'c' },
                { id: 'e2', source: 'c', target: 'q' },
                { id: 'e3', source: 'q', target: 'end' },
            ],
        } as never);

        const res = await engine.execute('f', {} as AutomationContext);
        expect(res.summary).toMatchObject({ selected: 5, acted: 2 });
        const run = (await engine.listRuns('f'))[0];
        expect(run.steps.find((s) => s.nodeId === 'c')!.metrics).toEqual({ selected: 5, acted: 2 });
        expect(run.steps.find((s) => s.nodeId === 'q')!.metrics).toBeUndefined();
    });
});
