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
 * On the envelope — #9889's open question was RULED (#10025, maintainer,
 * 2026-08-20, Option B taken whole): a definition-level refusal is
 * NON-RETRYABLE and classifies as a NEVER-DISPATCHED exit under #9378, beside
 * `FLOW_DISABLED` / `FLOW_NO_START_NODE`. So the refusal is asserted as
 * `success: false` + its own ADR-0112 `code` (`FLOW_INPUT_SCHEMA_INVALID`,
 * registered by #11504) + the guard's own message, with `status` ABSENT —
 * that absence is the transport's discriminator, so an edit that stamps
 * `'failed'` on this exit "for consistency" must fail here. `execute()`
 * refuses ONCE and never hands the throw to `retryExecution`: one refusal
 * row in the run log where the parity floor alone wrote `1 + maxRetries`
 * identical ones. Retry accounting for such flows changed deliberately —
 * these pins assert the new counts as the ruling's content, not as a
 * loosened floor.
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

describe("#9889/#10025 — input-schema refusal refuses ONCE, non-retryably, under strategy: 'retry'", () => {
    it('never executes a node whose config mis-types its declared inputSchema — on ANY attempt', async () => {
        const { engine, runs } = countingFlowEngine({
            config: { count: 'not_a_number' },
            inputSchema: { count: { type: 'number', required: true } },
        });

        const result = await engine.execute('guarded');

        // The refusal, as the caller sees it: a NEVER-DISPATCHED exit (#10025)
        // — its own ADR-0112 code, and NO lifecycle `status`. Asserted by
        // exact value and by absence: `toBeUndefined` is the inversion of the
        // parity floor's `toBe('failed')`, not an addition beside it — the
        // ruling moved this refusal OUT of the dispatched-and-failed family.
        expect(result.success).toBe(false);
        expect(result.code).toBe('FLOW_INPUT_SCHEMA_INVALID');
        expect(result.status).toBeUndefined();
        expect(result.error).toContain("expected type 'number' but got 'string'");

        // The point of #9889: the side-effecting node ran ZERO times.
        // Pre-repair this was 2 — refused on attempt 1, executed for real on
        // attempts 2 and 3.
        expect(runs.count).toBe(0);

        // The point of #10025: the retry budget was NOT consumed. The verdict
        // is a pure function of the flow definition, so `execute()` refuses
        // ONCE and never enters the retry loop — exactly one refusal row in
        // the run log, where the parity floor alone wrote one per attempt
        // (1 initial + maxRetries = 3 under this flow's `maxRetries: 2`).
        const attemptRows = await engine.listRuns('guarded', { status: 'failed' });
        expect(attemptRows).toHaveLength(1);
        expect(attemptRows[0].error).toContain("expected type 'number' but got 'string'");
    });

    it('never executes a node missing a required declared input — on ANY attempt', async () => {
        const { engine, runs } = countingFlowEngine({
            config: {},
            inputSchema: { url: { type: 'string', required: true } },
        });

        const result = await engine.execute('guarded');

        expect(result.success).toBe(false);
        // Same never-dispatched envelope as the mis-typed case (#10025): the
        // classification keys off the GUARD, not off which of its two rules
        // refused.
        expect(result.code).toBe('FLOW_INPUT_SCHEMA_INVALID');
        expect(result.status).toBeUndefined();
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
