// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18714 — a child that PAUSES and then refuses must roll its refusal up on
 * BOTH resumed legs.
 *
 * #18110 / #18555 gave the `subflow` and `map` executors an arm for
 * `child.status === 'refused'`. That arm reads the value `engine.execute`
 * RETURNED to them, so it covers exactly one shape: a child that ran straight
 * through without pausing. A child that parks on a screen never returns through
 * that call at all — its outcome reaches its parent on one of two resumed legs,
 * and neither had an arm. `engine.ts` describes the resumed leg, in its own
 * words, as 「the one a screen flow actually takes」, so the uncovered legs were
 * the common ones for the feature that made `refused` reachable at all
 * (#15788).
 *
 * ⚠️ TWO PINS, because the two legs fail DIFFERENTLY and a single "a refusal is
 * handled" assertion would be one measurement restated:
 *
 *  - **Delegated resume** (`engine.resume(parentRunId)`) — measured on the
 *    unfixed engine: the parent answered `{ success: true, successMessage: … }`,
 *    its run row recorded `completed`, and the node downstream of the `subflow`
 *    RAN. The refusal is LOST, fail-open — a refusing gate that lets the run
 *    through, which nobody notices because the flow finishes green.
 *  - **Up-bubble** (`engine.resume(childRunId)`) — measured on the unfixed
 *    engine: the child row recorded `refused` correctly, and the parent stayed
 *    `paused`, in `listSuspendedRuns()`, indefinitely. Nothing is wrong with
 *    the answer; a RUN IS LEAKED. `bubbleToParent` was called on the completion
 *    path only.
 *
 * ⚠️ `refused` here is the run OUTCOME — *a refusal is a successful evaluation
 * that says no* — ⛔ NOT this package's other `refused` (a GUARD refusal,
 * `guard-refusal.ts`, which is a kind of FAILURE). The two senses are
 * distinguished at `engine.ts`'s `FlowRefusalSignal` docblock, and
 * `builtin/subflow-child-refusal.test.ts` is about a THIRD thing again
 * (#14379's retryable resume-bag codes).
 *
 * ⚠️ Direction, predicted before running: every `it` under the two `the defect`
 * blocks FAILS against the unfixed engine. The CONTROLS are green on both sides
 * on purpose — an engine that had started refusing every resumed child would
 * satisfy the defect assertions and fail these.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { installBuiltinNodes } from './builtin/index.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function pluginCtx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** The parent's own completion toast — it must never ride a child's refusal. */
const PARENT_TOAST = 'Parent completed!';
/** The authored refusal template. `{kind}` is what makes the text per-record. */
const REFUSAL_TEMPLATE = 'Refused: {kind} is not eligible';
/** …rendered in the CHILD against the value the screen collected. */
const RENDERED_REFUSAL = 'Refused: vip is not eligible';
/**
 * The child's post-pause, pre-refusal work, reported as #4354 metrics. A child
 * that refuses really can have written rows before it said no, and a parent
 * summary that forgot them reads "nothing happened, safe to re-run".
 */
const CHILD_METRICS = { selected: 3, acted: 2 } as const;

/** The child's screen declares exactly one unconditional required field. */
const REQUIRED_KIND = [{ name: 'kind', label: 'Kind', type: 'text', required: true }];

/**
 * A child that PARKS on a real `screen` node, does work when resumed, and then
 * reaches an `end`. `endConfig` absent = a plain completion (the control).
 */
const pausingChild = (name: string, endConfig?: Record<string, unknown>) => ({
    name,
    label: name,
    type: 'screen',
    status: 'active',
    version: 1,
    variables: [{ name: 'kind', type: 'text', isOutput: true }],
    nodes: [
        { id: 'c_start', type: 'start', label: 'Start' },
        { id: 'ask', type: 'screen', label: 'Ask', config: { fields: REQUIRED_KIND } },
        { id: 'c_work', type: 'childwork', label: 'Work' },
        { id: 'c_end', type: 'end', label: 'End', ...(endConfig ? { config: endConfig } : {}) },
    ],
    edges: [
        { id: 'ce0', source: 'c_start', target: 'ask', type: 'default' },
        { id: 'ce1', source: 'ask', target: 'c_work', type: 'default' },
        { id: 'ce2', source: 'c_work', target: 'c_end', type: 'default' },
    ],
});

/** The parent: start → subflow(child) → downstream → end, with its own toast. */
const parentFlow = (childName: string) => ({
    name: 'parent_flow',
    label: 'Parent Flow',
    type: 'autolaunched',
    status: 'active',
    version: 1,
    successMessage: PARENT_TOAST,
    nodes: [
        { id: 'ps', type: 'start', label: 'Start' },
        { id: 'call', type: 'subflow', label: 'Call Child', config: { flowName: childName, outputVariable: 'childOut' } },
        { id: 'after', type: 'downstream', label: 'After' },
        { id: 'pe', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'p1', source: 'ps', target: 'call', type: 'default' },
        { id: 'p2', source: 'call', target: 'after', type: 'default' },
        { id: 'p3', source: 'after', target: 'pe', type: 'default' },
    ],
});

describe('#18714 — a resumed child run that REFUSES rolls up on both legs', () => {
    let engine: AutomationEngine;
    let ran: string[];

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, pluginCtx());
        ran = [];

        engine.registerNodeExecutor({
            type: 'childwork',
            async execute() {
                ran.push('child-work');
                return { success: true, metrics: { ...CHILD_METRICS } };
            },
        } as NodeExecutor);
        // The node AFTER the parent's `subflow`. Its presence in `ran` IS the
        // "the parent walked on" assertion — ⛔ not a proxy for it.
        engine.registerNodeExecutor({
            type: 'downstream',
            async execute() {
                ran.push('downstream');
                return { success: true };
            },
        } as NodeExecutor);

        engine.registerFlow('gate_refuses', pausingChild('gate_refuses', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);
        engine.registerFlow('gate_allows', pausingChild('gate_allows') as never);
    });

    /** Start the parent and return `[parentRunId, childRunId]` — both parked. */
    async function startPair(childName: string): Promise<[string, string]> {
        engine.registerFlow('parent_flow', parentFlow(childName) as never);
        const started = await engine.execute('parent_flow', {} as never);
        expect(started.status).toBe('paused');
        const parentRunId = started.runId!;
        const child = engine.listSuspendedRuns().find((r) => r.runId !== parentRunId)!;
        expect(child).toBeDefined();
        return [parentRunId, child.runId];
    }

    // ══ LEG 1 ══════════════════════════════════════════════════════════════
    describe('the defect, leg 1 — DELEGATED resume: the refusal was LOST fail-open', () => {
        it('the parent run REFUSES — it does not answer success and record `completed`', async () => {
            const [parentRunId] = await startPair('gate_refuses');

            const res = await engine.resume(parentRunId, { variables: { kind: 'vip' } });

            expect(res.success).toBe(true);        // a refusal is a successful evaluation
            expect(res.status).toBe('refused');
            expect((await engine.getRun(parentRunId))?.status).toBe('refused');
        });

        it("the child's rendered reason reaches the parent's caller, and the parent's toast stays silent", async () => {
            const [parentRunId] = await startPair('gate_refuses');

            const res = await engine.resume(parentRunId, { variables: { kind: 'vip' } });

            // Interpolated in the CHILD against the value its screen collected
            // and passed through — ⛔ not re-rendered, ⛔ not invented here.
            expect(res.refusalMessage).toBe(RENDERED_REFUSAL);
            expect((await engine.getRun(parentRunId))?.refusalMessage).toBe(RENDERED_REFUSAL);
            // Stamping the completion toast here would toast "Parent completed!"
            // over a refusal to complete.
            expect(res.successMessage).toBeUndefined();
        });

        it('downstream nodes do NOT run — the subflow node\'s out-edges are not walked', async () => {
            const [parentRunId] = await startPair('gate_refuses');

            await engine.resume(parentRunId, { variables: { kind: 'vip' } });

            expect(ran).toEqual(['child-work']);
            expect(ran).not.toContain('downstream');
        });

        it("preserves the child's #4354 rollup on the refusal path", async () => {
            // The refusal is raised past the consumption and past
            // `creditChildRun`, so the child's counts are already in the
            // parent's step log when the run terminates.
            //
            // ⛔ The refusal assertion belongs IN this test: without it the
            // totals below are equally true of the unfixed engine, which rolled
            // the same metrics up and then carried on.
            const [parentRunId] = await startPair('gate_refuses');

            const res = await engine.resume(parentRunId, { variables: { kind: 'vip' } });

            expect(res.status).toBe('refused');
            expect(res.summary?.nodes.find((n) => n.nodeId === 'call')).toMatchObject({
                selected: 3, acted: 2,
            });
        });
    });

    describe('the control, leg 1 — an allowing child still completes the parent', () => {
        // ⛔ Mandatory, not decoration: every assertion above is also satisfied
        // by an engine that had started refusing EVERY resumed child.
        it('completes, fires the toast, walks on, and leaks nothing', async () => {
            const [parentRunId, childRunId] = await startPair('gate_allows');

            const res = await engine.resume(parentRunId, { variables: { kind: 'vip' } });

            expect(res.success).toBe(true);
            expect(res.status).toBeUndefined();     // the terminal-success exit stamps none
            expect(res.refusalMessage).toBeUndefined();
            expect(res.successMessage).toBe(PARENT_TOAST);
            expect(ran).toEqual(['child-work', 'downstream']);
            expect((await engine.getRun(parentRunId))?.status).toBe('completed');
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
            expect(await engine.hasSuspendedRun(childRunId)).toBe(false);
        });
    });

    // ══ LEG 2 ══════════════════════════════════════════════════════════════
    describe('the defect, leg 2 — UP-BUBBLE: the parent was LEAKED `paused` forever', () => {
        it('the parent is no longer suspended — it leaves `listSuspendedRuns()`', async () => {
            // ⭐ THE leg-2 signature, and it is not the leg-1 one: leg 1 answered
            // the wrong thing about a run it did resolve; this leg answers
            // correctly about the CHILD and never resolves the parent at all.
            const [parentRunId, childRunId] = await startPair('gate_refuses');

            await engine.resume(childRunId, { variables: { kind: 'vip' } });

            expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
            expect(engine.listSuspendedRuns().map((r) => r.runId)).not.toContain(parentRunId);
            expect(engine.listSuspendedRuns()).toEqual([]);
        });

        it('the parent records its own terminal `refused` row, carrying the same reason', async () => {
            const [parentRunId, childRunId] = await startPair('gate_refuses');

            await engine.resume(childRunId, { variables: { kind: 'vip' } });

            const parentRow = await engine.getRun(parentRunId);
            expect(parentRow?.status).toBe('refused');
            expect(parentRow?.refusalMessage).toBe(RENDERED_REFUSAL);
            // …and the child's own row is unchanged by the bubble.
            expect((await engine.getRun(childRunId))?.status).toBe('refused');
        });

        it('downstream nodes do NOT run — the parent refuses instead of continuing', async () => {
            const [, childRunId] = await startPair('gate_refuses');

            await engine.resume(childRunId, { variables: { kind: 'vip' } });

            expect(ran).toEqual(['child-work']);
            expect(ran).not.toContain('downstream');
        });

        it("the child's own caller is told the truth about the CHILD, unchanged", async () => {
            // The bubble is best-effort at the engine layer and never rewrites
            // what the child's resumer is told: this caller resumed the child,
            // and the child refused.
            const [, childRunId] = await startPair('gate_refuses');

            const res = await engine.resume(childRunId, { variables: { kind: 'vip' } });

            expect(res.success).toBe(true);
            expect(res.status).toBe('refused');
            expect(res.refusalMessage).toBe(RENDERED_REFUSAL);
        });

        it("credits the child's #4354 rollup to the parent's awaiting step", async () => {
            const [parentRunId, childRunId] = await startPair('gate_refuses');

            await engine.resume(childRunId, { variables: { kind: 'vip' } });

            const parentRow = await engine.getRun(parentRunId);
            expect(parentRow?.status).toBe('refused');
            expect(parentRow?.summary?.nodes.find((n) => n.nodeId === 'call')).toMatchObject({
                selected: 3, acted: 2,
            });
        });
    });

    describe('the control, leg 2 — an allowing child still bubbles a COMPLETION', () => {
        it('the parent completes through the up-bubble, walks on, and fires its toast', async () => {
            const [parentRunId, childRunId] = await startPair('gate_allows');

            const res = await engine.resume(childRunId, { variables: { kind: 'vip' } });

            expect(res.success).toBe(true);
            expect(res.status).toBeUndefined();
            expect(ran).toEqual(['child-work', 'downstream']);
            expect(await engine.hasSuspendedRun(parentRunId)).toBe(false);
            expect((await engine.getRun(parentRunId))?.status).toBe('completed');
            expect((await engine.getRun(parentRunId))?.refusalMessage).toBeUndefined();
        });
    });
});
