// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16314 — the services half of #15617's ruling (maintainer 「同意」 on option 1).
//
// `ExecutionStepMetrics.failures` is the slot the spec half landed: a node that
// DELEGATES to a child run — a `subflow`, or each item of a `map` — reports the
// failures that child CONTAINED, and the fold `failed = Σ nodes[].failures`
// therefore answers "what did this run cause", subflows included. Before it, a
// parent whose child lost a row read `failed: 0` while `acted` had rolled up
// all along — the misreading the run-level count exists to prevent (#13681),
// one level up.
//
// The measured target these tests drive is the card's, from #15617:
//
//     parent `loop { subflow(child) }`, one child failing per five records
//       → parent  status=completed selected=5 acted=4 skipped=0 failed=0   (before)
//       → parent  ...                                          failed=1   (ruled)
//       → the five child summaries carry failed = [0,0,0,0,1]  (unchanged)
//
// and its CONTROL, which must keep answering exactly as it does today: a child
// that FAILS rather than contains is the delegating step's OWN failure, counted
// once through `nodes[].failures` — `call: {runs: 5, failures: 1}`, parent
// `failed = 1` — with nothing of the child's own `failed` riding up. That is the
// one place this rule parts from `acted`'s, which carries a failed child's
// writes, and the asymmetry is the easiest thing to get backwards.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor, StepLogEntry } from '../engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { FlowRunSummary } from '@objectstack/spec/automation';
import { FlowRunSummarySchema } from '@objectstack/spec/automation';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { registerLoopNode } from './loop-node.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerLogicNodes } from './logic-nodes.js';
import { registerSubflowNode } from './subflow-node.js';
import { registerMapNode } from './map-node.js';
import { summarizeRun } from '../run-summary.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/**
 * `resumeAuthority: 'any'` is what a pausing fixture has had to declare since
 * #5561 — these tests continue their pause through the public `resume` door.
 * Nothing here is about the resume gate; the fixture states the posture it
 * relies on, the same declaration the pausing built-ins carry.
 */
const HOLD_DESCRIPTOR = defineActionDescriptor({
    type: 'hold', version: '1.0.0', name: 'Hold',
    supportsPause: true, resumeAuthority: 'any',
});

function silentLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}
const pluginCtx = (logger: any) => ({ logger, getService() { return undefined; } }) as any;

/** The five rows of the measurement; the THIRD is the ownerless one. */
const ROWS = ['c1', 'c2', 'c3', 'c4', 'c5'];
const OWNERLESS = 2;

const AT = '2026-09-15T00:00:00.000Z';
const step = (over: Partial<StepLogEntry> & { nodeId: string }): StepLogEntry => ({
    nodeType: 'noop',
    status: 'success',
    startedAt: AT,
    ...over,
});

interface Harness {
    engine: AutomationEngine;
    /** Every row the per-row work node was handed, in order. */
    ran: string[];
}

/**
 * The work node fails on the OWNERLESS row and only on it. Driven by call
 * order rather than by a param, because `loop`, `map` and `subflow` are all
 * sequential here — one counter reproduces "one row in five" without plumbing
 * a record through two variable scopes, which is not what is under test.
 */
function harness(): Harness {
    const logger = silentLogger();
    const engine = new AutomationEngine(logger, new InMemorySuspendedRunStore());
    const ctx = pluginCtx(logger);
    registerLoopNode(engine, ctx);
    registerTryCatchNode(engine, ctx);
    registerLogicNodes(engine, ctx);
    registerSubflowNode(engine, ctx);
    registerMapNode(engine, ctx);

    const ran: string[] = [];

    // Stands in for the sweep query — seeds the collection and reports
    // `selected` the way a real `get_record` node does (#4354).
    engine.registerNodeExecutor({
        type: 'seed',
        async execute(_node, variables) {
            variables.set('cases', ROWS);
            return { success: true, metrics: { selected: ROWS.length } };
        },
    } as NodeExecutor);

    engine.registerNodeExecutor({
        type: 'work',
        async execute() {
            const n = ran.length;
            ran.push(ROWS[n] ?? `extra_${n}`);
            if (n === OWNERLESS) {
                return { success: false, error: `notify: at least one recipient is required (${ROWS[n]})` };
            }
            return { success: true, metrics: { acted: 1 } };
        },
    } as NodeExecutor);

    // A child that CONTAINS its failure: the work node throws inside a
    // `try_catch`, the handler runs, the child run completes.
    engine.registerFlow('contained_child', {
        name: 'contained_child', label: 'contained_child', type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'guard', type: 'try_catch', label: 'Guarded',
                config: {
                    try: { nodes: [{ id: 'work', type: 'work', label: 'Work' }], edges: [] },
                    catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }], edges: [] },
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'guard' },
            { id: 'e2', source: 'guard', target: 'end' },
        ],
    } as never);

    // Always fails — the single-row spelling, for the durable-pause case where
    // "one row in five" would only add noise.
    engine.registerNodeExecutor({
        type: 'boom',
        async execute() {
            return { success: false, error: 'notify: at least one recipient is required (paused row)' };
        },
    } as NodeExecutor);

    engine.registerNodeExecutor({
        type: 'hold',
        descriptor: HOLD_DESCRIPTOR,
        async execute() { return { success: true, suspend: true, correlation: 'held' }; },
    } as NodeExecutor);

    // A child that PAUSES first and contains its failure only after the resume.
    // Its parent's step was written at suspend time, before the child had done
    // anything, so the count reaches the parent through the engine's
    // `creditChildRun` seam rather than through the executor's `metrics`.
    engine.registerFlow('paused_contained_child', {
        name: 'paused_contained_child', label: 'paused_contained_child', type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'hold', type: 'hold', label: 'Hold' },
            {
                id: 'guard', type: 'try_catch', label: 'Guarded',
                config: {
                    try: { nodes: [{ id: 'boom', type: 'boom', label: 'Boom' }], edges: [] },
                    catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }], edges: [] },
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'hold' },
            { id: 'e2', source: 'hold', target: 'guard' },
            { id: 'e3', source: 'guard', target: 'end' },
        ],
    } as never);

    // The control's child: the same work node with NO containment, so the
    // child run itself FAILS.
    engine.registerFlow('failing_child', {
        name: 'failing_child', label: 'failing_child', type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'work', type: 'work', label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'work' },
            { id: 'e2', source: 'work', target: 'end' },
        ],
    } as never);

    return { engine, ran };
}

/**
 * `loop { subflow(<childFlow>) }` over the five rows — the card's shape.
 *
 * `guardBody` wraps the `subflow` call in the parent's own `try_catch`, which
 * is what the control needs and MEASURED rather than assumed: a `loop` body is
 * fail-fast, so an unguarded call to a child that FAILS ends the loop at the
 * third row (`call: {runs: 3}`) and the loop node records a failure of its own
 * beside the call's, making `failed = 2`. The control's declared numbers —
 * `call: {runs: 5, failures: 1}`, parent `failed = 1` — are the CONTAINED
 * parent, which is the shape the contained-child case uses too, so the two read
 * against one fixture and differ only in which level contains.
 */
function registerLoopParent(
    engine: AutomationEngine,
    name: string,
    childFlow: string,
    guardBody = false,
): void {
    const call = { id: 'call', type: 'subflow', label: 'Call', config: { flowName: childFlow } };
    const body = guardBody
        ? {
            nodes: [{
                id: 'guard_parent', type: 'try_catch', label: 'Guarded',
                config: {
                    try: { nodes: [call], edges: [] },
                    catch: { nodes: [{ id: 'handled_parent', type: 'assignment', label: 'Handled' }], edges: [] },
                },
            }],
            edges: [],
        }
        : { nodes: [call], edges: [] };

    engine.registerFlow(name, {
        name, label: name, type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'query', type: 'seed', label: 'Query' },
            {
                id: 'each', type: 'loop', label: 'Each case',
                config: { collection: '{cases}', iteratorVariable: 'currentCase', body },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'query' },
            { id: 'e2', source: 'query', target: 'each' },
            { id: 'e3', source: 'each', target: 'end' },
        ],
    } as never);
}

/** `map` over the five rows, one child run per item. */
function registerMapParent(engine: AutomationEngine, name: string, childFlow: string): void {
    engine.registerFlow(name, {
        name, label: name, type: 'autolaunched', runAs: 'system',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'query', type: 'seed', label: 'Query' },
            {
                id: 'each', type: 'map', label: 'Each case',
                config: { collection: '{cases}', flowName: childFlow, iteratorVariable: 'currentCase' },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'query' },
            { id: 'e2', source: 'query', target: 'each' },
            { id: 'e3', source: 'each', target: 'end' },
        ],
    } as never);
}

const nodeOf = (summary: FlowRunSummary, nodeId: string) =>
    summary.nodes.find((n) => n.nodeId === nodeId);

describe('#16314 — a delegating node rolls its COMPLETED child\'s contained failures up', () => {
    it('the measured target: `loop { subflow }`, one child failing per five rows, answers `failed = 1`', async () => {
        const { engine, ran } = harness();
        registerLoopParent(engine, 'parent', 'contained_child');

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        const summary = res.summary as FlowRunSummary;

        // Every row ran and the run completed — containment worked, which is
        // the premise the count is about.
        expect(res.success).toBe(true);
        expect(ran).toEqual(ROWS);
        expect(summary.selected).toBe(5);
        expect(summary.acted).toBe(4);
        expect(summary.skipped).toBe(0);

        // The half that did not exist: the parent answers for what its children
        // lost. `0` here was the card's measurement.
        expect(summary.failed).toBe(1);
        // …and it still agrees with the breakdown it is declared to fold.
        expect(summary.failed).toBe(summary.nodes.reduce((n, node) => n + node.failures, 0));
    });

    it('the delegating node reads `success` with `failures > 0` — the verdict is its OWN executions', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'contained_child');

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        const call = nodeOf(res.summary as FlowRunSummary, 'call');

        // `FlowRunNodeSummary.status` is declared judged on the node's own
        // executions: this `subflow` step ran five times and never failed, so
        // colouring it `failure` because a child lost a row would be a second,
        // contradictory answer to a question the schema already settles.
        expect(call).toMatchObject({ status: 'success', runs: 5, failures: 1 });
    });

    it('the CHILD rows are untouched — `failed = [0,0,0,0,1]` stays on them', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'contained_child');

        await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        const children = await engine.listRuns('contained_child');

        // Oldest-first, so the ownerless row is the third child.
        const failedByChild = [...children]
            .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
            .map((r) => r.summary?.failed);
        expect(failedByChild).toEqual([0, 0, 1, 0, 0]);
        // The child keeps its own run row; the roll-up does not move the count,
        // it publishes it a second time under the question the parent answers.
        expect(failedByChild.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(1);
    });

    it('the run summary still satisfies the published contract', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'contained_child');

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);

        // A full parse, not an unrecognized-keys check: what moved is a VALUE
        // (`failures` may now exceed `runs` on a delegating node), so the whole
        // judgement has to stay green.
        const parsed = FlowRunSummarySchema.safeParse(res.summary);
        expect(parsed.success).toBe(true);
    });

    it('`map` rolls its per-item children up the same way — measured, not assumed', async () => {
        const { engine, ran } = harness();
        registerMapParent(engine, 'sweep', 'contained_child');

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        const summary = res.summary as FlowRunSummary;

        expect(res.success).toBe(true);
        expect(ran).toEqual(ROWS);
        // `map` does NOT share `subflow`'s roll-up path — it accumulates its
        // items' totals itself — so this is a second implementation of the same
        // rule and needs its own pin.
        expect(summary.failed).toBe(1);
        expect(nodeOf(summary, 'each')).toMatchObject({ status: 'success', runs: 1, failures: 1 });
        expect(summary.acted).toBe(4);
    });
});

describe('#16314 — the control: a child that FAILED is the delegating step\'s own failure, counted once', () => {
    it('`loop { subflow }` over a failing child keeps answering exactly as before', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'failing_child', true);

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        const summary = res.summary as FlowRunSummary;
        const call = nodeOf(summary, 'call');

        // The card's control numbers, verbatim: the subflow node's own failure
        // is what counts, once.
        expect(call).toMatchObject({ runs: 5, failures: 1, status: 'failure' });
        expect(summary.failed).toBe(1);
    });

    it('nothing of the failed child\'s own `failed` rides up — one loss is never counted twice', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'failing_child', true);

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        const summary = res.summary as FlowRunSummary;
        const children = await engine.listRuns('failing_child');
        const failedChild = children.find((r) => r.status === 'failed');

        // The failed child's run row carries its own failure…
        expect(failedChild?.summary?.failed).toBeGreaterThanOrEqual(1);
        // …and the parent counts ONE, not that number plus its own step. The
        // symmetric-looking implementation (roll every child's `failed` up)
        // fails here and nowhere else.
        expect(summary.failed).toBe(1);
        expect(nodeOf(summary, 'call')?.failures).toBe(1);
    });

    it('a failed child\'s WRITES still ride up, which is where the two rules part', async () => {
        const { engine } = harness();
        registerLoopParent(engine, 'parent', 'failing_child', true);

        const res = await engine.execute('parent', { event: 'schedule' } as AutomationContext);

        // `acted` is declared to carry a failed child's rows — it wrote them.
        // Asserted beside the `failures` control so a future edit cannot make
        // the two rules identical in either direction without turning one of
        // these two tests red.
        expect((res.summary as FlowRunSummary).acted).toBeGreaterThan(0);
    });

    it('`map` on a failing item does not roll that item\'s contained failures up either', async () => {
        const { engine } = harness();
        registerMapParent(engine, 'sweep', 'failing_child');

        const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
        const summary = res.summary as FlowRunSummary;

        // v1 `map` is fail-fast: the failing item fails the map, and the map
        // step's own failure is the one count. The items before it keep their
        // (zero) contained failures.
        expect(nodeOf(summary, 'each')).toMatchObject({ failures: 1, status: 'failure' });
        expect(summary.failed).toBe(1);
    });
});

describe('#16314 — a child that PAUSED and then contained a failure is credited too', () => {
    /** `subflow` straight off `start`, so the parent's only step is the call. */
    function pausingParent(engine: AutomationEngine): void {
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'autolaunched', runAs: 'system',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'paused_contained_child' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'call' },
                { id: 'e2', source: 'call', target: 'end' },
            ],
        } as never);
    }

    it('credits it when the CHILD is resumed and bubbles up', async () => {
        const { engine } = harness();
        pausingParent(engine);

        const paused = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        expect(paused.status).toBe('paused');

        // What an approval service / wait timer does: it holds the child's id.
        const [childRun] = await engine.listRuns('paused_contained_child', { limit: 1 });
        const done = await engine.resume(childRun.id);
        expect(done.success).toBe(true);

        const parent = await engine.getRun(paused.runId!);
        expect(parent!.status).toBe('completed');
        // The parent's step for this node was written at SUSPEND time, before
        // the child had run anything, so this number can only arrive through
        // the engine's own credit seam — the executor's `metrics` never see it.
        expect(parent!.summary!.failed).toBe(1);
        expect(nodeOf(parent!.summary!, 'call')).toMatchObject({ status: 'success', failures: 1 });
    });

    it('credits it when the PARENT is resumed and delegates down', async () => {
        const { engine } = harness();
        pausingParent(engine);

        const paused = await engine.execute('parent', { event: 'schedule' } as AutomationContext);
        expect(paused.status).toBe('paused');

        // What a UI holding the launch run id does.
        const done = await engine.resume(paused.runId!);
        expect(done.success).toBe(true);
        expect((done.summary as FlowRunSummary).failed).toBe(1);
    });
});

// ── The fold itself, without an engine ──────────────────────────────────────

describe('#16314 — `summarizeRun` folds `metrics.failures` without recolouring the node', () => {
    it('adds the roll-up to the node\'s own failures and so to the run-level `failed`', () => {
        const s = summarizeRun([
            step({ nodeId: 'call', nodeType: 'subflow', metrics: { acted: 4, failures: 1 } }),
        ]);
        expect(s.failed).toBe(1);
        expect(s.nodes[0]).toMatchObject({ nodeId: 'call', runs: 1, failures: 1, status: 'success' });
    });

    it('sums across executions — a `map` re-entering per item reports its own share per step', () => {
        const s = summarizeRun([
            step({ nodeId: 'each', nodeType: 'map', metrics: { failures: 1 } }),
            step({ nodeId: 'each', nodeType: 'map', metrics: { failures: 2 } }),
        ]);
        expect(s.nodes[0]).toMatchObject({ runs: 2, failures: 3, status: 'success' });
        expect(s.failed).toBe(3);
    });

    it('a node with its OWN failure keeps `status: failure`, and the two counts add', () => {
        const s = summarizeRun([
            step({ nodeId: 'call', nodeType: 'subflow', status: 'failure' }),
            step({ nodeId: 'call', nodeType: 'subflow', metrics: { failures: 2 } }),
        ]);
        expect(s.nodes[0]).toMatchObject({ runs: 2, failures: 3, status: 'failure' });
        expect(s.failed).toBe(3);
    });

    it('an absent `failures` adds nothing — absent is "not tracked", never zero', () => {
        const s = summarizeRun([
            step({ nodeId: 'call', nodeType: 'subflow', metrics: { acted: 1 } }),
        ]);
        expect(s.failed).toBe(0);
        expect(s.nodes[0]).toMatchObject({ failures: 0, status: 'success' });
    });

    it('`failures` may exceed `runs` on a delegating node, as the field declares', () => {
        const s = summarizeRun([
            step({ nodeId: 'call', nodeType: 'subflow', metrics: { failures: 7 } }),
        ]);
        const node = s.nodes[0];
        expect(node.failures).toBeGreaterThan(node.runs);
        expect(node.status).toBe('success');
    });
});
