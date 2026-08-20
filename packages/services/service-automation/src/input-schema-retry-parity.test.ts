// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';

/**
 * #9889 — node input-schema validation must hold on EVERY attempt, not only
 * the first.
 *
 * `validateNodeInputSchemas` reports by throwing, and the retry handoff lives
 * inside `execute()`'s catch. Before the repair, only `execute()` called the
 * guard: for a flow whose node config violates its own declared `inputSchema`
 * under `errorHandling.strategy: 'retry'`, attempt 1 threw in the guard before
 * any node executed, the catch routed to `retryExecution`, and attempts 2..N
 * ran through `executeWithoutRetry` — which never called the guard — so the
 * nodes attempt 1 refused permission to run were executed for real, with the
 * config the guard rejected. A `retry` strategy was a way past authoring-time
 * validation.
 *
 * The pins here are written against the OBSERVABLE side effect (an executor
 * spy counting real node executions), not only the thrown error: the defect's
 * whole harm is a side-effecting node (a data write, an HTTP call, an email)
 * running with rejected config, and an assertion on the returned error alone
 * stays green while that node runs.
 *
 * On the envelope: the refusal is asserted as `success: false` +
 * `status: 'failed'` + the guard's own message. There is no ADR-0112 `code`
 * to assert — deliberately: #9378's classification gives `code` to the
 * NEVER-DISPATCHED exits (`FLOW_DISABLED`, `FLOW_NO_START_NODE`) and `status:
 * 'failed'` to the dispatched-and-failed exits, and the guard's throw rides
 * the latter family on both attempt paths. Whether a definition-level refusal
 * should instead be classified non-retryable (its verdict cannot change per
 * attempt) is the open question #9889 leaves to a maintainer ruling; these
 * pins assert the parity floor only.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/**
 * An engine holding one flow whose single work node counts every REAL
 * execution — the observable the negative pins are written against.
 */
function countingFlowEngine(opts: {
    config: Record<string, unknown>;
    inputSchema: Record<string, { type: string; required?: boolean }>;
    /** What the spy executor returns; defaults to success. */
    executeResult?: (attempt: number) => { success: boolean; error?: string };
}) {
    const engine = new AutomationEngine(createTestLogger());
    const runs = { count: 0 };

    engine.registerNodeExecutor({
        type: 'script',
        async execute() {
            runs.count++;
            return opts.executeResult ? opts.executeResult(runs.count) : { success: true };
        },
    } as any);

    engine.registerFlow('guarded', {
        name: 'guarded',
        label: 'Guarded',
        type: 'autolaunched',
        errorHandling: { strategy: 'retry', maxRetries: 2, backoffMs: 0 },
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'work',
                type: 'script' as any,
                label: 'Work',
                config: opts.config,
                inputSchema: opts.inputSchema,
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'work' },
            { id: 'e1', source: 'work', target: 'end' },
        ],
    } as any);

    return { engine, runs };
}

describe("#9889 — input-schema refusal holds on every attempt under strategy: 'retry'", () => {
    it('never executes a node whose config mis-types its declared inputSchema — on ANY attempt', async () => {
        const { engine, runs } = countingFlowEngine({
            config: { count: 'not_a_number' },
            inputSchema: { count: { type: 'number', required: true } },
        });

        const result = await engine.execute('guarded');

        // The refusal, as the caller sees it (see header for why no `code`).
        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain("expected type 'number' but got 'string'");

        // The point of the card: the side-effecting node ran ZERO times.
        // Pre-repair this was 2 — refused on attempt 1, executed for real on
        // attempts 2 and 3.
        expect(runs.count).toBe(0);

        // And the refusal happened PER ATTEMPT, not by short-circuiting the
        // retry loop: every attempt still dispatched and consumed budget
        // (retry accounting unchanged — the non-retryable classification is
        // the open question, not this repair), so the run log holds one
        // failed row per attempt (1 initial + maxRetries), each carrying the
        // guard's own message.
        const attemptRows = await engine.listRuns('guarded', { status: 'failed' });
        expect(attemptRows).toHaveLength(3);
        for (const row of attemptRows) {
            expect(row.error).toContain("expected type 'number' but got 'string'");
        }
    });

    it('never executes a node missing a required declared input — on ANY attempt', async () => {
        const { engine, runs } = countingFlowEngine({
            config: {},
            inputSchema: { url: { type: 'string', required: true } },
        });

        const result = await engine.execute('guarded');

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toContain("missing required input parameter 'url'");
        expect(runs.count).toBe(0);
    });

    it('still retries a VALID flow normally — the guard refuses nothing attempt 1 allowed', async () => {
        const { engine, runs } = countingFlowEngine({
            config: { count: 42 },
            inputSchema: { count: { type: 'number', required: true } },
            // Attempt 1 fails downstream (a transient error, the case retry
            // exists for); attempt 2 succeeds.
            executeResult: attempt =>
                attempt === 1 ? { success: false, error: 'downstream 503' } : { success: true },
        });

        const result = await engine.execute('guarded');

        expect(result.success).toBe(true);
        // Attempt 1 ran and failed, attempt 2 ran and succeeded — the fix must
        // not turn a legitimate retry into a refusal.
        expect(runs.count).toBe(2);
    });
});
