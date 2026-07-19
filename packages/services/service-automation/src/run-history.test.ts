// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Automation run observability: every TERMINAL run (completed / failed) must be
// mirrored to the durable store so "did it run / fail, and why?" survives a
// process restart and the in-memory ring-buffer eviction — and `listRuns` must
// merge that history. Persisting is best-effort: a history-write failure must
// never break the run that produced it.

import { describe, it, expect } from 'vitest';
import { AutomationEngine, compactStepLogForHistory, MAX_PERSISTED_HISTORY_STEPS } from './engine.js';
import type { StepLogEntry, NodeExecutor } from './engine.js';
import { registerLoopNode } from './builtin/loop-node.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

const silent = { info() {}, warn() {}, error() {}, debug() {} } as never;

function trivialFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [{ id: 'start', type: 'start', label: 's' }, { id: 'end', type: 'end', label: 'e' }],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

function failingFlow(name: string) {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 's' },
            { id: 'boom', type: 'boom', label: 'b' },
            { id: 'end', type: 'end', label: 'e' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'boom' }, { id: 'e2', source: 'boom', target: 'end' }],
    };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('automation run history (durable observability)', () => {
    it('persists a completed run to the durable store', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('ok_flow', trivialFlow('ok_flow') as never);

        const res = await engine.execute('ok_flow', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(true);
        await flush(); // recordTerminal is fire-and-forget

        const hist = await store.listHistory('ok_flow', 10);
        expect(hist).toHaveLength(1);
        expect(hist[0].status).toBe('completed');
        expect(hist[0].flowName).toBe('ok_flow');
    });

    it('persists a failed run WITH its error reason (the designer-facing "why")', async () => {
        const store = new InMemorySuspendedRunStore();
        const engine = new AutomationEngine(silent, store);
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engine.registerFlow('bad_flow', failingFlow('bad_flow') as never);

        const res = await engine.execute('bad_flow', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(false);
        await flush();

        const hist = await store.listHistory('bad_flow', 10);
        expect(hist).toHaveLength(1);
        expect(hist[0].status).toBe('failed');
        expect(hist[0].error ?? '').toMatch(/kaboom/);
    });

    it('listRuns merges durable history so runs survive a process restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerFlow('surv', trivialFlow('surv') as never);
        await engineA.execute('surv', { event: 'test' } as AutomationContext);
        await flush();

        // Simulate a restart: a fresh engine (empty in-memory logs) sharing the
        // same durable store. Before this feature its listRuns would be empty.
        const engineB = new AutomationEngine(silent, store);
        const runs = await engineB.listRuns('surv', { limit: 10 });
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('completed');
        expect(runs[0].id).toBeTruthy();
    });

    it('getRun falls back to durable history after a restart, WITH step detail (#2585)', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        engineA.registerNodeExecutor({
            type: 'boom',
            async execute() { throw new Error('kaboom'); },
        } as never);
        engineA.registerFlow('bad_flow', failingFlow('bad_flow') as never);
        await engineA.execute('bad_flow', { event: 'test' } as AutomationContext);
        await flush();

        // Simulate a restart: a fresh engine with empty in-memory logs. Before
        // #2585 its getRun returned null even though the history row existed.
        const engineB = new AutomationEngine(silent, store);
        const [listed] = await engineB.listRuns('bad_flow', { limit: 1 });
        const run = await engineB.getRun(listed.id);
        expect(run).not.toBeNull();
        expect(run!.status).toBe('failed');
        expect(run!.error ?? '').toMatch(/kaboom/);
        // Durable single-run detail: the persisted step log names the node that
        // blew up (stacks are stripped — code/message is the designer-facing why).
        const failedStep = run!.steps.find((s) => s.status === 'failure');
        expect(failedStep?.nodeId).toBe('boom');
        expect(failedStep?.error?.message).toMatch(/kaboom/);
        expect(failedStep?.error?.stack).toBeUndefined();
    });

    it('getRun returns null for an unknown run id even with a store attached', async () => {
        const engine = new AutomationEngine(silent, new InMemorySuspendedRunStore());
        expect(await engine.getRun('run_nope')).toBeNull();
    });

    it('caps terminal history per flow (retention stop-gap, #2585)', async () => {
        const store = new InMemorySuspendedRunStore({ maxTerminalRunsPerFlow: 2 });
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('busy', trivialFlow('busy') as never);
        engine.registerFlow('other', trivialFlow('other') as never);

        for (let i = 0; i < 5; i++) {
            await engine.execute('busy', { event: 'test' } as AutomationContext);
        }
        await engine.execute('other', { event: 'test' } as AutomationContext);
        await flush();

        // Only the newest 2 'busy' runs survive; the cap is per flow, so the
        // single 'other' run is untouched.
        expect(await store.listHistory('busy', 10)).toHaveLength(2);
        expect(await store.listHistory('other', 10)).toHaveLength(1);
    });

    it('a failing history store never breaks the run (best-effort isolation)', async () => {
        const store = new InMemorySuspendedRunStore();
        // Override recordTerminal to reject — the run must still complete.
        (store as unknown as { recordTerminal: () => Promise<void> }).recordTerminal = async () => {
            throw new Error('history db down');
        };
        const engine = new AutomationEngine(silent, store);
        engine.registerFlow('resilient', trivialFlow('resilient') as never);

        const res = await engine.execute('resilient', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(true); // the run is unaffected by the persist failure
        await flush();
    });
});

// ── #3234: region-aware durable-history compaction ──────────────────────────

const AT = '2026-07-18T00:00:00.000Z';

/** A run log for a top-level `loop` over `iterations` items (one body step each,
 *  optionally failing one). Mirrors the engine's folded region log (#1479):
 *  container step top-level, body steps tagged with `parentNodeId`/`iteration`. */
function loopRunLog(iterations: number, opts: { failAt?: number } = {}): StepLogEntry[] {
    const steps: StepLogEntry[] = [
        { nodeId: 'start', nodeType: 'start', status: 'success', startedAt: AT },
        { nodeId: 'each', nodeType: 'loop', status: 'success', startedAt: AT },
    ];
    for (let i = 0; i < iterations; i++) {
        const fail = opts.failAt === i;
        steps.push({
            nodeId: 'body', nodeType: 'http', status: fail ? 'failure' : 'success', startedAt: AT,
            parentNodeId: 'each', iteration: i, regionKind: 'loop-body',
            ...(fail ? { error: { code: 'E_HTTP', message: 'boom', stack: 'at foo\nat bar' } } : {}),
        });
    }
    steps.push({ nodeId: 'end', nodeType: 'end', status: 'success', startedAt: AT });
    return steps;
}

/** Every retained body step has an earlier retained step whose nodeId is its
 *  parentNodeId — i.e. the compacted log has no orphan, so the observability
 *  surface can still nest what survived. */
function hasNoOrphans(steps: StepLogEntry[]): boolean {
    for (let i = 0; i < steps.length; i++) {
        const pid = steps[i].parentNodeId;
        if (pid === undefined) continue;
        let found = false;
        for (let j = i - 1; j >= 0; j--) if (steps[j].nodeId === pid) { found = true; break; }
        if (!found) return false;
    }
    return true;
}

describe('compactStepLogForHistory (#3234 region-aware history compaction)', () => {
    it('keeps a small log whole and strips error stacks', () => {
        const log = loopRunLog(3, { failAt: 1 });
        const out = compactStepLogForHistory(log, MAX_PERSISTED_HISTORY_STEPS);
        expect(out).toHaveLength(log.length);
        const failed = out.find((s) => s.status === 'failure');
        expect(failed?.error?.message).toBe('boom');
        expect(failed?.error?.stack).toBeUndefined();
    });

    it('caps an over-budget loop at `max`', () => {
        const out = compactStepLogForHistory(loopRunLog(500), 200);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(out.length).toBeGreaterThan(0);
    });

    it('retains the loop CONTAINER + top-level backbone so body steps never orphan (the fix)', () => {
        // Pre-fix, a plain tail-slice dropped `start` + the `each` container
        // (they precede 500 body steps), leaving the Runs surface unable to nest.
        const out = compactStepLogForHistory(loopRunLog(500), 200);
        expect(out.some((s) => s.nodeId === 'each' && s.nodeType === 'loop')).toBe(true);
        expect(out.some((s) => s.nodeId === 'start')).toBe(true);
        expect(out.some((s) => s.nodeId === 'end')).toBe(true);
        expect(hasNoOrphans(out)).toBe(true);
    });

    it('keeps the most recent iterations (the tail)', () => {
        const out = compactStepLogForHistory(loopRunLog(500), 200);
        const iters = out.filter((s) => s.regionKind === 'loop-body').map((s) => s.iteration!);
        expect(Math.max(...iters)).toBe(499);
    });

    it('keeps an EARLY failure even though it is not in the tail', () => {
        // A plain tail-slice would silently drop a failure at iteration 2 of 500.
        const out = compactStepLogForHistory(loopRunLog(500, { failAt: 2 }), 200);
        const failed = out.find((s) => s.status === 'failure');
        expect(failed?.iteration).toBe(2);
        expect(failed?.error?.stack).toBeUndefined();
        expect(hasNoOrphans(out)).toBe(true);
    });

    it('preserves original execution order', () => {
        const out = compactStepLogForHistory(loopRunLog(500, { failAt: 2 }), 200);
        const iters = out.filter((s) => s.regionKind === 'loop-body').map((s) => s.iteration!);
        expect(iters).toEqual([...iters].sort((a, b) => a - b));
    });

    it('keeps a nested inner container for its retained body steps (no orphan)', () => {
        // outer loop (top-level) → inner loop (per outer iteration) → body steps.
        const steps: StepLogEntry[] = [
            { nodeId: 'start', nodeType: 'start', status: 'success', startedAt: AT },
            { nodeId: 'outer', nodeType: 'loop', status: 'success', startedAt: AT },
        ];
        for (let o = 0; o < 60; o++) {
            steps.push({ nodeId: 'inner', nodeType: 'loop', status: 'success', startedAt: AT, parentNodeId: 'outer', iteration: o, regionKind: 'loop-body' });
            for (let n = 0; n < 5; n++) {
                steps.push({ nodeId: 'body', nodeType: 'http', status: 'success', startedAt: AT, parentNodeId: 'inner', iteration: n, regionKind: 'loop-body' });
            }
        }
        steps.push({ nodeId: 'end', nodeType: 'end', status: 'success', startedAt: AT });
        const out = compactStepLogForHistory(steps, 200);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(hasNoOrphans(out)).toBe(true);
        expect(out.some((s) => s.nodeId === 'outer')).toBe(true);
    });
});

// End-to-end through the real engine: a >MAX-step loop must fold its per-iteration
// body steps into the run log (#1479), then survive durable persistence +
// rehydration (#2585) with region-aware compaction (#3234) — not just the pure
// `compactStepLogForHistory` unit above.
describe('region-aware compaction — end-to-end through the engine (#3234)', () => {
    const pluginCtx = () => ({ logger: silent, getService() { throw new Error('none'); } }) as never;

    it('a >MAX-step loop persists its container + recent iterations (no orphans) across a restart', async () => {
        const store = new InMemorySuspendedRunStore();
        const engineA = new AutomationEngine(silent, store);
        registerLoopNode(engineA, pluginCtx());
        // A trivial body node so each iteration contributes exactly one logged step.
        engineA.registerNodeExecutor({ type: 'touch', async execute() { return { success: true }; } } as NodeExecutor);

        const N = 250; // > MAX_PERSISTED_HISTORY_STEPS (200)
        engineA.registerFlow('big_loop', {
            name: 'big_loop', label: 'Big Loop', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'loop', type: 'loop', label: 'Loop', config: {
                    collection: Array.from({ length: N }, (_, i) => i),
                    iteratorVariable: 'item', indexVariable: 'i',
                    body: { nodes: [{ id: 'touch', type: 'touch', label: 'Touch' }], edges: [] },
                } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'loop' },
                { id: 'e2', source: 'loop', target: 'end' },
            ],
        } as never);

        const res = await engineA.execute('big_loop', { event: 'test' } as AutomationContext);
        expect(res.success).toBe(true);
        await flush(); // recordTerminal is fire-and-forget

        // The in-memory log keeps FULL detail: the container + all N body steps.
        const live = (await engineA.listRuns('big_loop'))[0];
        expect(live.steps.filter((s) => s.nodeId === 'touch')).toHaveLength(N);

        // Simulate a restart: a fresh engine with empty in-memory logs sharing the
        // same durable store → getRun serves the COMPACTED history row.
        const engineB = new AutomationEngine(silent, store);
        const [listed] = await engineB.listRuns('big_loop', { limit: 1 });
        const run = await engineB.getRun(listed.id);
        expect(run).not.toBeNull();
        expect(run!.status).toBe('completed');

        const steps = run!.steps;
        expect(steps.length).toBeLessThanOrEqual(MAX_PERSISTED_HISTORY_STEPS); // bounded (#2585)
        // The loop CONTAINER survived — pre-#3234 the plain tail-slice dropped it,
        // orphaning every retained body step.
        expect(steps.some((s) => s.nodeId === 'loop')).toBe(true);
        // The most recent iteration survived (tail preserved).
        const bodyIters = steps.filter((s) => s.nodeId === 'touch').map((s) => s.iteration!);
        expect(Math.max(...bodyIters)).toBe(N - 1);
        // No retained body step is orphaned from its container.
        expect(hasNoOrphans(steps)).toBe(true);
    });
});
