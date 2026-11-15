// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';

/**
 * The start node's trigger-condition gate must hold on EVERY attempt, not
 * only the first.
 *
 * `execute()` evaluates the start condition; a condition that cannot be
 * evaluated THROWS (ADR-0032 §1c), and the throw lands in `execute()`'s catch,
 * which hands a flow declaring `errorHandling.strategy: 'retry'` to
 * `retryExecution`. Every retry attempt runs through `executeWithoutRetry`.
 * Before the repair that method went from the start-node lookup straight to
 * the nodes and never evaluated the condition, so a condition that faulted on
 * attempt 1 let attempts 2..N run the flow's nodes ungated: the author's gate
 * on whether the flow runs at all, opened by a fault.
 *
 * The rule pinned here: both attempt paths call one evaluator
 * (`startConditionHolds`), so a fault stays a fault (retried, never a pass),
 * a condition that does not hold skips the run exactly as on attempt 1, and a
 * condition that holds runs the nodes once.
 *
 * Written against the OBSERVABLE side effect, an executor counting real node
 * executions, never the returned envelope alone: the defect's harm is a
 * side-effecting node running when it should not.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** An engine holding one start-gated flow whose single work node counts every REAL execution. */
function gatedFlowEngine(opts: { strategy?: 'retry' | 'fail' } = {}) {
    const engine = new AutomationEngine(createTestLogger());
    const runs = { count: 0 };

    engine.registerNodeExecutor({
        type: 'probe_step',
        async execute() {
            runs.count++;
            return { success: true };
        },
    } as any);

    engine.registerFlow('gated', {
        name: 'gated',
        label: 'Gated',
        type: 'autolaunched',
        ...(opts.strategy === 'retry'
            ? { errorHandling: { strategy: 'retry', maxRetries: 2, backoffMs: 0 } }
            : {}),
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { condition: 'record.amount > 10' } },
            { id: 'work', type: 'probe_step', label: 'Work' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'work' },
            { id: 'e1', source: 'work', target: 'end' },
        ],
    } as any);

    return { engine, runs };
}

/** `'abc' > 10` has no CEL overload, so the real evaluator faults on this record. */
const FAULTING_RECORD = { id: 'r1', amount: 'abc' };

describe("start condition under errorHandling.strategy: 'retry' — evaluated on every attempt", () => {
    it('a condition that faults on EVERY attempt runs no node, and the run ends failed', async () => {
        const { engine, runs } = gatedFlowEngine({ strategy: 'retry' });
        const evaluate = vi.spyOn(engine, 'evaluateCondition');

        const result = await engine.execute('gated', { record: { ...FAULTING_RECORD } } as any);

        // The point: the side-effecting node never ran. Before the repair it
        // ran on attempt 2, and that attempt answered success.
        expect(runs.count).toBe(0);
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('condition');

        // A fault is retried, never skipped: the gate was evaluated on attempt
        // 1 and on each of the `maxRetries: 2` retry attempts, and each attempt
        // left one failed row.
        expect(evaluate).toHaveBeenCalledTimes(3);
        const failedRows = await engine.listRuns('gated', { status: 'failed' });
        expect(failedRows).toHaveLength(3);
    });

    it('a condition that faults on attempt 1 and holds on attempt 2 runs the nodes once', async () => {
        const { engine, runs } = gatedFlowEngine({ strategy: 'retry' });
        // Attempt 1 faults; every later call is the real evaluator, which
        // judges `record.amount > 10` against a record where it holds.
        const evaluate = vi.spyOn(engine, 'evaluateCondition').mockImplementationOnce(() => {
            throw new Error('condition evaluation error: transient fault — source: `record.amount > 10`');
        });

        const result = await engine.execute('gated', { record: { id: 'r1', amount: 20 } } as any);

        expect(result.success).toBe(true);
        expect((result.output as { skipped?: unknown } | undefined)?.skipped).toBeUndefined();
        expect(runs.count).toBe(1);
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('a condition that faults on attempt 1 and does not hold on attempt 2 skips, running no node', async () => {
        const { engine, runs } = gatedFlowEngine({ strategy: 'retry' });
        const evaluate = vi.spyOn(engine, 'evaluateCondition').mockImplementationOnce(() => {
            throw new Error('condition evaluation error: transient fault — source: `record.amount > 10`');
        });

        const result = await engine.execute('gated', { record: { id: 'r1', amount: 5 } } as any);

        // The same skip envelope attempt 1 answers when its condition does not hold.
        expect(result).toMatchObject({
            success: true,
            output: { skipped: true, reason: 'condition_not_met' },
            flowLabel: 'Gated',
        });
        expect(runs.count).toBe(0);
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    it('CONTROL — the default strategy answers failed on the first fault and never retries', async () => {
        const { engine, runs } = gatedFlowEngine();
        const evaluate = vi.spyOn(engine, 'evaluateCondition');

        const result = await engine.execute('gated', { record: { ...FAULTING_RECORD } } as any);

        expect(runs.count).toBe(0);
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain('condition');
        expect(evaluate).toHaveBeenCalledTimes(1);
        const failedRows = await engine.listRuns('gated', { status: 'failed' });
        expect(failedRows).toHaveLength(1);
    });

    it('CONTROL — under retry, a condition that holds or does not hold on attempt 1 is answered there', async () => {
        const held = gatedFlowEngine({ strategy: 'retry' });
        const ran = await held.engine.execute('gated', { record: { id: 'r1', amount: 20 } } as any);
        expect(ran.success).toBe(true);
        expect(held.runs.count).toBe(1);

        const notHeld = gatedFlowEngine({ strategy: 'retry' });
        const skipped = await notHeld.engine.execute('gated', { record: { id: 'r1', amount: 5 } } as any);
        expect(skipped).toMatchObject({ success: true, output: { skipped: true, reason: 'condition_not_met' } });
        expect(notHeld.runs.count).toBe(0);
    });
});
